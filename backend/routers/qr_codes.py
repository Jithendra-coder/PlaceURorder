from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Response

from database import DbClient, get_db_client
from deps import require_user_id
from schemas import OwnerStoreOrdering, QrCodeCreate, QrCodeUpdate, QrOrderingToggle
from services import qr_service

router = APIRouter(prefix="/businesses/{business_id}/qr-codes", tags=["qr-codes"])

@router.get("")
def list_qr_codes(business_id: UUID, user_id: UUID = Depends(require_user_id), client: DbClient = Depends(get_db_client)):
    return qr_service.list_qr_codes(client, business_id, user_id)

@router.get("/store-ordering", response_model=OwnerStoreOrdering)
def get_store_ordering(business_id: UUID, user_id: UUID = Depends(require_user_id), client: DbClient = Depends(get_db_client)):
    return qr_service.owner_store_ordering(client, business_id, user_id)

@router.put("/store-ordering", response_model=OwnerStoreOrdering)
def set_store_ordering(payload: QrOrderingToggle, business_id: UUID, user_id: UUID = Depends(require_user_id), client: DbClient = Depends(get_db_client)):
    return qr_service.set_qr_ordering(client, business_id, user_id, payload.enabled)

@router.post("")
def create_qr_code(payload: QrCodeCreate, business_id: UUID, user_id: UUID = Depends(require_user_id), client: DbClient = Depends(get_db_client)):
    return qr_service.create_qr_code(client, business_id, user_id, payload)

@router.patch("/{qr_id}")
def update_qr_code(payload: QrCodeUpdate, qr_id: UUID, user_id: UUID = Depends(require_user_id), client: DbClient = Depends(get_db_client)):
    return qr_service.update_qr_code(client, qr_id, user_id, payload)

@router.delete("/{qr_id}", status_code=204)
def delete_qr_code(qr_id: UUID, user_id: UUID = Depends(require_user_id), client: DbClient = Depends(get_db_client)):
    qr_service.delete_qr_code(client, qr_id, user_id)
    return Response(status_code=204)

@router.get("/{qr_id}/download")
def download_qr(qr_id: UUID, format: Literal["svg", "png"] = "svg", user_id: UUID = Depends(require_user_id), client: DbClient = Depends(get_db_client)):
    data, media_type, filename = qr_service.render_qr(client, qr_id, user_id, format)
    return Response(content=data, media_type=media_type, headers={"Content-Disposition": f'attachment; filename="{filename}"'})
