"""HTTP client for the BIOT NestJS + Mongoose uuApp Backend."""

from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

from common.config import BackendConfig


class BackendError(RuntimeError):
    """Base error raised when calling the BIOT cloud backend."""

    def __init__(self, message: str, status_code: int | None = None, payload: Any = None) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.payload = payload


class RetryableBackendError(BackendError):
    """Transient network/5xx error — measurement stays in SQLite queue for retry."""


class PermanentBackendError(BackendError):
    """Non-retryable 4xx error (e.g. unauthorizedGatewayOrSource or invalidDtoIn)."""


class BiotBackendClient:
    """Minimal stdlib HTTP client matching the BIOT NestJS backend Commands."""

    def __init__(self, config: BackendConfig | None = None) -> None:
        self.config = config or BackendConfig()

    def _request(
        self,
        method: str,
        path: str,
        profile: str,
        body: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        url = f"{self.config.base_url}{path}"
        headers = {
            "Accept": "application/json",
            "x-uu-profile": profile,
        }
        data: bytes | None = None
        if body is not None:
            headers["Content-Type"] = "application/json"
            data = json.dumps(body, ensure_ascii=False).encode("utf-8")

        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=self.config.timeout_s) as resp:
                raw = resp.read().decode("utf-8")
                return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as exc:
            raw_err = exc.read().decode("utf-8", errors="replace")
            try:
                err_payload = json.loads(raw_err)
            except json.JSONDecodeError:
                err_payload = raw_err

            msg = f"HTTP {exc.code} from {method} {path}: {err_payload}"
            if exc.code >= 500 or exc.code == 429:
                raise RetryableBackendError(msg, status_code=exc.code, payload=err_payload) from exc
            raise PermanentBackendError(msg, status_code=exc.code, payload=err_payload) from exc
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            raise RetryableBackendError(f"Network error calling {method} {path}: {exc}") from exc

    def ingest_measurement(self, dto_in: dict[str, Any]) -> dict[str, Any]:
        """Command 9: POST /measurement/ingest (BUC-11, BUC-12, BUC-14)."""
        return self._request("POST", "/measurement/ingest", self.config.gateway_profile, dto_in)

    def register_gateway(self, gateway_id: str, gateway_name: str) -> dict[str, Any]:
        """Command 7: POST /gateway/register (BUC-07). Treats already-registered as idempotent."""
        try:
            return self._request(
                "POST",
                "/gateway/register",
                self.config.authority_profile,
                {"gatewayId": gateway_id, "gatewayName": gateway_name},
            )
        except PermanentBackendError as exc:
            if isinstance(exc.payload, dict):
                err_map = exc.payload.get("uuAppErrorMap") or {}
                if any("gatewayAlreadyRegistered" in str(k) for k in err_map):
                    return {"gatewayId": gateway_id, "authorizationStatus": "verified", "alreadyRegistered": True}
            raise

    def connect_node(
        self,
        node_id: str,
        node_name: str,
        gateway_id: str,
        source_ids: list[str],
    ) -> dict[str, Any]:
        """Command 8: POST /iotNode/connect (BUC-08)."""
        return self._request(
            "POST",
            "/iotNode/connect",
            self.config.authority_profile,
            {
                "nodeId": node_id,
                "nodeName": node_name,
                "gatewayId": gateway_id,
                "sourceIds": source_ids,
            },
        )

    def load_stock_overview(self, product_id: str | None = None) -> dict[str, Any]:
        """Command 10: GET /stockOverview/load (BUC-13, BUC-14)."""
        path = "/stockOverview/load"
        if product_id:
            path += f"?productId={urllib.parse.quote(product_id)}"
        return self._request("GET", path, "Readers")
