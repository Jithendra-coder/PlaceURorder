from fastapi.testclient import TestClient

from main import MAX_REQUEST_BYTES, app


def test_declared_oversized_request_is_rejected_before_route_processing():
    with TestClient(app) as client:
        response = client.post("/api/auth/login", content=b"x" * (MAX_REQUEST_BYTES + 1))
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "REQUEST_TOO_LARGE"


def test_chunked_oversized_request_is_rejected_without_content_length():
    with TestClient(app) as client:
        request = client.build_request(
            "POST",
            "/api/auth/login",
            content=iter([b"x" * MAX_REQUEST_BYTES, b"x"]),
        )
        assert "content-length" not in request.headers
        response = client.send(request)

    assert response.status_code == 413
    assert response.json()["error"]["code"] == "REQUEST_TOO_LARGE"
