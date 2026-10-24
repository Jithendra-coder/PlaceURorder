import asyncio
import json

import pytest
from fastapi import HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.testclient import TestClient
from starlette.requests import Request

from main import app, http_exception, validation_exception


@pytest.mark.parametrize(
    ("status_code", "error_code"),
    [
        (405, "METHOD_NOT_ALLOWED"),
        (415, "UNSUPPORTED_MEDIA_TYPE"),
        (429, "RATE_LIMITED"),
        (502, "BAD_GATEWAY"),
        (504, "GATEWAY_TIMEOUT"),
    ],
)
def test_http_error_contract_preserves_status_code_and_headers(status_code, error_code):
    request = Request({"type": "http", "method": "GET", "path": "/", "headers": []})
    request.state.request_id = "request-test"
    response = asyncio.run(
        http_exception(
            request,
            HTTPException(status_code, detail="Request failed.", headers={"Retry-After": "17"}),
        )
    )

    assert response.status_code == status_code
    assert response.headers["Retry-After"] == "17"
    assert response.headers["X-Request-ID"] == "request-test"
    assert json.loads(response.body)["error"]["code"] == error_code


def test_validation_response_does_not_echo_submitted_secrets():
    request = Request({"type": "http", "method": "POST", "path": "/api/auth/login", "headers": []})
    request.state.request_id = "request-test"
    error = RequestValidationError(
        [
            {
                "type": "string_too_short",
                "loc": ("body", "password"),
                "msg": "String should have at least 8 characters",
                "input": "super-secret",
                "ctx": {"min_length": 8},
            }
        ]
    )
    response = asyncio.run(validation_exception(request, error))

    body = json.loads(response.body)
    assert response.status_code == 422
    assert "super-secret" not in response.body.decode()
    assert all(set(item) <= {"loc", "msg", "type"} for item in body["detail"])


def test_deep_health_uses_service_unavailable_when_database_check_fails(monkeypatch):
    class UnavailableDatabase:
        def __enter__(self):
            raise RuntimeError("database unavailable")

        def __exit__(self, *_args):
            return False

    monkeypatch.setattr("main.db_context", UnavailableDatabase)
    response = TestClient(app).get("/api/health")

    assert response.status_code == 503
    assert response.json()["status"] == "database_unavailable"
