from __future__ import annotations

from uuid import UUID

from fastapi import HTTPException

from database import DbClient
from schemas import (
    ComboCreate,
    ComboOptionCreate,
    ComboOptionUpdate,
    ComboSectionCreate,
    ComboSectionInput,
    ComboSectionUpdate,
    ComboUpdate,
)
from services.business_service import CATALOG_READ_ROLES, FULL_ACCESS_ROLES, assert_business_access
from services.product_service import get_category, get_product


def list_combos(client: DbClient, business_id: UUID, user_id: UUID) -> list[dict]:
    assert_business_access(client, business_id, user_id, CATALOG_READ_ROLES)
    combos = (
        client.table("menu_combos")
        .select("*")
        .eq("business_id", str(business_id))
        .order("sort_order", desc=False)
        .order("created_at", desc=True)
        .execute()
        .data
        or []
    )
    if not combos:
        return []

    combo_ids = [combo["id"] for combo in combos]
    sections = (
        client.table("combo_sections")
        .select("*")
        .in_("combo_id", combo_ids)
        .execute()
        .data
        or []
    )
    section_types = {section["id"]: section["section_type"] for section in sections}
    options = (
        client.table("combo_options")
        .select("*")
        .in_("combo_id", combo_ids)
        .execute()
        .data
        or []
    )
    counts = {combo_id: 0 for combo_id in combo_ids}
    for option in options:
        if section_types.get(option["section_id"]) == "included_items":
            counts[option["combo_id"]] = counts.get(option["combo_id"], 0) + 1
    for combo in combos:
        combo["included_items_count"] = counts.get(combo["id"], 0)
    return combos


def get_combo(client: DbClient, combo_id: UUID, user_id: UUID) -> dict:
    combo = _get_combo_row(client, combo_id)
    assert_business_access(client, UUID(combo["business_id"]), user_id, CATALOG_READ_ROLES)
    return _combo_detail(client, combo)


def create_combo(
    client: DbClient,
    business_id: UUID,
    user_id: UUID,
    payload: ComboCreate,
) -> dict:
    assert_business_access(client, business_id, user_id, FULL_ACCESS_ROLES)
    _validate_category(client, business_id, payload.category_id)
    _validate_publishable(payload.status, payload.sections)

    data = payload.model_dump(mode="json", exclude={"sections"})
    data["business_id"] = str(business_id)
    response = client.table("menu_combos").insert(data).execute()
    if not response.data:
        raise HTTPException(status_code=400, detail="Combo could not be created.")
    combo = response.data[0]
    _replace_sections(client, combo, payload.sections)
    return _combo_detail(client, combo)


def update_combo(
    client: DbClient,
    combo_id: UUID,
    user_id: UUID,
    payload: ComboUpdate,
) -> dict:
    combo = _get_combo_row(client, combo_id)
    business_id = UUID(combo["business_id"])
    assert_business_access(client, business_id, user_id, FULL_ACCESS_ROLES)
    _validate_category(client, business_id, payload.category_id)

    current_sections = _load_section_inputs(client, combo_id)
    next_sections = payload.sections if payload.sections is not None else current_sections
    next_status = payload.status or combo["status"]
    _validate_publishable(next_status, next_sections)

    data = payload.model_dump(mode="json", exclude_unset=True, exclude={"sections"})
    if data:
        response = (
            client.table("menu_combos")
            .update(data)
            .eq("id", str(combo_id))
            .eq("business_id", str(business_id))
            .execute()
        )
        if not response.data:
            raise HTTPException(status_code=404, detail="Combo not found.")
        combo = response.data[0]
    if payload.sections is not None:
        _replace_sections(client, combo, payload.sections)
    return _combo_detail(client, combo)


def delete_combo(client: DbClient, combo_id: UUID, user_id: UUID) -> None:
    combo = _get_combo_row(client, combo_id)
    assert_business_access(client, UUID(combo["business_id"]), user_id, FULL_ACCESS_ROLES)
    client.table("menu_combos").delete().eq("id", str(combo_id)).execute()


