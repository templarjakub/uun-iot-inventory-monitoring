"""Data models aligned 1:1 with the BIOT NestJS backend DTOs and schemas."""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any, Literal

MeasurementQuality = Literal["validAndStable", "unstable", "invalid"]
VALID_QUALITIES = {"validAndStable", "unstable", "invalid"}


def utc_now_iso() -> str:
    """Return current UTC timestamp in ISO-8601 format with millisecond precision."""
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


class PayloadValidationError(ValueError):
    """Raised when an MQTT message fails BIOT schema validation."""


@dataclass(frozen=True)
class NodeMeasurementMessage:
    """Weight measurement published by an IoT weighing node (e.g. UZ-001/V1).

    Matches the backend's `MeasurementIngestDtoIn` fields (plus `nodeId` for gateway routing).
    """

    nodeId: str
    measurementId: str
    sourceId: str
    measuredWeight: float
    measuredAt: str
    measurementQuality: MeasurementQuality
    sampleCount: int = 5
    sampleSpreadG: float = 0.0

    def to_json(self) -> str:
        return json.dumps(asdict(self), ensure_ascii=False)

    def to_ingest_dto(self, gateway_id: str) -> dict[str, Any]:
        """Convert to exact `MeasurementIngestDtoIn` payload expected by POST /measurement/ingest."""
        return {
            "gatewayId": gateway_id,
            "measurementId": self.measurementId,
            "sourceId": self.sourceId,
            "measuredWeight": self.measuredWeight,
            "measuredAt": self.measuredAt,
            "measurementQuality": self.measurementQuality,
        }

    @classmethod
    def from_json(cls, raw: str | bytes) -> NodeMeasurementMessage:
        try:
            data = json.loads(raw.decode("utf-8") if isinstance(raw, bytes) else raw)
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise PayloadValidationError(f"Invalid JSON: {exc}") from exc

        if not isinstance(data, dict):
            raise PayloadValidationError("Measurement payload must be a JSON object")

        required = (
            "nodeId",
            "measurementId",
            "sourceId",
            "measuredWeight",
            "measuredAt",
            "measurementQuality",
        )
        for key in required:
            if key not in data:
                raise PayloadValidationError(f"Missing required field: '{key}'")

        try:
            node_id = str(data["nodeId"]).strip()
            measurement_id = str(data["measurementId"]).strip()
            source_id = str(data["sourceId"]).strip()
            measured_weight = float(data["measuredWeight"])
            measured_at = str(data["measuredAt"]).strip()
            quality = str(data["measurementQuality"]).strip()
            sample_count = int(data.get("sampleCount", 5))
            sample_spread = float(data.get("sampleSpreadG", 0.0))
        except (TypeError, ValueError) as exc:
            raise PayloadValidationError(f"Invalid field value: {exc}") from exc

        if not node_id or not measurement_id or not source_id or not measured_at:
            raise PayloadValidationError("Identifier and timestamp fields must be non-empty")
        if quality not in VALID_QUALITIES:
            raise PayloadValidationError(
                f"Invalid measurementQuality '{quality}'; expected one of {sorted(VALID_QUALITIES)}"
            )

        return cls(
            nodeId=node_id,
            measurementId=measurement_id,
            sourceId=source_id,
            measuredWeight=round(measured_weight, 2),
            measuredAt=measured_at,
            measurementQuality=quality,  # type: ignore[arg-type]
            sampleCount=sample_count,
            sampleSpreadG=round(sample_spread, 3),
        )


@dataclass(frozen=True)
class NodeStatusMessage:
    """Presence payload published on connect and via MQTT Last Will (LWT)."""

    nodeId: str
    status: str  # "online" | "offline"
    sourceIds: list[str] = field(default_factory=list)
    timestamp: str = field(default_factory=utc_now_iso)

    def to_json(self) -> str:
        return json.dumps(asdict(self), ensure_ascii=False)


@dataclass(frozen=True)
class NodeCommandMessage:
    """Downlink command sent to an IoT weighing node."""

    command: str  # "measure_now" | "set_interval" | "set_pieces" | "simulate_unstable" | "simulate_fault"
    params: dict[str, Any] = field(default_factory=dict)
    requestId: str = ""
    timestamp: str = field(default_factory=utc_now_iso)

    def to_json(self) -> str:
        return json.dumps(asdict(self), ensure_ascii=False)

    @classmethod
    def from_json(cls, raw: str | bytes) -> NodeCommandMessage:
        try:
            data = json.loads(raw.decode("utf-8") if isinstance(raw, bytes) else raw)
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise PayloadValidationError(f"Invalid command JSON: {exc}") from exc

        if not isinstance(data, dict) or not data.get("command"):
            raise PayloadValidationError("Command payload must be an object with 'command'")

        return cls(
            command=str(data["command"]).strip(),
            params=dict(data.get("params") or {}),
            requestId=str(data.get("requestId", "")),
            timestamp=str(data.get("timestamp", utc_now_iso())),
        )
