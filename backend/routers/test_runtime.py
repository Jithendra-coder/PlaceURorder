from uuid import UUID

from fastapi import APIRouter, Cookie, Depends, Query, Request

from schemas import ApiResponse, TestRuntimeAvailabilityUpdate, TestRuntimeItemProgress, TestRuntimeKitchenAction, TestRuntimeOrderCreate, TestRuntimeOrderStatusUpdate, TestRuntimeReworkRequest
from services import test_runtime_service, test_session_service
from services.rate_limit_service import RateLimitRule, assert_rate_limit


TEST_RUNTIME_LIMIT = RateLimitRule("test-runtime:session", 600, 60)


def _test_runtime_rate_limit(request: Request, test_session: str | None = Cookie(default=None, alias=test_session_service.TEST_SESSION_COOKIE_NAME)) -> None:
    # Anonymous requests are limited per IP only, so one unauthenticated client cannot exhaust a shared bucket.
    assert_rate_limit(request, TEST_RUNTIME_LIMIT, identity_parts=[test_session] if test_session else [])


router = APIRouter(prefix="/test/runtime", tags=["test-runtime"], dependencies=[Depends(_test_runtime_rate_limit)])


@router.post("/{app_type}/orders", response_model=ApiResponse)
def create_order(app_type: str, payload: TestRuntimeOrderCreate, test_session: str | None = Cookie(default=None, alias=test_session_service.TEST_SESSION_COOKIE_NAME)):
    from database import db_context
    with db_context() as client:
        order = test_runtime_service.create(client, test_session, app_type, payload)
    return ApiResponse(message="Test runtime order created.", data=order)


@router.get("/{app_type}/orders")
def list_orders(app_type: str, status: str | None = Query(default=None), test_session: str | None = Cookie(default=None, alias=test_session_service.TEST_SESSION_COOKIE_NAME)):
    from database import db_context
    with db_context() as client:
        return {"orders": test_runtime_service.list_current(client, test_session, app_type, status)}


@router.get("/{app_type}/orders/{order_id}")
def get_order(app_type: str, order_id: UUID, test_session: str | None = Cookie(default=None, alias=test_session_service.TEST_SESSION_COOKIE_NAME)):
    from database import db_context
    with db_context() as client:
        return {"order": test_runtime_service.get_one(client, test_session, app_type, order_id)}


@router.post("/counter/orders/{order_id}/mark-paid", response_model=ApiResponse)
def mark_paid(order_id: UUID, test_session: str | None = Cookie(default=None, alias=test_session_service.TEST_SESSION_COOKIE_NAME)):
    from database import db_context
    with db_context() as client:
        order = test_runtime_service.mark_paid(client, test_session, order_id)
    return ApiResponse(message="Simulated test payment recorded.", data=order)


@router.get("/counter/pending-payments")
def counter_pending_payments(test_session: str | None = Cookie(default=None, alias=test_session_service.TEST_SESSION_COOKIE_NAME)):
    from database import db_context
    with db_context() as client:
        return {"orders": test_runtime_service.counter_pending_payments(client, test_session)}


@router.get("/counter/kitchen-orders")
def counter_kitchen_orders(test_session: str | None = Cookie(default=None, alias=test_session_service.TEST_SESSION_COOKIE_NAME)):
    from database import db_context
    with db_context() as client:
        return {"orders": test_runtime_service.counter_kitchen_orders(client, test_session)}


@router.post("/counter/orders/{order_id}/handover", response_model=ApiResponse)
def counter_handover(order_id: UUID, payload: dict | None = None, test_session: str | None = Cookie(default=None, alias=test_session_service.TEST_SESSION_COOKIE_NAME)):
    from database import db_context
    with db_context() as client:
        order = test_runtime_service.handover(client, test_session, order_id, payload)
    return ApiResponse(message="Test order handed over.", data=order)


@router.get("/counter/handover-history")
def counter_handover_history(test_session: str | None = Cookie(default=None, alias=test_session_service.TEST_SESSION_COOKIE_NAME)):
    from database import db_context
    with db_context() as client:
        return {"orders": test_runtime_service.handover_history(client, test_session)}


@router.post("/counter/orders/{order_id}/rework", response_model=ApiResponse)
def counter_rework(order_id: UUID, payload: TestRuntimeReworkRequest, test_session: str | None = Cookie(default=None, alias=test_session_service.TEST_SESSION_COOKIE_NAME)):
    from database import db_context
    with db_context() as client:
        order = test_runtime_service.request_rework(client, test_session, order_id, payload)
    return ApiResponse(message="Test Kitchen rework requested.", data=order)


@router.patch("/{app_type}/orders/{order_id}/status", response_model=ApiResponse)
def update_status(app_type: str, order_id: UUID, payload: TestRuntimeOrderStatusUpdate, test_session: str | None = Cookie(default=None, alias=test_session_service.TEST_SESSION_COOKIE_NAME)):
    from database import db_context
    with db_context() as client:
        order = test_runtime_service.update_status(client, test_session, app_type, order_id, payload)
    return ApiResponse(message="Test runtime order updated.", data=order)


@router.get("/kitchen/summary")
def kitchen_summary(test_session: str | None = Cookie(default=None, alias=test_session_service.TEST_SESSION_COOKIE_NAME)):
    from database import db_context
    with db_context() as client:
        return test_runtime_service.summary(client, test_session)


