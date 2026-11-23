"""Thread-safe SQLite store-and-forward retention queue for BIOT Gateway (BR-xxx)."""

from __future__ import annotations

import json
import sqlite3
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from common.models import NodeMeasurementMessage, utc_now_iso


@dataclass(frozen=True)
class QueuedMeasurement:
    """One measurement stored in the gateway's local SQLite retention queue."""

    row_id: int
    measurement_id: str
    node_id: str
    source_id: str
    measured_weight: float
    measured_at: str
    measurement_quality: str
    received_at: str
    retry_count: int

    def to_ingest_dto(self, gateway_id: str) -> dict[str, Any]:
        return {
            "gatewayId": gateway_id,
            "measurementId": self.measurement_id,
            "sourceId": self.source_id,
            "measuredWeight": self.measured_weight,
            "measuredAt": self.measured_at,
            "measurementQuality": self.measurement_quality,
        }


class MeasurementQueueDB:
    """Persistent SQLite retention queue ensuring zero measurement loss during outages."""

    def __init__(self, db_path: str | Path = "biot_gateway_queue.db") -> None:
        self._db_path = str(db_path)
        self._lock = threading.Lock()
        self._conn = sqlite3.connect(self._db_path, check_same_thread=False)
        self._conn.execute("PRAGMA journal_mode=WAL;")
        self._conn.execute(
            """
            CREATE TABLE IF NOT EXISTS measurement_queue (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                measurement_id TEXT NOT NULL UNIQUE,
                node_id TEXT NOT NULL,
                source_id TEXT NOT NULL,
                measured_weight REAL NOT NULL,
                measured_at TEXT NOT NULL,
                measurement_quality TEXT NOT NULL,
                received_at TEXT NOT NULL,
                delivery_state TEXT NOT NULL DEFAULT 'pending',
                retry_count INTEGER NOT NULL DEFAULT 0,
                last_error TEXT,
                backend_response_json TEXT,
                delivered_at TEXT
            )
            """
        )
        self._conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_queue_state_id ON measurement_queue(delivery_state, id)"
        )
        self._conn.commit()

    def enqueue(self, msg: NodeMeasurementMessage, received_at: str | None = None) -> bool:
        """Persist a measurement into the local queue.

        Returns True if inserted, or False if the same `measurementId` is already queued (idempotent).
        """
        ts = received_at or utc_now_iso()
        with self._lock:
            cur = self._conn.execute(
                """
                INSERT OR IGNORE INTO measurement_queue (
                    measurement_id, node_id, source_id, measured_weight,
                    measured_at, measurement_quality, received_at, delivery_state
                ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
                """,
                (
                    msg.measurementId,
                    msg.nodeId,
                    msg.sourceId,
                    msg.measuredWeight,
                    msg.measuredAt,
                    msg.measurementQuality,
                    ts,
                ),
            )
            self._conn.commit()
            return cur.rowcount == 1

    def fetch_pending(self, limit: int = 20) -> list[QueuedMeasurement]:
        """Fetch unacknowledged measurements in strict FIFO order."""
        with self._lock:
            rows = self._conn.execute(
                """
                SELECT id, measurement_id, node_id, source_id, measured_weight,
                       measured_at, measurement_quality, received_at, retry_count
                FROM measurement_queue
                WHERE delivery_state = 'pending'
                ORDER BY id ASC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()

        return [
            QueuedMeasurement(
                row_id=row[0],
                measurement_id=row[1],
                node_id=row[2],
                source_id=row[3],
                measured_weight=row[4],
                measured_at=row[5],
                measurement_quality=row[6],
                received_at=row[7],
                retry_count=row[8],
            )
            for row in rows
        ]

    def mark_acknowledged(self, measurement_id: str, backend_response: dict[str, Any]) -> None:
        """Mark a measurement as acknowledged by the cloud backend."""
        with self._lock:
            self._conn.execute(
                """
                UPDATE measurement_queue
                SET delivery_state = 'acknowledged',
                    backend_response_json = ?,
                    last_error = NULL,
                    delivered_at = ?
                WHERE measurement_id = ?
                """,
                (json.dumps(backend_response, ensure_ascii=False), utc_now_iso(), measurement_id),
            )
            self._conn.commit()

    def mark_retry(self, measurement_id: str, error_message: str) -> None:
        """Record a transient delivery failure; item remains pending for retry."""
        with self._lock:
            self._conn.execute(
                """
                UPDATE measurement_queue
                SET retry_count = retry_count + 1,
                    last_error = ?
                WHERE measurement_id = ? AND delivery_state = 'pending'
                """,
                (error_message[:500], measurement_id),
            )
            self._conn.commit()

    def mark_rejected(self, measurement_id: str, error_message: str) -> None:
        """Mark a measurement permanently rejected (e.g. 400/403 authorization error)."""
        with self._lock:
            self._conn.execute(
                """
                UPDATE measurement_queue
                SET delivery_state = 'rejected',
                    retry_count = retry_count + 1,
                    last_error = ?
                WHERE measurement_id = ?
                """,
                (error_message[:500], measurement_id),
            )
            self._conn.commit()

    def stats(self) -> dict[str, int]:
        """Return counts grouped by delivery_state."""
        counts = {"pending": 0, "acknowledged": 0, "rejected": 0, "total": 0}
        with self._lock:
            rows = self._conn.execute(
                "SELECT delivery_state, COUNT(*) FROM measurement_queue GROUP BY delivery_state"
            ).fetchall()
        for state, cnt in rows:
            counts[state] = int(cnt)
            counts["total"] += int(cnt)
        return counts

    def close(self) -> None:
        with self._lock:
            self._conn.close()
