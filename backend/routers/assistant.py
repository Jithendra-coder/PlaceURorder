from uuid import UUID

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, ConfigDict, Field

from database import DbClient, get_db_client
from deps import require_user_id
from schemas import StaffRole
from services import assistant_service, business_service
from services.rate_limit_service import RateLimitRule, assert_rate_limit


router = APIRouter(prefix="/assistant", tags=["assistant"])
ASK_LIMIT = RateLimitRule("assistant:ask", 30, 60)


class AskRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    business_id: UUID
    question: str = Field(min_length=3, max_length=1000)


@router.post("/chat")
def ask(
    payload: AskRequest,
    request: Request,
    user_id: UUID = Depends(require_user_id),
    client: DbClient = Depends(get_db_client),
):
    assert_rate_limit(request, ASK_LIMIT, identity_parts=[str(user_id), str(payload.business_id)])
    business_service.assert_business_access(client, payload.business_id, user_id, set(StaffRole))
    return assistant_service.answer(client, payload.business_id, user_id, payload.question)
