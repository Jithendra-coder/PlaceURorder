from datetime import datetime, timezone
from datetime import datetime, timezone
from uuid import UUID

from fastapi import HTTPException

from database import DbClient
from schemas import (
    CategoryCreate,
    CategoryUpdate,
    ModifierGroupCreate,
    ModifierGroupUpdate,
    ProductCreate,
    ProductUpdate,
    StockLimitUpdate,
)
from services.business_service import FULL_ACCESS_ROLES, KITCHEN_ROLES, assert_business_access
from services import cache_service
from utils import clean_payload


def list_categories(client: DbClient, business_id: UUID) -> list[dict]:
    response = (
        client.table("categories")
        .select("*")
        .eq("business_id", str(business_id))
        .order("sort_order", desc=False)
        .order("name", desc=False)
        .execute()
    )
    return response.data or []


def create_category(client: DbClient, business_id: UUID, user_id: UUID, payload: CategoryCreate) -> dict:
    assert_business_access(client, business_id, user_id, FULL_ACCESS_ROLES)
    _assert_category_name_available(client, business_id, payload.name)
    data = payload.model_dump(mode="json")
    data["business_id"] = str(business_id)
    response = client.table("categories").insert(data).execute()
    if not response.data:
        raise HTTPException(status_code=400, detail="Category could not be created.")
    cache_service.invalidate_business(client, str(business_id))
    return response.data[0]


def update_category(client: DbClient, category_id: UUID, user_id: UUID, payload: CategoryUpdate) -> dict:
    category = get_category(client, category_id)
    assert_business_access(client, UUID(category["business_id"]), user_id, FULL_ACCESS_ROLES)
    data = payload.model_dump(mode="json", exclude_unset=True)
    if not data:
        return category
    if data.get("name"):
        _assert_category_name_available(client, UUID(category["business_id"]), data["name"], category_id)
    response = client.table("categories").update(data).eq("id", str(category_id)).execute()
    if not response.data:
        raise HTTPException(status_code=404, detail="Category not found.")
    cache_service.invalidate_business(client, category["business_id"])
    return response.data[0]


def get_category(client: DbClient, category_id: UUID) -> dict:
    response = client.table("categories").select("*").eq("id", str(category_id)).limit(1).execute()
    if not response.data:
        raise HTTPException(status_code=404, detail="Category not found.")
    return response.data[0]


def delete_category(client: DbClient, category_id: UUID, user_id: UUID) -> None:
    category = get_category(client, category_id)
    assert_business_access(client, UUID(category["business_id"]), user_id, FULL_ACCESS_ROLES)
    client.table("categories").delete().eq("id", str(category_id)).execute()
    cache_service.invalidate_business(client, category["business_id"])


def list_products(client: DbClient, business_id: UUID, include_unavailable: bool = True) -> list[dict]:
    query = (
        client.table("products")
        .select("*")
        .eq("business_id", str(business_id))
        .order("created_at", desc=True)
    )
    if not include_unavailable:
        query = query.eq("is_available", True)
    response = query.execute()
    return response.data or []


def get_product(client: DbClient, product_id: UUID) -> dict:
    response = client.table("products").select("*").eq("id", str(product_id)).limit(1).execute()
    if not response.data:
        raise HTTPException(status_code=404, detail="Product not found.")
    return response.data[0]


def create_product(client: DbClient, business_id: UUID, user_id: UUID, payload: ProductCreate) -> dict:
    assert_business_access(client, business_id, user_id, FULL_ACCESS_ROLES)
    data = payload.model_dump(mode="json")
    _validate_discount(data)
    _validate_discount_window(data)
    _normalize_menu_status_fields(data, payload.model_fields_set)
    _assert_product_category(client, data, business_id)
    data["business_id"] = str(business_id)
    response = client.table("products").insert(data).execute()
    if not response.data:
        raise HTTPException(status_code=400, detail="Product could not be created.")
    row = response.data[0]
    client.table("audit_logs").insert({
        "business_id": str(business_id),
        "user_id": str(user_id),
        "action": "product_created",
        "entity": "product",
        "entity_id": str(row["id"]),
        "metadata": {"name": row.get("name"), "price": float(row.get("price") or 0)},
    }).execute()
    cache_service.invalidate_business(client, str(business_id))
    return row


