import asyncio
import json

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from main import http_exception


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
