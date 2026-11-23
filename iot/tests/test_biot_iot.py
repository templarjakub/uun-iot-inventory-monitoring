"""Unit and integration tests for BIOT IoT Node (UZ-xxx) and Gateway (BR-xxx)."""

from __future__ import annotations

import http.server
import json
import threading
import time
from pathlib import Path
from typing import Any

import pytest

from broker.local_broker import ThreadedMQTTBroker, topic_matches
from common.config import BackendConfig, MQTTConfig
from common.models import NodeMeasurementMessage, PayloadValidationError
from gateway.iot_gateway import BiotGateway
from gateway.queue_db import MeasurementQueueDB
from node.iot_node import BiotWeighingNode, default_uz001_channels
from node.load_cell import WeighingChannelConfig, WeighingChannelSimulator


def _wait_until(predicate: Any, timeout_s: float = 5.0, poll_s: float = 0.05) -> bool:
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(poll_s)
    return False


class _MockBiotBackend:
    """Lightweight HTTP server mimicking NestJS POST /measurement/ingest (with outage toggle)."""

    def __init__(self) -> None:
        self.online = True
        self.received: list[dict[str, Any]] = []
        self.headers_seen: list[str | None] = []
        self._seen_ids: set[str] = set()
        self._lock = threading.Lock()

        backend = self

        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self, format: str, *args: Any) -> None:  # noqa: A002
                return

            def do_GET(self) -> None:  # noqa: N802
                with backend._lock:
                    if not backend.online:
                        self.send_response(503)
                        self.end_headers()
                        return
                    if self.path == "/health":
                        out = json.dumps(
                            {
                                "status": "ok",
                                "service": "biot-inventory-backend",
                                "storage": "mongodb",
                                "connected": True,
                            }
                        ).encode("utf-8")
                        self.send_response(200)
                        self.send_header("Content-Type", "application/json")
                        self.end_headers()
                        self.wfile.write(out)
                        return
                self.send_response(404)
                self.end_headers()

            def do_POST(self) -> None:  # noqa: N802
                length = int(self.headers.get("Content-Length", "0"))
                raw = self.rfile.read(length).decode("utf-8")
                body = json.loads(raw)

                with backend._lock:
                    if not backend.online:
                        self.send_response(503)
                        self.send_header("Content-Type", "application/json")
                        self.end_headers()
                        self.wfile.write(b'{"error": "service unavailable"}')
                        return

                    if self.path == "/measurement/ingest":
                        backend.headers_seen.append(self.headers.get("x-uu-profile"))
                        if body["sourceId"] == "UNAUTHORIZED/V9":
                            self.send_response(403)
                            self.send_header("Content-Type", "application/json")
                            self.end_headers()
                            self.wfile.write(b'{"uuAppErrorMap": {"measurement/ingest/unauthorizedGatewayOrSource": {}}}')
                            return

                        mid = body["measurementId"]
                        if mid not in backend._seen_ids:
                            backend._seen_ids.add(mid)
                            backend.received.append(body)

                        resp = {
                            "measurementId": mid,
                            "gatewayId": body["gatewayId"],
                            "sourceId": body["sourceId"],
                            "weighingPointId": "VM-001",
                            "measuredAt": body["measuredAt"],
                            "receivedAt": "2026-11-22T12:00:00.000Z",
                            "authorizationStatus": "verified",
                            "deliveryState": "acknowledged",
                            "stockEstimate": 30,
                            "measurementStatus": "current",
                            "uuAppErrorMap": {},
                        }
                        out = json.dumps(resp).encode("utf-8")
                        self.send_response(200)
                        self.send_header("Content-Type", "application/json")
                        self.end_headers()
                        self.wfile.write(out)
                        return

                self.send_response(404)
                self.end_headers()

        self._server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.port = self._server.server_address[1]
        self.base_url = f"http://127.0.0.1:{self.port}"
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._server.shutdown()
        self._server.server_close()


# --- Unit Tests -------------------------------------------------------------


def test_load_cell_quality_classification() -> None:
    sim = WeighingChannelSimulator(
        WeighingChannelConfig(
            source_id="UZ-001/V1",
            tare_weight_g=100.0,
            unit_weight_g=6.0,
            initial_pieces=30,
            noise_std_g=0.1,
            stability_threshold_g=1.5,
        ),
        seed=10,
    )
    stable = sim.read()
    assert stable.quality == "validAndStable"
    assert abs(stable.measured_weight_g - 280.0) < 1.0

    sim.trigger_unstable_once()
    unstable = sim.read()
    assert unstable.quality == "unstable"
    assert unstable.sample_spread_g > 1.5

    sim.trigger_fault_once()
    invalid = sim.read()
    assert invalid.quality == "invalid"