def update_product(client: DbClient, product_id: UUID, user_id: UUID, payload: ProductUpdate) -> dict:
    product = get_product(client, product_id)
    business_id = UUID(product["business_id"])
    assert_business_access(client, business_id, user_id, FULL_ACCESS_ROLES)
    data = payload.model_dump(mode="json", exclude_unset=True)
    if not data:
        return product
    _validate_discount(data, product)
    _validate_discount_window(data, product)
    _normalize_menu_status_fields(data, payload.model_fields_set)
    _assert_product_category(client, data, business_id, product)
    response = (
        client.table("products")
        .update(data)
        .eq("id", str(product_id))
        .eq("business_id", str(business_id))
        .execute()
    )
    if not response.data:
        raise HTTPException(status_code=404, detail="Product not found.")
    row = response.data[0]
    client.table("audit_logs").insert({
        "business_id": str(business_id),
        "user_id": str(user_id),
        "action": "product_updated",
        "entity": "product",
        "entity_id": str(product_id),
        "metadata": {"name": row.get("name"), "fields": sorted(data)},
    }).execute()
    cache_service.invalidate_business(client, str(business_id))
    return row


def _normalize_menu_status_fields(data: dict, explicitly_set: set[str]) -> None:
    if "menu_status" in explicitly_set:
        data["is_available"] = data["menu_status"] == "shown"
    elif "is_available" in explicitly_set:
        data["menu_status"] = "shown" if data["is_available"] else "unavailable"


def _validate_discount(data: dict, current: dict | None = None) -> None:
    discount_type = data.get("discount_type", (current or {}).get("discount_type", "none"))
    discount_value = data.get("discount_value", (current or {}).get("discount_value", 0))
    if discount_type == "percentage" and float(discount_value or 0) > 100:
        raise HTTPException(status_code=422, detail="Percentage discounts cannot exceed 100%.")


def _validate_discount_window(data: dict, current: dict | None = None) -> None:
    starts_at = _comparable_datetime(data.get("discount_starts_at", (current or {}).get("discount_starts_at")))
    ends_at = _comparable_datetime(data.get("discount_ends_at", (current or {}).get("discount_ends_at")))
    if starts_at and ends_at and starts_at >= ends_at:
        raise HTTPException(status_code=422, detail="Discount end must be after its start.")


def _comparable_datetime(value) -> datetime | None:
    if not value:
        return None
    parsed = value if isinstance(value, datetime) else datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed.astimezone(timezone.utc)


def _assert_product_category(client: DbClient, data: dict, business_id: UUID, current: dict | None = None) -> None:
    status = data.get("menu_status", (current or {}).get("menu_status", "shown"))
    category_id = data.get("category_id") if "category_id" in data else (current or {}).get("category_id")
    if status != "draft" and not category_id:
        raise HTTPException(status_code=400, detail="Select a category before saving this item.")
    if category_id:
        _assert_category_in_business(client, UUID(str(category_id)), business_id)


def delete_product(client: DbClient, product_id: UUID, user_id: UUID) -> None:
    product = get_product(client, product_id)
    business_id = UUID(product["business_id"])
    assert_business_access(client, business_id, user_id, FULL_ACCESS_ROLES)
    published = client.fetch_one("select snapshot from kiosk_published_configs where business_id = %(id)s", {"id": str(business_id)})
    was_published = any(str(row.get("id")) == str(product_id) for row in ((published or {}).get("snapshot") or {}).get("products", []))
    if was_published:
        client.table("products").update({"menu_status": "hidden", "is_available": False}).eq("id", str(product_id)).eq("business_id", str(business_id)).execute()
    else:
        client.table("products").delete().eq("id", str(product_id)).eq("business_id", str(business_id)).execute()
    client.table("audit_logs").insert({
        "business_id": str(business_id),
        "user_id": str(user_id),
        "action": "product_deleted",
        "entity": "product",
        "entity_id": str(product_id),
        "metadata": {"name": product.get("name")},
    }).execute()
    cache_service.invalidate_business(client, str(business_id))