@router.get("/kitchen/history")
def kitchen_history(test_session: str | None = Cookie(default=None, alias=test_session_service.TEST_SESSION_COOKIE_NAME)):
    from database import db_context
    with db_context() as client:
        return {"orders": test_runtime_service.history(client, test_session)}


@router.get("/{app_type}/availability")
def test_availability(app_type: str, test_session: str | None = Cookie(default=None, alias=test_session_service.TEST_SESSION_COOKIE_NAME)):
    from database import db_context
    with db_context() as client:
        return {"products": test_runtime_service.availability(client, test_session, app_type)}


@router.put("/kitchen/availability/{product_id}", response_model=ApiResponse)
def set_test_availability(product_id: UUID, payload: TestRuntimeAvailabilityUpdate, test_session: str | None = Cookie(default=None, alias=test_session_service.TEST_SESSION_COOKIE_NAME)):
    from database import db_context
    with db_context() as client:
        override = test_runtime_service.set_availability(client, test_session, product_id, payload.is_available)
    return ApiResponse(message="Test availability override saved.", data=override)


@router.delete("/kitchen/availability/{product_id}", response_model=ApiResponse)
def clear_test_availability(product_id: UUID, test_session: str | None = Cookie(default=None, alias=test_session_service.TEST_SESSION_COOKIE_NAME)):
    from database import db_context
    with db_context() as client:
        test_runtime_service.clear_availability(client, test_session, product_id)
    return ApiResponse(message="Test availability override cleared.")


@router.post("/kitchen/orders/{order_id}/start", response_model=ApiResponse)
def kitchen_start(order_id: UUID, payload: TestRuntimeKitchenAction | None = None, test_session: str | None = Cookie(default=None, alias=test_session_service.TEST_SESSION_COOKIE_NAME)):
    from database import db_context
    with db_context() as client:
        order = test_runtime_service.start(client, test_session, order_id, payload)
    return ApiResponse(message="Test Kitchen order started.", data=order)


@router.patch("/kitchen/orders/{order_id}/items/{item_id}", response_model=ApiResponse)
def kitchen_item_progress(order_id: UUID, item_id: UUID, payload: TestRuntimeItemProgress, test_session: str | None = Cookie(default=None, alias=test_session_service.TEST_SESSION_COOKIE_NAME)):
    from database import db_context
    with db_context() as client:
        order = test_runtime_service.complete_item(client, test_session, order_id, item_id, payload)
    return ApiResponse(message="Test Kitchen item progress saved.", data=order)


@router.post("/kitchen/orders/{order_id}/hold", response_model=ApiResponse)
def kitchen_hold(order_id: UUID, payload: TestRuntimeKitchenAction, test_session: str | None = Cookie(default=None, alias=test_session_service.TEST_SESSION_COOKIE_NAME)):
    from database import db_context
    with db_context() as client:
        order = test_runtime_service.hold(client, test_session, order_id, payload)
    return ApiResponse(message="Test Kitchen order held.", data=order)


@router.post("/kitchen/orders/{order_id}/resume", response_model=ApiResponse)
def kitchen_resume(order_id: UUID, payload: TestRuntimeKitchenAction | None = None, test_session: str | None = Cookie(default=None, alias=test_session_service.TEST_SESSION_COOKIE_NAME)):
    from database import db_context
    with db_context() as client:
        order = test_runtime_service.resume(client, test_session, order_id, payload)
    return ApiResponse(message="Test Kitchen order resumed.", data=order)


@router.post("/kitchen/orders/{order_id}/ready", response_model=ApiResponse)
def kitchen_ready(order_id: UUID, payload: TestRuntimeKitchenAction | None = None, test_session: str | None = Cookie(default=None, alias=test_session_service.TEST_SESSION_COOKIE_NAME)):
    from database import db_context
    with db_context() as client:
        order = test_runtime_service.ready(client, test_session, order_id, payload)
    return ApiResponse(message="Test Kitchen order marked ready.", data=order)


@router.post("/kitchen/orders/{order_id}/recall", response_model=ApiResponse)
def kitchen_recall(order_id: UUID, payload: TestRuntimeKitchenAction | None = None, test_session: str | None = Cookie(default=None, alias=test_session_service.TEST_SESSION_COOKIE_NAME)):
    from database import db_context
    with db_context() as client:
        order = test_runtime_service.recall(client, test_session, order_id, payload)
    return ApiResponse(message="Test Kitchen order recalled.", data=order)


@router.post("/kitchen/orders/{order_id}/rework", response_model=ApiResponse)
def kitchen_rework(order_id: UUID, payload: TestRuntimeReworkRequest, test_session: str | None = Cookie(default=None, alias=test_session_service.TEST_SESSION_COOKIE_NAME)):
    from database import db_context
    with db_context() as client:
        order = test_runtime_service.rework(client, test_session, order_id, payload)
    return ApiResponse(message="Test Kitchen rework requested.", data=order)


@router.delete("/{app_type}/orders", response_model=ApiResponse)
def clear_orders(app_type: str, test_session: str | None = Cookie(default=None, alias=test_session_service.TEST_SESSION_COOKIE_NAME)):
    from database import db_context
    with db_context() as client:
        test_runtime_service.clear(client, test_session, app_type)
    return ApiResponse(message="Test runtime orders cleared.")