def duplicate_combo(client: DbClient, combo_id: UUID, user_id: UUID) -> dict:
    source = get_combo(client, combo_id, user_id)
    business_id = UUID(source["business_id"])
    assert_business_access(client, business_id, user_id, FULL_ACCESS_ROLES)
    payload = ComboCreate(
        name=f"{source['name']} Copy",
        description=source.get("description"),
        image_path=source.get("image_path"),
        category_id=source.get("category_id"),
        price=source.get("price") or 0,
        original_price=source.get("original_price"),
        display_badge=source.get("display_badge"),
        tags=source.get("tags") or [],
        status="draft",
        sort_order=source.get("sort_order") or 0,
        availability_type=source.get("availability_type") or "always",
        available_days=source.get("available_days") or [],
        available_start_time=source.get("available_start_time"),
        available_end_time=source.get("available_end_time"),
        sections=[
            ComboSectionInput(
                title=section["title"],
                section_type=section["section_type"],
                required=section["required"],
                min_select=section["min_select"],
                max_select=section["max_select"],
                sort_order=section["sort_order"],
                options=[
                    {
                        "source_type": option["source_type"],
                        "existing_item_id": option.get("existing_item_id"),
                        "exclusive_name": option.get("exclusive_name"),
                        "exclusive_description": option.get("exclusive_description"),
                        "exclusive_image_path": option.get("exclusive_image_path"),
                        "exclusive_type": option.get("exclusive_type"),
                        "quantity": option["quantity"],
                        "price_impact": option["price_impact"],
                        "default_selected": option["default_selected"],
                        "removable": option["removable"],
                        "visible": option["visible"],
                        "sort_order": option["sort_order"],
                    }
                    for option in section.get("options", [])
                ],
            )
            for section in source.get("sections", [])
        ],
    )
    return create_combo(client, business_id, user_id, payload)


def create_section(
    client: DbClient,
    combo_id: UUID,
    user_id: UUID,
    payload: ComboSectionCreate,
) -> dict:
    combo = _get_combo_row(client, combo_id)
    assert_business_access(client, UUID(combo["business_id"]), user_id, FULL_ACCESS_ROLES)
    section = _insert_section(client, combo, payload)
    return _section_detail(client, section)


def update_section(
    client: DbClient,
    section_id: UUID,
    user_id: UUID,
    payload: ComboSectionUpdate,
) -> dict:
    section, combo = _get_section_and_combo(client, section_id)
    assert_business_access(client, UUID(combo["business_id"]), user_id, FULL_ACCESS_ROLES)
    data = payload.model_dump(mode="json", exclude_unset=True)
    next_min = data.get("min_select", section["min_select"])
    next_max = data.get("max_select", section["max_select"])
    if next_min > next_max:
        raise HTTPException(status_code=422, detail="min_select cannot be greater than max_select.")
    if {"min_select", "max_select", "required"} & data.keys():
        options = client.table("combo_options").select("id").eq("section_id", str(section_id)).execute().data or []
        if next_max > len(options):
            raise HTTPException(status_code=422, detail="A section maximum cannot exceed its available options.")
    response = client.table("combo_sections").update(data).eq("id", str(section_id)).execute()
    if not response.data:
        raise HTTPException(status_code=404, detail="Combo section not found.")
    return _section_detail(client, response.data[0])


def delete_section(client: DbClient, section_id: UUID, user_id: UUID) -> None:
    section, combo = _get_section_and_combo(client, section_id)
    assert_business_access(client, UUID(combo["business_id"]), user_id, FULL_ACCESS_ROLES)
    if combo["status"] == "shown" and section["section_type"] == "included_items":
        remaining = [
            item
            for item in _load_section_inputs(client, UUID(combo["id"]))
            if str(item.id or "") != str(section_id)
        ]
        _validate_publishable("shown", remaining)
    client.table("combo_sections").delete().eq("id", str(section_id)).execute()


def create_option(
    client: DbClient,
    section_id: UUID,
    user_id: UUID,
    payload: ComboOptionCreate,
) -> dict:
    section, combo = _get_section_and_combo(client, section_id)
    business_id = UUID(combo["business_id"])
    assert_business_access(client, business_id, user_id, FULL_ACCESS_ROLES)
    return _insert_option(client, combo, section, payload)


def update_option(
    client: DbClient,
    option_id: UUID,
    user_id: UUID,
    payload: ComboOptionUpdate,
) -> dict:
    option, section, combo = _get_option_context(client, option_id)
    business_id = UUID(combo["business_id"])
    assert_business_access(client, business_id, user_id, FULL_ACCESS_ROLES)
    data = payload.model_dump(mode="json", exclude_unset=True)
    merged = {**option, **data}
    _validate_option_data(client, business_id, merged)
    response = client.table("combo_options").update(data).eq("id", str(option_id)).execute()
    if not response.data:
        raise HTTPException(status_code=404, detail="Combo option not found.")
    return _decorate_option(client, response.data[0], business_id)


