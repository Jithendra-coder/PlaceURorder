from __future__ import annotations

from contextlib import contextmanager
from dataclasses import dataclass
from datetime import date, datetime, time, timezone
from decimal import Decimal
from typing import Any, Generator, Iterable
from uuid import UUID

from fastapi import HTTPException
from psycopg import Connection, connect
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from config import get_settings


JSON_FIELDS = {
    "available_days",
    "days",
    "time_windows",
    "customizations",
    "kiosk_start_screen_settings",
    "welcome_screen",
    "kiosk_lock_settings",
    "kiosk_order_settings",
    "metadata",
    "order_modes",
    "raw_payload",
    "receipt_settings",
    "ordering_settings",
    "integration_settings",
    "enabled_methods",
    "location_ids",
    "permissions",
    "scopes",
    "events",
    "payload",
    "requirements_due",
    "items",
    "snapshot",
    "store_schedule",
    "tags",
    "tracking_metadata",
    "handover_metadata",
    "rework_metadata",
}
UPSERT_CONFLICTS = {
    "profiles": ("id",),
    "business_staff": ("business_id", "user_id"),
    "order_counters": ("business_id", "counter_date"),
    "devices": ("business_id", "device_id"),
}
BATCH_INSERT_SIZE = 500
LOCK_TIMEOUT_MS = 10_000
IDLE_IN_TRANSACTION_TIMEOUT_MS = 12_000


@dataclass
class DbResponse:
    data: Any
    count: int | None = None


def _ident(name: str) -> str:
    if not name.replace("_", "").isalnum():
        raise ValueError(f"Unsafe SQL identifier: {name}")
    return f'"{name}"'


def _adapt_value(key: str, value: Any) -> Any:
    if hasattr(value, "value"):
        return value.value
    if key in JSON_FIELDS and value is not None:
        return value if isinstance(value, Jsonb) else Jsonb(value)
    return value


def normalize(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: normalize(item) for key, item in value.items()}
    if isinstance(value, list):
        return [normalize(item) for item in value]
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.isoformat()
    if isinstance(value, time):
        return value.isoformat(timespec="minutes")
    if isinstance(value, date):
        return value.isoformat()
    return value


