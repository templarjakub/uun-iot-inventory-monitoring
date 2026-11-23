"""Configuration and MQTT topic definitions for BIOT IoT Inventory Monitoring."""

from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class MQTTConfig:
    """MQTT broker connection settings (local node <-> gateway bus)."""

    host: str = os.getenv("MQTT_HOST", "127.0.0.1")
    port: int = int(os.getenv("MQTT_PORT", "1883"))
    keepalive: int = int(os.getenv("MQTT_KEEPALIVE", "30"))
    username: str | None = os.getenv("MQTT_USERNAME") or None
    password: str | None = os.getenv("MQTT_PASSWORD") or None


@dataclass(frozen=True)
class BackendConfig:
    """HTTP settings for the BIOT NestJS uuApp Cloud Backend."""

    base_url: str = os.getenv("BACKEND_URL", "http://127.0.0.1:3000").rstrip("/")
    timeout_s: float = float(os.getenv("BACKEND_TIMEOUT_S", "5.0"))
    gateway_profile: str = os.getenv("BACKEND_GATEWAY_PROFILE", "Gateways")
    authority_profile: str = os.getenv("BACKEND_AUTHORITY_PROFILE", "Authorities")


class Topics:
    """Canonical MQTT topics between IoT Nodes (UZ-xxx) and IoT Gateway (BR-xxx)."""

    NODE_MEASUREMENT_WILDCARD = "biot/nodes/+/measurement"
    NODE_STATUS_WILDCARD = "biot/nodes/+/status"
    NODE_ACK_WILDCARD = "biot/nodes/+/ack"

    @staticmethod
    def node_measurement(node_id: str) -> str:
        return f"biot/nodes/{node_id}/measurement"

    @staticmethod
    def node_status(node_id: str) -> str:
        return f"biot/nodes/{node_id}/status"

    @staticmethod
    def node_commands(node_id: str) -> str:
        return f"biot/nodes/{node_id}/commands"

    @staticmethod
    def node_ack(node_id: str) -> str:
        return f"biot/nodes/{node_id}/ack"

    @staticmethod
    def gateway_status(gateway_id: str) -> str:
        return f"biot/gateways/{gateway_id}/status"