def delete_option(client: DbClient, option_id: UUID, user_id: UUID) -> None:
    option, section, combo = _get_option_context(client, option_id)
    assert_business_access(client, UUID(combo["business_id"]), user_id, FULL_ACCESS_ROLES)
    if combo["status"] == "shown" and section["section_type"] == "included_items":
        included_count = client.execute_one(
            """
            select count(*) as count
            from combo_options o
            join combo_sections s on s.id = o.section_id
            where o.combo_id = %(combo_id)s
              and s.section_type = 'included_items'
              and o.id <> %(option_id)s
            """,
            {"combo_id": combo["id"], "option_id": str(option_id)},
        )
        if int((included_count or {}).get("count") or 0) < 1:
            raise HTTPException(status_code=422, detail="A shown combo must keep at least one included item.")
    client.table("combo_options").delete().eq("id", str(option_id)).execute()


def list_selectable_items(client: DbClient, business_id: UUID, user_id: UUID) -> list[dict]:
    assert_business_access(client, business_id, user_id, CATALOG_READ_ROLES)
    rows = (
        client.table("products")
        .select("*")
        .eq("business_id", str(business_id))
        .order("sort_order", desc=False)
        .order("name", desc=False)
        .execute()
        .data
        or []
    )
    return [
        row
        for row in rows
        if not bool((row.get("metadata") or {}).get("combo_only"))
        and not bool((row.get("metadata") or {}).get("is_combo"))
    ]


def _replace_sections(client: DbClient, combo: dict, sections: list[ComboSectionInput]) -> None:
    client.table("combo_sections").delete().eq("combo_id", combo["id"]).execute()
    for section in sorted(sections, key=lambda item: item.sort_order):
        _insert_section(client, combo, section)


def _insert_section(client: DbClient, combo: dict, payload: ComboSectionInput) -> dict:
    data = payload.model_dump(mode="json", exclude={"id", "options"})
    data["combo_id"] = combo["id"]
    response = client.table("combo_sections").insert(data).execute()
    if not response.data:
        raise HTTPException(status_code=400, detail="Combo section could not be created.")
    section = response.data[0]
    for option in sorted(payload.options, key=lambda item: item.sort_order):
        _insert_option(client, combo, section, option)
    return section


def _insert_option(client: DbClient, combo: dict, section: dict, payload) -> dict:
    business_id = UUID(combo["business_id"])
    data = payload.model_dump(mode="json", exclude={"id"})
    _validate_option_data(client, business_id, data)
    data["combo_id"] = combo["id"]
    data["section_id"] = section["id"]
    response = client.table("combo_options").insert(data).execute()
    if not response.data:
        raise HTTPException(status_code=400, detail="Combo option could not be created.")
    return _decorate_option(client, response.data[0], business_id)


def _validate_option_data(client: DbClient, business_id: UUID, data: dict) -> None:
    source_type = data.get("source_type")
    if source_type == "existing_item":
        existing_item_id = data.get("existing_item_id")
        if not existing_item_id:
            raise HTTPException(status_code=422, detail="Select an existing menu item.")
        product = get_product(client, UUID(str(existing_item_id)))
        if str(product["business_id"]) != str(business_id):
            raise HTTPException(status_code=400, detail="Existing combo item must belong to the same business.")
        metadata = product.get("metadata") or {}
        if metadata.get("is_combo") or metadata.get("menu_entity_type") == "combo":
            raise HTTPException(status_code=400, detail="Combos cannot contain other combos.")
        data["exclusive_name"] = None
        data["exclusive_description"] = None
        data["exclusive_image_path"] = None
        data["exclusive_type"] = None
    elif source_type == "exclusive_combo_item":
        if not str(data.get("exclusive_name") or "").strip():
            raise HTTPException(status_code=422, detail="Exclusive combo item name is required.")
        data["existing_item_id"] = None
    else:
        raise HTTPException(status_code=422, detail="Choose a valid combo option source.")


def _validate_publishable(status: str, sections: list[ComboSectionInput]) -> None:
    if status != "shown":
        return
    included_count = sum(
        len(section.options)
        for section in sections
        if section.section_type == "included_items"
    )
    if included_count < 1:
        raise HTTPException(status_code=422, detail="A shown combo must have at least one included item.")


