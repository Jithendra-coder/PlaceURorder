import pytest
from fastapi.testclient import TestClient
from psycopg import OperationalError

import database
from main import app
from routers import auth
from services import auth_service


def test_new_connection_has_a_finite_connect_timeout(monkeypatch):
    settings = type("Settings", (), {"database_url": "postgresql://example.test/app"})()
    calls = {}
    connection = object()

    def fake_connect(*args, **kwargs):
        calls["args"] = args
        calls["kwargs"] = kwargs
        return connection

    monkeypatch.setattr(database, "get_settings", lambda: settings)
    monkeypatch.setattr(database, "connect", fake_connect)

    assert database.new_connection() is connection
    assert calls["kwargs"]["connect_timeout"] == 5


class BrokenRollbackConnection:
    closed = False
    broken = False

    def __init__(self):
        self.statements = []

    def execute(self, statement):
        self.statements.append(statement)

    def commit(self):
        raise AssertionError("commit should not run after the operation fails")

    def rollback(self):
        raise RuntimeError("connection is lost")

    def close(self):
        self.closed = True


def test_db_context_preserves_the_primary_error_when_cleanup_fails(monkeypatch):
    connection = BrokenRollbackConnection()
    monkeypatch.setattr(database, "new_connection", lambda: connection)

    with pytest.raises(ValueError, match="primary failure"):
        with database.db_context():
            raise ValueError("primary failure")

    assert connection.closed is True
    assert connection.statements == [
        "set local lock_timeout = '10000ms'",
        "set local idle_in_transaction_session_timeout = '12000ms'",
    ]


def test_database_connection_error_is_a_safe_service_unavailable_response(monkeypatch):
    app.dependency_overrides[auth.get_db_client] = lambda: object()
    monkeypatch.setattr(auth_service, "start_staged_signup", lambda *_args: (_ for _ in ()).throw(OperationalError("connection is lost")))
    try:
        response = TestClient(app, raise_server_exceptions=False).post("/api/auth/signup/start", json={"email": "database-error@example.test"})
    finally:
        app.dependency_overrides.pop(auth.get_db_client, None)

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "SERVICE_UNAVAILABLE"