def set_availability(
    client: DbClient,
    product_id: UUID,
    user_id: UUID,
    is_available: bool,
) -> dict:
    product = get_product(client, product_id)
    business_id = UUID(product["business_id"])
    assert_business_access(client, business_id, user_id, KITCHEN_ROLES)
    previous = bool(product.get("is_available"))
    response = (
        client.table("products")
        .update({
            "is_available": is_available,
            "menu_status": "shown" if is_available else "unavailable",
        })
        .eq("id", str(product_id))
        .eq("business_id", str(business_id))
        .execute()
    )
    if not response.data:
        raise HTTPException(status_code=404, detail="Product not found.")
    client.table("audit_logs").insert({"business_id": str(business_id), "user_id": str(user_id), "action": "inventory_availability_updated", "entity": "product", "entity_id": str(product_id), "metadata": {"previous": previous, "next": is_available}}).execute()
    cache_service.invalidate_business(client, str(business_id))
    return response.data[0]


def update_stock_limit(
    client: DbClient,
    product_id: UUID,
    user_id: UUID,
    payload: StockLimitUpdate,
) -> dict:
    product = get_product(client, product_id)
    business_id = UUID(product["business_id"])
    assert_business_access(client, business_id, user_id, KITCHEN_ROLES)
    data = payload.model_dump(mode="json", exclude_unset=True)
    previous = {"track_stock": product.get("track_stock"), "stock_quantity": product.get("stock_quantity")}
    response = (
        client.table("products")
        .update(data)
        .eq("id", str(product_id))
        .eq("business_id", str(business_id))
        .execute()
    )
    if not response.data:
        raise HTTPException(status_code=404, detail="Product not found.")
    client.table("audit_logs").insert({"business_id": str(business_id), "user_id": str(user_id), "action": "inventory_stock_updated", "entity": "product", "entity_id": str(product_id), "metadata": {"previous": previous, "next": data}}).execute()
    cache_service.invalidate_business(client, str(business_id))
    return response.data[0]


def list_modifier_groups(client: DbClient, product_id: UUID, user_id: UUID | None = None) -> list[dict]:
    product = get_product(client, product_id)
    business_id = UUID(product["business_id"])
    if user_id:
        assert_business_access(client, business_id, user_id)
    return list_modifier_groups_for_products(client, business_id, [str(product_id)]).get(str(product_id), [])


def list_modifier_groups_for_products(
    client: DbClient,
    business_id: UUID,
    product_ids: list[str],
) -> dict[str, list[dict]]:
    if not product_ids:
        return {}

    groups_response = (
        client.table("product_modifier_groups")
        .select("*")
        .eq("business_id", str(business_id))
        .in_("product_id", product_ids)
        .order("sort_order", desc=False)
        .execute()
    )
    groups = groups_response.data or []
    group_ids = [group["id"] for group in groups]
    options_by_group: dict[str, list[dict]] = {group_id: [] for group_id in group_ids}

    if group_ids:
        options_response = (
            client.table("product_modifier_options")
            .select("*")
            .in_("group_id", group_ids)
            .order("sort_order", desc=False)
            .execute()
        )
        for option in options_response.data or []:
            options_by_group.setdefault(option["group_id"], []).append(option)

    by_product: dict[str, list[dict]] = {product_id: [] for product_id in product_ids}
    for group in groups:
        group["options"] = options_by_group.get(group["id"], [])
        by_product.setdefault(group["product_id"], []).append(group)
    return by_product