class DbClient:
    def __init__(self, connection: Connection):
        self.connection = connection

    def table(self, table_name: str) -> "TableQuery":
        return TableQuery(self, table_name)

    def rpc(self, name: str, params: dict[str, Any]) -> "RpcQuery":
        return RpcQuery(self, name, params)

    def fetch_all(self, sql: str, params: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        rows = self.connection.execute(sql, params or {}).fetchall()
        return normalize(rows)

    def fetch_one(self, sql: str, params: dict[str, Any] | None = None) -> dict[str, Any] | None:
        row = self.connection.execute(sql, params or {}).fetchone()
        return normalize(row) if row else None

    def execute_command(self, sql: str, params: dict[str, Any] | None = None) -> int:
        """Execute SQL that intentionally returns no rows."""
        return self.connection.execute(sql, params or {}).rowcount

    # Compatibility for existing callers that already imply a result shape.
    def execute(self, sql: str, params: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        return self.fetch_all(sql, params)

    def execute_one(self, sql: str, params: dict[str, Any] | None = None) -> dict[str, Any] | None:
        return self.fetch_one(sql, params)

    def commit(self) -> None:
        self.connection.commit()

    def rollback(self) -> None:
        self.connection.rollback()

    def close(self) -> None:
        self.connection.close()


class TableQuery:
    def __init__(self, client: DbClient, table_name: str):
        self.client = client
        self.table_name = table_name
        self._select = "*"
        self._count_mode: str | None = None
        self._filters: list[tuple[str, str, Any]] = []
        self._orders: list[tuple[str, bool]] = []
        self._limit: int | None = None
        self._operation = "select"
        self._payload: Any = None

    def select(self, columns: str = "*", count: str | None = None) -> "TableQuery":
        self._operation = "select"
        self._select = columns
        self._count_mode = count
        return self

    def insert(self, payload: dict[str, Any] | list[dict[str, Any]]) -> "TableQuery":
        self._operation = "insert"
        self._payload = payload
        return self

    def upsert(self, payload: dict[str, Any]) -> "TableQuery":
        self._operation = "upsert"
        self._payload = payload
        return self

    def update(self, payload: dict[str, Any]) -> "TableQuery":
        self._operation = "update"
        self._payload = payload
        return self

    def delete(self) -> "TableQuery":
        self._operation = "delete"
        return self

    def eq(self, column: str, value: Any) -> "TableQuery":
        self._filters.append(("=", column, value))
        return self

    def gte(self, column: str, value: Any) -> "TableQuery":
        self._filters.append((">=", column, value))
        return self

    def lte(self, column: str, value: Any) -> "TableQuery":
        self._filters.append(("<=", column, value))
        return self

    def in_(self, column: str, values: Iterable[Any]) -> "TableQuery":
        self._filters.append(("in", column, list(values)))
        return self

    def order(self, column: str, desc: bool = False) -> "TableQuery":
        self._orders.append((column, desc))
        return self

    def limit(self, value: int) -> "TableQuery":
        self._limit = value
        return self

    def execute(self) -> DbResponse:
        if self._operation == "insert":
            return self._execute_insert()
        if self._operation == "upsert":
            return self._execute_upsert()
        if self._operation == "update":
            return self._execute_update()
        if self._operation == "delete":
            return self._execute_delete()
        return self._execute_select()

    def _execute_select(self) -> DbResponse:
        params: dict[str, Any] = {}
        where_sql = self._where_sql(params)
        relation_order_items = "order_items(*)" in self._select

        if self._select.strip() in {"*", "*, order_items(*)"} or relation_order_items:
            columns = f"{_ident(self.table_name)}.*"
        else:
            columns = ", ".join(_ident(part.strip()) for part in self._select.split(",") if part.strip())

        sql = f"select {columns} from {_ident(self.table_name)}"
        if where_sql:
            sql += f" where {where_sql}"
        if self._orders:
            order_parts = [
                f"{_ident(column)} {'desc' if desc else 'asc'}" for column, desc in self._orders
            ]
            sql += " order by " + ", ".join(order_parts)
        if self._limit is not None:
            params["_limit"] = self._limit
            sql += " limit %(_limit)s"

        rows = self.client.connection.execute(sql, params).fetchall()
        data = normalize(rows)

        if relation_order_items and data:
            self._attach_order_items(data)

        count = None
        if self._count_mode == "exact":
            count_sql = f"select count(*) as count from {_ident(self.table_name)}"
            count_params: dict[str, Any] = {}
            count_where = self._where_sql(count_params)
            if count_where:
                count_sql += f" where {count_where}"
            count_row = self.client.connection.execute(count_sql, count_params).fetchone()
            count = int(count_row["count"]) if count_row else 0

        return DbResponse(data=data, count=count)

    def _execute_insert(self) -> DbResponse:
        rows = self._payload if isinstance(self._payload, list) else [self._payload]
        if not rows:
            return DbResponse(data=[])
        if len(rows) == 1 or any(set(row) != set(rows[0]) for row in rows[1:]):
            return DbResponse(data=[self._insert_one(row, conflict_columns=None) for row in rows])

        inserted = []
        for index in range(0, len(rows), BATCH_INSERT_SIZE):
            inserted.extend(self._insert_many(rows[index:index + BATCH_INSERT_SIZE]))
        return DbResponse(data=inserted)

    def _insert_many(self, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
        columns = list(rows[0])
        params: dict[str, Any] = {}
        value_rows = []
        for row_index, row in enumerate(rows):
            placeholders = []
            for column in columns:
                key = f"row_{row_index}_{column}"
                params[key] = _adapt_value(column, row[column])
                placeholders.append(f"%({key})s")
            value_rows.append(f"({', '.join(placeholders)})")
        sql = (
            f"insert into {_ident(self.table_name)} "
            f"({', '.join(_ident(column) for column in columns)}) "
            f"values {', '.join(value_rows)} returning *"
        )
        return normalize(self.client.connection.execute(sql, params).fetchall())

    def _execute_upsert(self) -> DbResponse:
        conflict_columns = UPSERT_CONFLICTS.get(self.table_name)
        if not conflict_columns:
            raise HTTPException(status_code=500, detail=f"No upsert rule for {self.table_name}.")
        return DbResponse(data=[self._insert_one(self._payload, conflict_columns=conflict_columns)])

    def _insert_one(
        self,
        row: dict[str, Any],
        conflict_columns: tuple[str, ...] | None,
    ) -> dict[str, Any]:
        params = {key: _adapt_value(key, value) for key, value in row.items()}
        columns = list(params.keys())
        sql = (
            f"insert into {_ident(self.table_name)} "
            f"({', '.join(_ident(column) for column in columns)}) "
            f"values ({', '.join(f'%({column})s' for column in columns)})"
        )
        if conflict_columns:
            update_columns = [column for column in columns if column not in conflict_columns]
            if update_columns:
                assignments = ", ".join(
                    f"{_ident(column)} = excluded.{_ident(column)}" for column in update_columns
                )
                sql += (
                    f" on conflict ({', '.join(_ident(column) for column in conflict_columns)}) "
                    f"do update set {assignments}"
                )
            else:
                sql += f" on conflict ({', '.join(_ident(column) for column in conflict_columns)}) do nothing"
        sql += " returning *"
        result = self.client.connection.execute(sql, params).fetchone()
        return normalize(result)

    def _execute_update(self) -> DbResponse:
        data = {key: _adapt_value(key, value) for key, value in self._payload.items()}
        if not data:
            return DbResponse(data=[])
        params = dict(data)
        where_sql = self._where_sql(params)
        if not where_sql:
            raise HTTPException(status_code=400, detail="Refusing to update without a filter.")
        assignments = ", ".join(f"{_ident(key)} = %({key})s" for key in data)
        sql = f"update {_ident(self.table_name)} set {assignments} where {where_sql} returning *"
        rows = self.client.connection.execute(sql, params).fetchall()
        return DbResponse(data=normalize(rows))

    def _execute_delete(self) -> DbResponse:
        params: dict[str, Any] = {}
        where_sql = self._where_sql(params)
        if not where_sql:
            raise HTTPException(status_code=400, detail="Refusing to delete without a filter.")
        sql = f"delete from {_ident(self.table_name)} where {where_sql} returning *"
        rows = self.client.connection.execute(sql, params).fetchall()
        return DbResponse(data=normalize(rows))

    def _where_sql(self, params: dict[str, Any]) -> str:
        parts = []
        for index, (operator, column, value) in enumerate(self._filters):
            key = f"filter_{column}_{index}"
            if operator == "in":
                values = list(value or [])
                if not values:
                    parts.append("false")
                    continue
                placeholders = []
                for value_index, item in enumerate(values):
                    item_key = f"{key}_{value_index}"
                    params[item_key] = item
                    placeholders.append(f"%({item_key})s")
                parts.append(f"{_ident(column)} in ({', '.join(placeholders)})")
            else:
                params[key] = value
                parts.append(f"{_ident(column)} {operator} %({key})s")
        return " and ".join(parts)

    def _attach_order_items(self, orders: list[dict[str, Any]]) -> None:
        order_ids = [order["id"] for order in orders]
        if not order_ids:
            return
        placeholders = ", ".join(f"%(order_{index})s" for index, _ in enumerate(order_ids))
        params = {f"order_{index}": order_id for index, order_id in enumerate(order_ids)}
        rows = self.client.connection.execute(
            f"select * from order_items where order_id in ({placeholders}) order by created_at asc",
            params,
        ).fetchall()
        by_order = {order_id: [] for order_id in order_ids}
        for row in normalize(rows):
            by_order.setdefault(row["order_id"], []).append(row)
        for order in orders:
            order["order_items"] = by_order.get(order["id"], [])


class RpcQuery:
    def __init__(self, client: DbClient, name: str, params: dict[str, Any]):
        self.client = client
        self.name = name
        self.params = params

    def execute(self) -> DbResponse:
        if self.name != "next_order_number":
            raise HTTPException(status_code=500, detail=f"Unknown database function: {self.name}")
        business_id = self.params["p_business_id"]
        row = self.client.connection.execute(
            """
            insert into order_counters (business_id, counter_date, next_number)
            values (%(business_id)s, current_date, 2)
            on conflict (business_id, counter_date)
            do update set next_number = order_counters.next_number + 1
            returning next_number - 1 as order_number
            """,
            {"business_id": business_id},
        ).fetchone()
        return DbResponse(data=int(row["order_number"]))


def new_connection() -> Connection:
    settings = get_settings()
    # Supabase's transaction pooler does not support server-side prepared statements.
    return connect(settings.database_url, row_factory=dict_row, prepare_threshold=None)


def _safe_rollback(client: DbClient) -> None:
    connection = client.connection
    if connection.closed or connection.broken:
        return
    try:
        client.rollback()
    except Exception:
        pass


def _safe_close(client: DbClient) -> None:
    try:
        client.close()
    except Exception:
        pass


def _protect_transaction(client: DbClient) -> None:
    """Bound lock waits and abandoned transactions to one request lifetime."""
    client.connection.execute(f"set local lock_timeout = '{LOCK_TIMEOUT_MS}ms'")
    client.connection.execute(
        f"set local idle_in_transaction_session_timeout = '{IDLE_IN_TRANSACTION_TIMEOUT_MS}ms'"
    )


@contextmanager
def db_context() -> Generator[DbClient, None, None]:
    client = DbClient(new_connection())
    try:
        _protect_transaction(client)
        yield client
        client.commit()
    except Exception:
        _safe_rollback(client)
        raise
    finally:
        _safe_close(client)


def get_db_client() -> Generator[DbClient, None, None]:
    with db_context() as client:
        yield client
