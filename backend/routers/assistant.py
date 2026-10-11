from typing import Any, Literal
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


class AssistantField(BaseModel):
    label: str
    value: str


class AssistantResult(BaseModel):
    title: str
    value: str | None = None
    fields: list[AssistantField] = Field(default_factory=list)


class AssistantSource(BaseModel):
    kind: Literal["policy", "live", "notice"]
    title: str
    href: str | None = None
    excerpt: str | None = None
    version: str | None = None
    as_of: str | None = None


class AssistantResponse(BaseModel):
    intent: str
    text: str
    total: int | None
    results: list[AssistantResult]
    sources: list[AssistantSource]
    as_of: str
    has_more: bool
    answer_kind: Literal["data", "narrative"]
    requires_confirmation: bool
    action: dict[str, Any] | None
    args: dict[str, Any] | None


@router.post("/chat", response_model=AssistantResponse)
def ask(
    payload: AskRequest,
    request: Request,
    user_id: UUID = Depends(require_user_id),
    client: DbClient = Depends(get_db_client),
):
    assert_rate_limit(request, ASK_LIMIT, identity_parts=[str(user_id), str(payload.business_id)])
    business_service.assert_business_access(client, payload.business_id, user_id, set(StaffRole))
    return assistant_service.answer(client, payload.business_id, user_id, payload.question)