def create_modifier_group(
    client: DbClient,
    product_id: UUID,
    user_id: UUID,
    payload: ModifierGroupCreate,
) -> dict:
    product = get_product(client, product_id)
    business_id = UUID(product["business_id"])
    assert_business_access(client, business_id, user_id, FULL_ACCESS_ROLES)
    data = payload.model_dump(mode="json", exclude={"options"})
    data["business_id"] = str(business_id)
    data["product_id"] = str(product_id)
    response = client.table("product_modifier_groups").insert(data).execute()
    if not response.data:
        raise HTTPException(status_code=400, detail="Modifier group could not be created.")
    group = response.data[0]

    if payload.options:
        option_rows = []
        for index, option in enumerate(payload.options):
            row = option.model_dump(mode="json")
            row["group_id"] = group["id"]
            row["sort_order"] = row.get("sort_order") or index
            option_rows.append(row)
        client.table("product_modifier_options").insert(option_rows).execute()

    cache_service.invalidate_business(client, str(business_id))
    return list_modifier_groups_for_products(client, business_id, [str(product_id)]).get(str(product_id), [group])[-1]


def update_modifier_group(
    client: DbClient,
    group_id: UUID,
    user_id: UUID,
    payload: ModifierGroupUpdate,
) -> dict:
    group = get_modifier_group(client, group_id)
    assert_business_access(client, UUID(group["business_id"]), user_id, FULL_ACCESS_ROLES)
    data = clean_payload(payload.model_dump(mode="json"))
    if not data:
        return group
    if {"min_select", "max_select", "is_required"} & data.keys():
        options = client.table("product_modifier_options").select("id").eq("group_id", str(group_id)).execute().data or []
        min_select = int(data.get("min_select", group.get("min_select") or 0))
        max_select = int(data.get("max_select", group.get("max_select") or 0))
        if min_select > max_select:
            raise HTTPException(status_code=422, detail="min_select cannot be greater than max_select.")
        if max_select > len(options):
            raise HTTPException(status_code=422, detail="max_select cannot be greater than the number of options.")
    response = client.table("product_modifier_groups").update(data).eq("id", str(group_id)).execute()
    if not response.data:
        raise HTTPException(status_code=404, detail="Modifier group not found.")
    cache_service.invalidate_business(client, group["business_id"])
    return response.data[0]


def delete_modifier_group(client: DbClient, group_id: UUID, user_id: UUID) -> None:
    group = get_modifier_group(client, group_id)
    assert_business_access(client, UUID(group["business_id"]), user_id, FULL_ACCESS_ROLES)
    client.table("product_modifier_groups").delete().eq("id", str(group_id)).execute()
    cache_service.invalidate_business(client, group["business_id"])


def get_modifier_group(client: DbClient, group_id: UUID) -> dict:
    response = (
        client.table("product_modifier_groups")
        .select("*")
        .eq("id", str(group_id))
        .limit(1)
        .execute()
    )
    if not response.data:
        raise HTTPException(status_code=404, detail="Modifier group not found.")
    return response.data[0]


def _assert_category_in_business(client: DbClient, category_id: UUID, business_id: UUID) -> None:
    category = get_category(client, category_id)
    if str(category["business_id"]) != str(business_id):
        raise HTTPException(status_code=400, detail="Category does not belong to this business.")


def _assert_category_name_available(
    client: DbClient,
    business_id: UUID,
    name: str,
    current_category_id: UUID | None = None,
) -> None:
    normalized = name.strip().lower()
    categories = (
        client.table("categories")
        .select("id,name")
        .eq("business_id", str(business_id))
        .execute()
        .data
        or []
    )
    for category in categories:
        if current_category_id and str(category["id"]) == str(current_category_id):
            continue
        if str(category["name"]).strip().lower() == normalized:
            raise HTTPException(status_code=409, detail=f'A category named "{name.strip()}" already exists.')
