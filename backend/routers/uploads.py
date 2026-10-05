from uuid import UUID

from fastapi import APIRouter, Depends, File, Request, UploadFile

from database import DbClient, get_db_client
from deps import _bearer_token, require_user_id
from schemas import ApiResponse
from services.business_service import ADMIN_ROLES, assert_business_access
from services.auth_service import SESSION_COOKIE_NAME
from services.storage_service import upload_asset
from services.rate_limit_service import RateLimitRule, assert_rate_limit

router = APIRouter(tags=["uploads"])
UPLOAD_LIMIT = RateLimitRule("upload:asset", 20, 60)


def _access_token(request: Request) -> str | None:
    return request.cookies.get(SESSION_COOKIE_NAME) or _bearer_token(request.headers.get("authorization"))


@router.post("/businesses/{business_id}/uploads/product-image", response_model=ApiResponse)
async def upload_product_image(
    business_id: UUID,
    request: Request,
    file: UploadFile = File(...),
    user_id: UUID = Depends(require_user_id),
    client: DbClient = Depends(get_db_client),
):
    assert_business_access(client, business_id, user_id, ADMIN_ROLES)
    assert_rate_limit(request, UPLOAD_LIMIT, identity_parts=[str(user_id), str(business_id), "product"])
    result = await upload_asset(
        business_id,
        file,
        folder="products",
        access_token=_access_token(request),
    )
    return ApiResponse(message="Product image uploaded.", data=result)


@router.post("/businesses/{business_id}/uploads/brand-asset", response_model=ApiResponse)
async def upload_brand_asset(
    business_id: UUID,
    request: Request,
    file: UploadFile = File(...),
    user_id: UUID = Depends(require_user_id),
    client: DbClient = Depends(get_db_client),
):
    assert_business_access(client, business_id, user_id, ADMIN_ROLES)
    assert_rate_limit(request, UPLOAD_LIMIT, identity_parts=[str(user_id), str(business_id), "brand"])
    result = await upload_asset(
        business_id,
        file,
        folder="brand",
        access_token=_access_token(request),
    )
    return ApiResponse(message="Brand asset uploaded.", data=result)
