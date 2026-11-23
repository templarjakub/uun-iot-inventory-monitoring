"""Simulated BIOT IoT Weighing Node (ESP32 + HX711 + Load Cells) communicating via MQTT."""

from __future__ import annotations

import argparse
import json
import logging
import signal
import threading
import time
from datetime import datetime, timezone
from typing import Any

import paho.mqtt.client as mqtt

from common.config import MQTTConfig, Topics
from common.models import (
    NodeCommandMessage,
    NodeMeasurementMessage,
    NodeStatusMessage,
    PayloadValidationError,
    utc_now_iso,
)
from node.load_cell import WeighingChannelConfig, WeighingChannelSimulator

logger = logging.getLogger("biot.node")


def default_uz001_channels(seed: int | None = 42) -> list[WeighingChannelSimulator]:
    """Build default channels matching the pre-seeded UZ-001 node in the BIOT backend."""
    configs = [
        # VM-001: PRD-001 Šroub M6 x 20 mm (unitWeight=6.0g, tare=100.0g, 30 pcs -> 280.0g)
        WeighingChannelConfig(
            source_id="UZ-001/V1",
            tare_weight_g=100.0,
            unit_weight_g=6.0,
            initial_pieces=30,
        ),
        # VM-002: PRD-001 Šroub M6 x 20 mm (unitWeight=6.0g, tare=100.0g, 10 pcs -> 160.0g)
        WeighingChannelConfig(
            source_id="UZ-001/V2",
            tare_weight_g=100.0,
            unit_weight_g=6.0,
            initial_pieces=10,
        ),
        # UZ-001/V3: spare channel ready for a third weighing point
        WeighingChannelConfig(
            source_id="UZ-001/V3",
            tare_weight_g=100.0,
            unit_weight_g=2.5,
            initial_pieces=20,
        ),
    ]
    return [
        WeighingChannelSimulator(cfg, seed=None if seed is None else seed + idx)
        for idx, cfg in enumerate(configs)
    ]