def _validate_category(client: DbClient, business_id: UUID, category_id) -> None:
    if not category_id:
        return
    category = get_category(client, UUID(str(category_id)))
    if str(category["business_id"]) != str(business_id):
        raise HTTPException(status_code=400, detail="Category does not belong to this business.")


def _get_combo_row(client: DbClient, combo_id: UUID) -> dict:
    response = client.table("menu_combos").select("*").eq("id", str(combo_id)).limit(1).execute()
    if not response.data:
        raise HTTPException(status_code=404, detail="Combo not found.")
    return response.data[0]


def _get_section_and_combo(client: DbClient, section_id: UUID) -> tuple[dict, dict]:
    response = client.table("combo_sections").select("*").eq("id", str(section_id)).limit(1).execute()
    if not response.data:
        raise HTTPException(status_code=404, detail="Combo section not found.")
    section = response.data[0]
    return section, _get_combo_row(client, UUID(section["combo_id"]))


def _get_option_context(client: DbClient, option_id: UUID) -> tuple[dict, dict, dict]:
    response = client.table("combo_options").select("*").eq("id", str(option_id)).limit(1).execute()
    if not response.data:
        raise HTTPException(status_code=404, detail="Combo option not found.")
    option = response.data[0]
    section, combo = _get_section_and_combo(client, UUID(option["section_id"]))
    return option, section, combo


def _combo_detail(client: DbClient, combo: dict) -> dict:
    sections = (
        client.table("combo_sections")
        .select("*")
        .eq("combo_id", combo["id"])
        .order("sort_order", desc=False)
        .order("created_at", desc=False)
        .execute()
        .data
        or []
    )
    for section in sections:
        section["options"] = (
            client.table("combo_options")
            .select("*")
            .eq("section_id", section["id"])
            .order("sort_order", desc=False)
            .order("created_at", desc=False)
            .execute()
            .data
            or []
        )
        section["options"] = [
            _decorate_option(client, option, UUID(combo["business_id"]))
            for option in section["options"]
        ]
    combo["sections"] = sections
    combo["included_items_count"] = sum(
        len(section["options"])
        for section in sections
        if section["section_type"] == "included_items"
    )
    return combo


def _section_detail(client: DbClient, section: dict) -> dict:
    combo = _get_combo_row(client, UUID(section["combo_id"]))
    options = (
        client.table("combo_options")
        .select("*")
        .eq("section_id", section["id"])
        .order("sort_order", desc=False)
        .execute()
        .data
        or []
    )
    section["options"] = [
        _decorate_option(client, option, UUID(combo["business_id"]))
        for option in options
    ]
    return section


def _decorate_option(client: DbClient, option: dict, business_id: UUID) -> dict:
    option["existing_item"] = None
    option["missing_existing_item"] = False
    if option["source_type"] == "existing_item":
        if not option.get("existing_item_id"):
            option["missing_existing_item"] = True
        else:
            response = (
                client.table("products")
                .select("*")
                .eq("id", option["existing_item_id"])
                .eq("business_id", str(business_id))
                .limit(1)
                .execute()
            )
            if response.data:
                option["existing_item"] = response.data[0]
            else:
                option["missing_existing_item"] = True
    return option


def _load_section_inputs(client: DbClient, combo_id: UUID) -> list[ComboSectionInput]:
    combo = _combo_detail(client, _get_combo_row(client, combo_id))
    return [
        ComboSectionInput(
            id=section["id"],
            title=section["title"],
            section_type=section["section_type"],
            required=section["required"],
            min_select=section["min_select"],
            max_select=section["max_select"],
            sort_order=section["sort_order"],
            options=[
                {
                    "id": option["id"],
                    "source_type": option["source_type"],
                    "existing_item_id": option.get("existing_item_id"),
                    "exclusive_name": option.get("exclusive_name"),
                    "exclusive_description": option.get("exclusive_description"),
                    "exclusive_image_path": option.get("exclusive_image_path"),
                    "exclusive_type": option.get("exclusive_type"),
                    "quantity": option["quantity"],
                    "price_impact": option["price_impact"],
                    "default_selected": option["default_selected"],
                    "removable": option["removable"],
                    "visible": option["visible"],
                    "sort_order": option["sort_order"],
                }
                for option in section["options"]
                if not option.get("missing_existing_item")
            ],
        )
        for section in combo["sections"]
    ]
