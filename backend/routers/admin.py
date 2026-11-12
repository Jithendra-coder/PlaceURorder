from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends

from database import DbClient, get_db_client
from deps import require_user_id
from schemas import DashboardStats, HomeActivation
from services import alert_service, analytics_service, auth_service, business_service, growth_recommendation_service, insights_service, setup_service
from services.business_service import ADMIN_ROLES, assert_business_access

router = APIRouter(prefix="/businesses/{business_id}", tags=["admin"])
bootstrap_router = APIRouter(prefix="/admin", tags=["admin"])


@bootstrap_router.get("/bootstrap")
def bootstrap(
    user_id: UUID = Depends(require_user_id),
    client: DbClient = Depends(get_db_client),
):
    user = auth_service.get_user(client, user_id)
    status = business_service.onboarding_status(client, user_id)
    business = business_service.get_primary_business_for_user(client, user_id)
    role = business_service.get_business_role_for_user(client, business, user_id).value if business else None
    setup = None
    alerts = {"unresolved_count": 0, "active_count": 0, "alerts": []}
    if business:
        if role in {"owner", "admin"}:
            setup = setup_service.setup_overview(client, UUID(business["id"]), user_id)
        if role in ADMIN_ROLES:
            alerts = alert_service.alert_summary(client, UUID(business["id"]), user_id)
    return {
        "user": user,
        "onboarding": status,
        "business": business_service.serialize_business_for_response(business),
        "role": role,
        "setup": setup,
        "alerts": alerts,
    }


@router.get("/dashboard", response_model=DashboardStats)
def dashboard(
    business_id: UUID,
    start: datetime | None = None,
    end: datetime | None = None,
    location_id: UUID | None = None,
    user_id: UUID = Depends(require_user_id),
    client: DbClient = Depends(get_db_client),
):
    assert_business_access(client, business_id, user_id, ADMIN_ROLES)
    return analytics_service.dashboard_stats(client, business_id, start=start, end=end, location_id=location_id)


@router.get("/home-activation", response_model=HomeActivation)
def home_activation(
    business_id: UUID,
    location_id: UUID | None = None,
    user_id: UUID = Depends(require_user_id),
    client: DbClient = Depends(get_db_client),
):
    assert_business_access(client, business_id, user_id, ADMIN_ROLES)
    return analytics_service.home_activation(client, business_id, location_id=location_id)


@router.get("/growth/recommendations")
def growth_recommendations(
    business_id: UUID,
    location_id: UUID | None = None,
    refresh: bool = False,
    user_id: UUID = Depends(require_user_id),
    client: DbClient = Depends(get_db_client),
):
    assert_business_access(client, business_id, user_id, ADMIN_ROLES)
    return growth_recommendation_service.recommendations(client, business_id, location_id, refresh=refresh)


@router.get("/analytics", response_model=DashboardStats)
def analytics(
    business_id: UUID,
    start: datetime | None = None,
    end: datetime | None = None,
    location_id: UUID | None = None,
    user_id: UUID = Depends(require_user_id),
    client: DbClient = Depends(get_db_client),
):
    assert_business_access(client, business_id, user_id, ADMIN_ROLES)
    return analytics_service.dashboard_stats(client, business_id, start=start, end=end, location_id=location_id)


@router.get("/insights")
def insights(
    business_id: UUID,
    start: datetime | None = None,
    end: datetime | None = None,
    location_id: UUID | None = None,
    comparison: str = "previous",
    user_id: UUID = Depends(require_user_id),
    client: DbClient = Depends(get_db_client),
):
    assert_business_access(client, business_id, user_id, ADMIN_ROLES)
    return insights_service.compute_comprehensive_insights(
        client,
        business_id,
        start=start,
        end=end,
        location_id=location_id,
        comparison=comparison,
    )