def test_measurement_payload_validation() -> None:
    msg = NodeMeasurementMessage(
        nodeId="UZ-001",
        measurementId="M-20261122-UZ001-V1-0001",
        sourceId="UZ-001/V1",
        measuredWeight=280.0,
        measuredAt="2026-11-22T12:00:00.000Z",
        measurementQuality="validAndStable",
    )
    parsed = NodeMeasurementMessage.from_json(msg.to_json())
    assert parsed.sourceId == "UZ-001/V1"
    dto = parsed.to_ingest_dto("BR-001")
    assert set(dto.keys()) == {
        "gatewayId",
        "measurementId",
        "sourceId",
        "measuredWeight",
        "measuredAt",
        "measurementQuality",
    }

    with pytest.raises(PayloadValidationError):
        NodeMeasurementMessage.from_json(json.dumps({"nodeId": "UZ-001"}))

    bad_quality = json.loads(msg.to_json())
    bad_quality["measurementQuality"] = "brokenStatus"
    with pytest.raises(PayloadValidationError):
        NodeMeasurementMessage.from_json(json.dumps(bad_quality))


def test_sqlite_queue_persistence_and_idempotency(tmp_path: Path) -> None:
    db_file = tmp_path / "queue.db"
    msg = NodeMeasurementMessage(
        nodeId="UZ-001",
        measurementId="M-TEST-001",
        sourceId="UZ-001/V1",
        measuredWeight=280.0,
        measuredAt="2026-11-22T12:00:00.000Z",
        measurementQuality="validAndStable",
    )
    q = MeasurementQueueDB(db_file)
    try:
        assert q.enqueue(msg) is True
        # Duplicate measurementId is ignored cleanly
        assert q.enqueue(msg) is False
        assert q.stats()["pending"] == 1
    finally:
        q.close()

    q2 = MeasurementQueueDB(db_file)
    try:
        items = q2.fetch_pending()
        assert len(items) == 1
        assert items[0].measurement_id == "M-TEST-001"
        q2.mark_acknowledged("M-TEST-001", {"deliveryState": "acknowledged"})
        assert q2.stats() == {"pending": 0, "acknowledged": 1, "rejected": 0, "total": 1}
    finally:
        q2.close()


def test_topic_matching() -> None:
    assert topic_matches("biot/nodes/+/measurement", "biot/nodes/UZ-001/measurement")
    assert not topic_matches("biot/nodes/+/measurement", "biot/nodes/UZ-001/status")


# --- Integration Tests ------------------------------------------------------


def test_end_to_end_mqtt_gateway_to_backend_with_outage_recovery(tmp_path: Path) -> None:
    broker = ThreadedMQTTBroker(host="127.0.0.1", port=0)
    broker.start()
    backend = _MockBiotBackend()

    mqtt_cfg = MQTTConfig(host=broker.host, port=broker.port)
    backend_cfg = BackendConfig(base_url=backend.base_url)

    gateway = BiotGateway(
        gateway_id="BR-001",
        mqtt_config=mqtt_cfg,
        backend_config=backend_cfg,
        db_path=tmp_path / "gw.db",
        forward_interval_s=0.15,
        retry_backoff_s=0.2,
    )
    node = BiotWeighingNode(
        node_id="UZ-001",
        channels=default_uz001_channels(seed=7),
        mqtt_config=mqtt_cfg,
        interval_s=60.0,
    )

    try:
        health = gateway.backend.check_health()
        assert health["status"] == "ok"
        assert health["storage"] == "mongodb"

        gateway.start()
        assert node.connect()

        # 1. Normal online delivery (3 channels on UZ-001)
        node.measure_and_publish_all()
        assert _wait_until(lambda: gateway.queue.stats()["acknowledged"] == 3)
        assert gateway.queue.stats()["pending"] == 0
        assert len(backend.received) == 3
        assert all(h == "Gateways" for h in backend.headers_seen)
        assert {r["sourceId"] for r in backend.received} == {"UZ-001/V1", "UZ-001/V2", "UZ-001/V3"}

        # 2. Simulate backend outage -> gateway buffers measurements in SQLite
        backend.online = False
        m_offline_1 = node.measure_and_publish_channel("UZ-001/V1")
        m_offline_2 = node.measure_and_publish_channel("UZ-001/V2")

        assert _wait_until(lambda: gateway.queue.stats()["pending"] == 2)
        time.sleep(0.3)
        assert gateway.queue.stats()["pending"] == 2
        assert len(backend.received) == 3  # Nothing lost, nothing delivered while offline

        # 3. Backend recovers -> gateway automatically drains SQLite queue in FIFO order
        backend.online = True
        assert _wait_until(lambda: gateway.queue.stats()["acknowledged"] == 5, timeout_s=5.0)
        assert gateway.queue.stats()["pending"] == 0
        delivered_ids = [r["measurementId"] for r in backend.received]
        assert delivered_ids[-2:] == [m_offline_1.measurementId, m_offline_2.measurementId]

        # 4. Downlink command updates pieces on UZ-001/V1
        gateway.send_node_command(
            "UZ-001",
            "set_pieces",
            params={"sourceId": "UZ-001/V1", "pieces": 50},
            request_id="req-99",
        )
        assert _wait_until(lambda: node.channels["UZ-001/V1"].piece_count == 50)
    finally:
        node.stop()
        gateway.stop()
        broker.stop()
        backend.stop()