class BiotWeighingNode:
    """Multi-channel IoT weighing node publishing weight measurements over MQTT."""

    def __init__(
        self,
        node_id: str = "UZ-001",
        channels: list[WeighingChannelSimulator] | None = None,
        mqtt_config: MQTTConfig | None = None,
        interval_s: float = 5.0,
    ) -> None:
        self.node_id = node_id
        self.mqtt_config = mqtt_config or MQTTConfig()
        self.interval_s = max(0.2, float(interval_s))
        self.channels: dict[str, WeighingChannelSimulator] = {
            ch.source_id: ch for ch in (channels if channels is not None else default_uz001_channels())
        }

        self._seq = 0
        self._lock = threading.Lock()
        self._connected = threading.Event()
        self._stop_event = threading.Event()
        self._measure_now_event = threading.Event()
        self._thread: threading.Thread | None = None

        self._client = mqtt.Client(
            mqtt.CallbackAPIVersion.VERSION2,
            client_id=f"biot-node-{self.node_id}",
            protocol=mqtt.MQTTv311,
        )
        if self.mqtt_config.username:
            self._client.username_pw_set(self.mqtt_config.username, self.mqtt_config.password)

        # Last Will and Testament (LWT) marks node offline on unexpected disconnect
        will_payload = NodeStatusMessage(
            nodeId=self.node_id,
            status="offline",
            sourceIds=list(self.channels.keys()),
        ).to_json()
        self._client.will_set(
            Topics.node_status(self.node_id),
            payload=will_payload,
            qos=1,
            retain=True,
        )
        self._client.on_connect = self._on_connect
        self._client.on_disconnect = self._on_disconnect
        self._client.on_message = self._on_message

    @property
    def source_ids(self) -> list[str]:
        return list(self.channels.keys())

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
                "[%s] Connected to MQTT broker %s:%s (sources=%s)",
                self.node_id,
                self.mqtt_config.host,
                self.mqtt_config.port,
                self.source_ids,
            )
            client.subscribe(Topics.node_commands(self.node_id), qos=1)
            online = NodeStatusMessage(
                nodeId=self.node_id,
                status="online",
                sourceIds=self.source_ids,
            ).to_json()
            client.publish(Topics.node_status(self.node_id), online, qos=1, retain=True)
            self._connected.set()
        else:
            logger.error("[%s] MQTT connection failed: %s", self.node_id, reason_code)

    def _on_disconnect(
        self,
        client: mqtt.Client,
        userdata: Any,
        disconnect_flags: Any,
        reason_code: Any,
        properties: Any,
    ) -> None:
        self._connected.clear()
        logger.info("[%s] Disconnected from MQTT broker (reason=%s)", self.node_id, reason_code)

    def _on_message(self, client: mqtt.Client, userdata: Any, msg: mqtt.MQTTMessage) -> None:
        try:
            cmd = NodeCommandMessage.from_json(msg.payload)
        except PayloadValidationError as exc:
            logger.warning("[%s] Ignoring invalid command: %s", self.node_id, exc)
            return

        logger.info("[%s] Received command '%s' (params=%s)", self.node_id, cmd.command, cmd.params)
        ack: dict[str, Any] = {
            "nodeId": self.node_id,
            "requestId": cmd.requestId,
            "command": cmd.command,
            "timestamp": utc_now_iso(),
            "ok": True,
        }

        try:
            if cmd.command == "measure_now":
                self._measure_now_event.set()
                ack["detail"] = "immediate measurement scheduled"
            elif cmd.command == "set_interval":
                new_interval = float(cmd.params["intervalSeconds"])
                if new_interval < 0.2:
                    raise ValueError("intervalSeconds must be >= 0.2")
                with self._lock:
                    self.interval_s = new_interval
                ack["detail"] = f"interval updated to {new_interval}s"
            elif cmd.command == "set_pieces":
                src = str(cmd.params["sourceId"])
                pieces = int(cmd.params["pieces"])
                channel = self.channels.get(src)
                if channel is None:
                    raise KeyError(f"unknown sourceId '{src}'")
                with self._lock:
                    channel.set_pieces(pieces)
                self._measure_now_event.set()
                ack["detail"] = f"{src} set to {pieces} pieces (~{channel.expected_gross_weight_g}g)"
            elif cmd.command == "simulate_unstable":
                src = str(cmd.params["sourceId"])
                channel = self.channels.get(src)
                if channel is None:
                    raise KeyError(f"unknown sourceId '{src}'")
                with self._lock:
                    channel.trigger_unstable_once()
                self._measure_now_event.set()
                ack["detail"] = f"{src} will emit one unstable reading"
            elif cmd.command == "simulate_fault":
                src = str(cmd.params["sourceId"])
                channel = self.channels.get(src)
                if channel is None:
                    raise KeyError(f"unknown sourceId '{src}'")
                with self._lock:
                    channel.trigger_fault_once()
                self._measure_now_event.set()
                ack["detail"] = f"{src} will emit one invalid reading"
            else:
                ack["ok"] = False
                ack["detail"] = f"unsupported command: {cmd.command}"
        except (KeyError, TypeError, ValueError) as exc:
            ack["ok"] = False
            ack["detail"] = str(exc)

        client.publish(Topics.node_ack(self.node_id), json.dumps(ack, ensure_ascii=False), qos=1)

    # --- Measurement Publishing ---------------------------------------------

    def _next_measurement_id(self, source_id: str) -> str:
        with self._lock:
            self._seq += 1
            seq = self._seq
        stamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
        safe_src = source_id.replace("/", "-")
        return f"M-{stamp}-{safe_src}-{seq:04d}"

    def measure_and_publish_channel(self, source_id: str) -> NodeMeasurementMessage:
        """Read one load-cell channel and publish its measurement via MQTT (QoS 1)."""
        channel = self.channels[source_id]
        with self._lock:
            reading = channel.read()

        msg = NodeMeasurementMessage(
            nodeId=self.node_id,
            measurementId=self._next_measurement_id(source_id),
            sourceId=reading.source_id,
            measuredWeight=reading.measured_weight_g,
            measuredAt=utc_now_iso(),
            measurementQuality=reading.quality,
            sampleCount=reading.sample_count,
            sampleSpreadG=reading.sample_spread_g,
        )
        info = self._client.publish(Topics.node_measurement(self.node_id), msg.to_json(), qos=1)
        info.wait_for_publish(timeout=3.0)
        logger.info(
            "[%s] Published %s | source=%s weight=%.2fg quality=%s spread=%.3fg",
            self.node_id,
            msg.measurementId,
            msg.sourceId,
            msg.measuredWeight,
            msg.measurementQuality,
            msg.sampleSpreadG,
        )
        return msg

    def measure_and_publish_all(self) -> list[NodeMeasurementMessage]:
        """Sample all weighing channels attached to this node and publish measurements."""
        return [self.measure_and_publish_channel(src) for src in self.source_ids]

    # --- Lifecycle ----------------------------------------------------------

    def connect(self, timeout_s: float = 5.0) -> bool:
        self._client.connect(self.mqtt_config.host, self.mqtt_config.port, self.mqtt_config.keepalive)
        self._client.loop_start()
        return self._connected.wait(timeout=timeout_s)

    def start(self, max_cycles: int | None = None) -> None:
        if not self.connect():
            raise ConnectionError(
                f"Node '{self.node_id}' failed to connect to MQTT broker "
                f"{self.mqtt_config.host}:{self.mqtt_config.port}"
            )
        self._stop_event.clear()
        self._measure_now_event.clear()
        self._thread = threading.Thread(
            target=self._run_loop,
            args=(max_cycles,),
            name=f"biot-node-{self.node_id}",
            daemon=True,
        )
        self._thread.start()

    def _run_loop(self, max_cycles: int | None) -> None:
        cycles = 0
        while not self._stop_event.is_set():
            if self._connected.is_set():
                try:
                    self.measure_and_publish_all()
                    cycles += 1
                except Exception as exc:  # pragma: no cover - defensive runtime guard
                    logger.warning("[%s] Measurement cycle failed: %s", self.node_id, exc)
                if max_cycles is not None and cycles >= max_cycles:
                    self._stop_event.set()
                    break

            with self._lock:
                wait_s = self.interval_s
            triggered = self._measure_now_event.wait(timeout=wait_s)
            if triggered:
                self._measure_now_event.clear()

    def stop(self) -> None:
        self._stop_event.set()
        self._measure_now_event.set()
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=3.0)

        if self._connected.is_set():
            offline = NodeStatusMessage(
                nodeId=self.node_id,
                status="offline",
                sourceIds=self.source_ids,
            ).to_json()
            info = self._client.publish(Topics.node_status(self.node_id), offline, qos=1, retain=True)
            try:
                info.wait_for_publish(timeout=1.5)
            except Exception:
                pass

        self._client.disconnect()
        self._client.loop_stop()
        self._connected.clear()


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run a simulated BIOT IoT weighing node.")
    parser.add_argument("--node-id", default="UZ-001", help="Node identifier (e.g. UZ-001)")
    parser.add_argument("--broker-host", default="127.0.0.1", help="MQTT broker host")
    parser.add_argument("--broker-port", type=int, default=1883, help="MQTT broker port")
    parser.add_argument("--interval", type=float, default=5.0, help="Measurement interval in seconds")
    parser.add_argument("--cycles", type=int, default=None, help="Optional max measurement cycles")
    parser.add_argument(
        "--unstable-prob",
        type=float,
        default=0.05,
        help="Probability of simulated mechanical disturbance (unstable reading)",
    )
    parser.add_argument("--seed", type=int, default=42, help="RNG seed for reproducible readings")
    return parser.parse_args()


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)-7s [%(name)s] %(message)s",
    )
    args = _parse_args()
    channels = default_uz001_channels(seed=args.seed)
    if args.node_id != "UZ-001":
        channels = [
            WeighingChannelSimulator(
                WeighingChannelConfig(
                    source_id=f"{args.node_id}/V1",
                    tare_weight_g=100.0,
                    unit_weight_g=6.0,
                    initial_pieces=25,
                    unstable_probability=args.unstable_prob,
                ),
                seed=args.seed,
            )
        ]
    else:
        for ch in channels:
            ch.config.unstable_probability = args.unstable_prob

    node = BiotWeighingNode(
        node_id=args.node_id,
        channels=channels,
        mqtt_config=MQTTConfig(host=args.broker_host, port=args.broker_port),
        interval_s=args.interval,
    )

    stop_requested = threading.Event()

    def _handle_signal(signum: int, frame: Any) -> None:
        stop_requested.set()

    signal.signal(signal.SIGINT, _handle_signal)
    signal.signal(signal.SIGTERM, _handle_signal)

    node.start(max_cycles=args.cycles)
    try:
        while not stop_requested.is_set() and not node._stop_event.is_set():
            stop_requested.wait(timeout=0.3)
    finally:
        node.stop()


if __name__ == "__main__":
    main()
