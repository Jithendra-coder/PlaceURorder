from config import get_settings
from services import qr_service
from services.qr_service import destination_url, png, store_url, svg
from services.version_service import _domains


def test_qr_destination_points_customers_to_the_store_ordering_page(monkeypatch):
    monkeypatch.setenv("FRONTEND_BASE_URL", "https://app.placeurorder.test/")
    get_settings.cache_clear()
    try:
        assert store_url("demo") == "https://app.placeurorder.test/order/demo"
        assert destination_url({"slug": "demo"}, {"destination_type": "main_menu"}) == "https://app.placeurorder.test/order/demo"
        assert destination_url({"slug": "demo"}, {"destination_type": "takeaway"}) == "https://app.placeurorder.test/order/demo?order_type=takeaway"
        assert destination_url({"slug": "demo"}, {"destination_type": "table", "table_token": "T 4"}) == "https://app.placeurorder.test/order/demo?table=T%204"
    finally:
        get_settings.cache_clear()


def test_qr_codes_are_real_scannable_matrices_with_quiet_zone():
    url = "https://app.placeurorder.test/order/demo"
    matrix = qr_service._qr(url, box_size=1).get_matrix()
    # Quiet zone of four modules around the code, then the top-left finder pattern starts at (4, 4).
    assert all(not bit for bit in matrix[0]) and all(not row[0] for row in matrix)
    assert matrix[4][4] and matrix[4][10] and matrix[10][4]
    assert len(matrix) == len(matrix[0]) >= 33


def test_qr_outputs_are_svg_and_png():
    assert svg("https://example.test/order/demo").startswith(b"<svg")
    assert png("https://example.test/order/demo").startswith(b"\x89PNG")


def test_version_comparison_is_domain_grouped():
    left = {"business": {"name": "new"}, "products": [{"id": "p1", "name": "new"}]}
    right = {"business": {"name": "old"}, "products": [{"id": "p1", "name": "old"}]}
    domains = {row["key"]: row["changed"] for row in _domains(left, right)}
    assert domains["business"] == 1
    assert domains["products"] == 1
