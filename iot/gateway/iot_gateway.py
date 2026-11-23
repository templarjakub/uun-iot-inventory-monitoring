"""BIOT IoT Gateway (BR-xxx): MQTT ingestion, SQLite retention queue, and REST forwarding."""

from __future__ import annotations

import argparse
import json
import logging
import signal
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import paho.mqtt.client as mqtt

from common.config import BackendConfig, MQTTConfig, Topics
from common.models import (
    NodeCommandMessage,
    NodeMeasurementMessage,
    NodeStatusMessage,
    PayloadValidationError,
    utc_now_iso,
)
from gateway.backend_client import (
    BiotBackendClient,
    PermanentBackendError,
    RetryableBackendError,
)
from gateway.queue_db import MeasurementQueueDB

logger = logging.getLogger("biot.gateway")


@dataclass
class TrackedNode:
    """Runtime status of an IoT weighing node connected to this gateway."""

    node_id: str
    status: str = "unknown"
    source_ids: list[str] = field(default_factory=list)
    last_seen_at: str = ""
    measurements_received: int = 0


class BiotGateway:
    """IoT Gateway bridging local MQTT weighing nodes to the BIOT NestJS Cloud Backend.

    Responsibilities (BIOT – Tým 4):
    - Subscribe to weight measurements from connected IoT nodes (`biot/nodes/+/measurement`)
    - Validate incoming payloads and track node presence (`biot/nodes/+/status`)
    - Persist every measurement in a local SQLite retention queue (`MeasurementQueueDB`)
    - Forward queued measurements to `POST /measurement/ingest` (`x-uu-profile: Gateways`)
    - Retry idempotently via `measurementId` after backend/network outages until acknowledged
    """

    def __init__(
        self,
        gateway_id: str = "BR-001",
        gateway_name: str = "Brána skladu dílny",
        mqtt_config: MQTTConfig | None = None,
        backend_config: BackendConfig | None = None,
        db_path: str | Path = "biot_gateway_queue.db",
        forward_interval_s: float = 1.0,
        retry_backoff_s: float = 2.0,
        batch_limit: int = 20,
    ) -> None:
        self.gateway_id = gateway_id
        self.gateway_name = gateway_name
        self.mqtt_config = mqtt_config or MQTTConfig()
        self.backend_config = backend_config or BackendConfig()
        self.forward_interval_s = max(0.1, float(forward_interval_s))
        self.retry_backoff_s = max(0.1, float(retry_backoff_s))
        self.batch_limit = max(1, int(batch_limit))

        self.queue = MeasurementQueueDB(db_path=db_path)
        self.backend = BiotBackendClient(self.backend_config)

        self._lock = threading.Lock()
        self._forward_lock = threading.Lock()
        self._nodes: dict[str, TrackedNode] = {}
        self.invalid_message_count = 0

        self._connected = threading.Event()
        self._stop_event = threading.Event()
        self._wake_forwarder = threading.Event()
        self._forward_thread: threading.Thread | None = None

        self._client = mqtt.Client(
            mqtt.CallbackAPIVersion.VERSION2,
            client_id=f"biot-gateway-{self.gateway_id}",
            protocol=mqtt.MQTTv311,
        )
        if self.mqtt_config.username:
            self._client.username_pw_set(self.mqtt_config.username, self.mqtt_config.password)

        will = NodeStatusMessage(nodeId=self.gateway_id, status="offline").to_json()
        self._client.will_set(Topics.gateway_status(self.gateway_id), will, qos=1, retain=True)
        self._client.on_connect = self._on_connect
        self._client.on_disconnect = self._on_disconnect
        self._client.on_message = self._on_message

    def get_nodes(self) -> dict[str, TrackedNode]:
        with self._lock:
            return dict(self._nodes)

    # --- MQTT Callbacks -----------------------------------------------------

    def _on_connect(
        self,
        client: mqtt.Client,
        userdata: Any,
        flags: Any,
        reason_code: Any,
        properties: Any,
    ) -> None:
        if reason_code == 0 or not getattr(reason_code, "is_failure", False):
            logger.info(
                "[%s] Connected to MQTT broker %s:%s (backend=%s)",
                self.gateway_id,
                self.mqtt_config.host,
                self.mqtt_config.port,
                self.backend_config.base_url,
            )
            client.subscribe(
                [
                    (Topics.NODE_MEASUREMENT_WILDCARD, 1),
                    (Topics.NODE_STATUS_WILDCARD, 1),
                    (Topics.NODE_ACK_WILDCARD, 1),
                ]
            )
            online = NodeStatusMessage(nodeId=self.gateway_id, status="online").to_json()
            client.publish(Topics.gateway_status(self.gateway_id), online, qos=1, retain=True)
            self._connected.set()
        else:
            logger.error("[%s] MQTT connection failed: %s", self.gateway_id, reason_code)

    def _on_disconnect(
        self,
        client: mqtt.Client,
        userdata: Any,
        disconnect_flags: Any,
        reason_code: Any,
        properties: Any,
    ) -> None:
        self._connected.clear()
        logger.info("[%s] Disconnected from MQTT broker (reason=%s)", self.gateway_id, reason_code)

    def _on_message(self, client: mqtt.Client, userdata: Any, msg: mqtt.MQTTMessage) -> None:
        parts = msg.topic.split("/")
        if len(parts) != 4 or parts[0] != "biot" or parts[1] != "nodes":
            return

        topic_node_id, kind = parts[2], parts[3]
        if kind == "measurement":
            self._handle_measurement(topic_node_id, msg.payload)
        elif kind == "status":
            self._handle_node_status(topic_node_id, msg.payload)
        elif kind == "ack":
            logger.info(
                "[%s] Node '%s' ACK: %s",
                self.gateway_id,
                topic_node_id,
                msg.payload.decode("utf-8", errors="replace"),
            )

    def _handle_measurement(self, topic_node_id: str, raw_payload: bytes) -> None:
        try:
            measurement = NodeMeasurementMessage.from_json(raw_payload)
        except PayloadValidationError as exc:
            with self._lock:
                self.invalid_message_count += 1
            logger.warning("[%s] Dropped invalid measurement from '%s': %s", self.gateway_id, topic_node_id, exc)
            return

        if measurement.nodeId != topic_node_id:
            with self._lock:
                self.invalid_message_count += 1
            logger.warning(
                "[%s] Dropped measurement with mismatched nodeId (topic='%s', payload='%s')",
                self.gateway_id,
                topic_node_id,
                measurement.nodeId,
            )
            return

        now_iso = utc_now_iso()
        with self._lock:
            node = self._nodes.setdefault(measurement.nodeId, TrackedNode(node_id=measurement.nodeId))
            node.status = "online"
            node.last_seen_at = now_iso
            node.measurements_received += 1
            if measurement.sourceId not in node.source_ids:
                node.source_ids.append(measurement.sourceId)

        inserted = self.queue.enqueue(measurement, received_at=now_iso)
        if inserted:
            logger.info(
                "[%s] Queued %s (source=%s weight=%.2fg quality=%s)",
                self.gateway_id,
                measurement.measurementId,
                measurement.sourceId,
                measurement.measuredWeight,
                measurement.measurementQuality,
            )
            self._wake_forwarder.set()

    def _handle_node_status(self, topic_node_id: str, raw_payload: bytes) -> None:
        try:
            data = json.loads(raw_payload.decode("utf-8"))
            status = str(data.get("status", "unknown"))
            sources = list(data.get("sourceIds") or [])
        except (UnicodeDecodeError, json.JSONDecodeError, TypeError, ValueError):
            status = "unknown"
            sources = []

        with self._lock:
            node = self._nodes.setdefault(topic_node_id, TrackedNode(node_id=topic_node_id))
            node.status = status
            node.last_seen_at = utc_now_iso()
            if sources:
                node.source_ids = sources

        logger.info("[%s] Node '%s' status -> %s", self.gateway_id, topic_node_id, status)

    # --- Backend Forwarding & Downlink --------------------------------------

    def send_node_command(
        self,
        node_id: str,
        command: str,
        params: dict[str, Any] | None = None,
        request_id: str = "",
    ) -> None:
        """Publish a downlink command to a weighing node over MQTT."""
        payload = NodeCommandMessage(
            command=command,
            params=params or {},
            requestId=request_id,
        )
        self._client.publish(Topics.node_commands(node_id), payload.to_json(), qos=1)

    def bootstrap_with_backend(
        self,
        nodes: list[tuple[str, str, list[str]]] | None = None,
    ) -> None:
        """Optionally register this gateway (BUC-07) and connect nodes (BUC-08) in the backend."""
        res = self.backend.register_gateway(self.gateway_id, self.gateway_name)
        logger.info("[%s] Backend gateway/register -> %s", self.gateway_id, res.get("authorizationStatus"))
        for node_id, node_name, source_ids in nodes or []:
            node_res = self.backend.connect_node(node_id, node_name, self.gateway_id, source_ids)
            logger.info(
                "[%s] Backend iotNode/connect (%s) -> status=%s",
                self.gateway_id,
                node_id,
                node_res.get("measurementStatus"),
            )

    def forward_pending(self) -> int:
        """Drain pending measurements from SQLite to `POST /measurement/ingest`.

        Stops immediately on transient backend/network failure so FIFO order is preserved
        and retries occur after backoff.
        """
        forwarded = 0
        with self._forward_lock:
            pending = self.queue.fetch_pending(limit=self.batch_limit)
            for item in pending:
                dto_in = item.to_ingest_dto(self.gateway_id)
                try:
                    resp = self.backend.ingest_measurement(dto_in)
                except RetryableBackendError as exc:
                    self.queue.mark_retry(item.measurement_id, str(exc))
                    logger.warning(
                        "[%s] Backend unreachable for %s (retry #%d): %s — keeping in SQLite queue",
                        self.gateway_id,
                        item.measurement_id,
                        item.retry_count + 1,
                        exc,
                    )
                    break
                except PermanentBackendError as exc:
                    self.queue.mark_rejected(item.measurement_id, str(exc))
                    logger.error(
                        "[%s] Backend permanently rejected %s: %s",
                        self.gateway_id,
                        item.measurement_id,
                        exc,
                    )
                    continue

                if resp.get("deliveryState") == "acknowledged":
                    self.queue.mark_acknowledged(item.measurement_id, resp)
                    forwarded += 1
                    logger.info(
                        "[%s] Delivered %s -> wp=%s stockEstimate=%s status=%s",
                        self.gateway_id,
                        item.measurement_id,
                        resp.get("weighingPointId"),
                        resp.get("stockEstimate"),
                        resp.get("measurementStatus"),
                    )
                else:
                    self.queue.mark_retry(item.measurement_id, f"Unexpected response: {resp}")
                    break
        return forwarded

    # --- Lifecycle ----------------------------------------------------------

    def start(self, timeout_s: float = 5.0) -> None:
        self._client.connect(self.mqtt_config.host, self.mqtt_config.port, self.mqtt_config.keepalive)
        self._client.loop_start()
        if not self._connected.wait(timeout=timeout_s):
            self.stop()
            raise ConnectionError(
                f"Gateway '{self.gateway_id}' failed to connect to MQTT broker "
                f"{self.mqtt_config.host}:{self.mqtt_config.port}"
            )

        self._stop_event.clear()
        self._wake_forwarder.set()  # Immediately drain any leftover items persisted from prior run
        self._forward_thread = threading.Thread(
            target=self._forward_loop,
            name=f"biot-gateway-fwd-{self.gateway_id}",
            daemon=True,
        )
        self._forward_thread.start()

    def _forward_loop(self) -> None:
        while not self._stop_event.is_set():
            self._wake_forwarder.wait(timeout=self.forward_interval_s)
            self._wake_forwarder.clear()
            if self._stop_event.is_set():
                break

            try:
                before_pending = self.queue.stats()["pending"]
                sent = self.forward_pending()
                after_pending = self.queue.stats()["pending"]
                # If items failed due to backend outage, wait backoff before next attempt
                if before_pending > 0 and sent == 0 and after_pending > 0:
                    self._stop_event.wait(timeout=self.retry_backoff_s)
                elif after_pending > 0:
                    self._wake_forwarder.set()
            except Exception as exc:  # pragma: no cover - defensive runtime guard
                logger.warning("[%s] Forward loop error: %s", self.gateway_id, exc)
                self._stop_event.wait(timeout=self.retry_backoff_s)

    def stop(self) -> None:
        self._stop_event.set()
        self._wake_forwarder.set()
        if self._forward_thread and self._forward_thread.is_alive():
            self._forward_thread.join(timeout=3.0)

        if self._connected.is_set():
            offline = NodeStatusMessage(nodeId=self.gateway_id, status="offline").to_json()
            info = self._client.publish(Topics.gateway_status(self.gateway_id), offline, qos=1, retain=True)
            try:
                info.wait_for_publish(timeout=1.5)
            except Exception:
                pass

        self._client.disconnect()
        self._client.loop_stop()
        self._connected.clear()
        self.queue.close()


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the BIOT IoT Gateway (BR-xxx).")
    parser.add_argument("--gateway-id", default="BR-001", help="Registered gatewayId (default: BR-001)")
    parser.add_argument("--gateway-name", default="Brána skladu dílny", help="Human-readable gateway name")
    parser.add_argument("--broker-host", default="127.0.0.1", help="Local MQTT broker host")
    parser.add_argument("--broker-port", type=int, default=1883, help="Local MQTT broker port")
    parser.add_argument("--backend-url", default="http://127.0.0.1:3000", help="BIOT NestJS backend base URL")
    parser.add_argument("--backend-timeout", type=float, default=15.0, help="HTTP timeout in seconds (increase for Render cold starts)")
    parser.add_argument("--db-path", default="biot_gateway_queue.db", help="SQLite retention queue DB path")
    parser.add_argument("--forward-interval", type=float, default=1.0, help="Queue poll interval (s)")
    parser.add_argument("--retry-backoff", type=float, default=2.0, help="Retry delay after backend outage (s)")
    parser.add_argument(
        "--bootstrap",
        action="store_true",
        help="Register gateway with backend on startup via POST /gateway/register",
    )
    return parser.parse_args()


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)-7s [%(name)s] %(message)s",
    )
    args = _parse_args()
    gateway = BiotGateway(
        gateway_id=args.gateway_id,
        gateway_name=args.gateway_name,
        mqtt_config=MQTTConfig(host=args.broker_host, port=args.broker_port),
        backend_config=BackendConfig(base_url=args.backend_url, timeout_s=args.backend_timeout),
        db_path=args.db_path,
        forward_interval_s=args.forward_interval,
        retry_backoff_s=args.retry_backoff,
    )

    if args.bootstrap:
        gateway.bootstrap_with_backend()

    stop_requested = threading.Event()

    def _handle_signal(signum: int, frame: Any) -> None:
        stop_requested.set()

    signal.signal(signal.SIGINT, _handle_signal)
    signal.signal(signal.SIGTERM, _handle_signal)

    gateway.start()
    try:
        while not stop_requested.is_set():
            stop_requested.wait(timeout=0.3)
    finally:
        gateway.stop()


if __name__ == "__main__":
    main()
