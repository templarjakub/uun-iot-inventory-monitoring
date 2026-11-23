"""End-to-end demo connecting simulated IoT Node (UZ-001) + Gateway (BR-001) to the BIOT Backend.

Prerequisites:
    Start the NestJS backend first (from repo root):
        npm run dev

Then run this demo (from iot/):
    .\\.venv\\Scripts\\python run_demo.py                  # scripted 4-step walkthrough
    .\\.venv\\Scripts\\python run_demo.py --interactive    # interactive REPL for live demos
"""

from __future__ import annotations

import argparse
import logging
import tempfile
import time
from pathlib import Path

from broker.local_broker import ThreadedMQTTBroker
from common.config import BackendConfig, MQTTConfig
from gateway.backend_client import BackendError, BiotBackendClient
from gateway.iot_gateway import BiotGateway
from node.iot_node import BiotWeighingNode, default_uz001_channels

logger = logging.getLogger("biot.demo")


def _print_stock_overview(client: BiotBackendClient, label: str, product_id: str | None = "PRD-001") -> None:
    try:
        overview = client.load_stock_overview(product_id=product_id)
    except BackendError as exc:
        logger.warning("[%s] Could not load stockOverview/load: %s", label, exc)
        return

    items = overview.get("productList") or []
    if not items:
        logger.info("[%s] No products found in stockOverview", label)
        return

    for prd in items:
        points = ", ".join(
            f"{p['weighingPointId']}={p['stockEstimate']}ks ({p['measurementStatus']})"
            for p in prd.get("weighingPointList", [])
        )
        logger.info(
            "[%s] STOCK OVERVIEW %s (%s): total=%s ks | min=%s ks | status=%s | points=[%s]",
            label,
            prd["productId"],
            prd["productName"],
            prd["stockEstimate"],
            prd["minimumStock"],
            prd["minimumStockStatus"],
            points,
        )


def _wait_queue_drained(gateway: BiotGateway, expected_ack: int, timeout_s: float = 6.0) -> None:
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        st = gateway.queue.stats()
        if st["pending"] == 0 and st["acknowledged"] >= expected_ack:
            return
        time.sleep(0.1)


def _resolve_source_id(token: str) -> str:
    clean = token.strip().upper()
    return clean if "/" in clean else f"UZ-001/{clean}"


def _run_interactive(
    node: BiotWeighingNode,
    gateway: BiotGateway,
    backend_client: BiotBackendClient,
) -> None:
    print(
        "\nInteractive BIOT IoT Demo (UZ-001 -> MQTT -> BR-001 -> NestJS Backend)\n"
        "Commands:\n"
        "  measure                  - sample all channels (V1, V2, V3) and send now\n"
        "  set <V1|V2|V3> <pieces>  - set exact piece count and measure\n"
        "  take <V1|V2|V3> <n>      - remove n pieces from container and measure\n"
        "  add <V1|V2|V3> <n>       - add n pieces to container and measure\n"
        "  unstable <V1|V2|V3>      - simulate hand disturbance (measurementQuality=unstable)\n"
        "  fault <V1|V2|V3>         - simulate sensor fault (measurementQuality=invalid)\n"
        "  overview                 - query GET /stockOverview/load from backend\n"
        "  queue                    - show BR-001 SQLite retention queue stats\n"
        "  quit                     - stop demo\n"
    )
    node.measure_and_publish_all()
    time.sleep(0.4)
    _print_stock_overview(backend_client, "INIT")

    while True:
        try:
            raw = input("biot> ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            break

        if not raw:
            continue
        parts = raw.split()
        cmd = parts[0].lower()

        if cmd in ("quit", "exit", "q"):
            break
        elif cmd == "measure":
            node.measure_and_publish_all()
        elif cmd == "set" and len(parts) == 3:
            src = _resolve_source_id(parts[1])
            if src not in node.channels:
                print(f"Unknown channel '{src}'. Available: {node.source_ids}")
                continue
            node.channels[src].set_pieces(int(parts[2]))
            node.measure_and_publish_channel(src)
        elif cmd == "take" and len(parts) == 3:
            src = _resolve_source_id(parts[1])
            if src not in node.channels:
                print(f"Unknown channel '{src}'. Available: {node.source_ids}")
                continue
            remaining = node.channels[src].adjust_pieces(-abs(int(parts[2])))
            print(f"{src} -> {remaining} pieces")
            node.measure_and_publish_channel(src)
        elif cmd == "add" and len(parts) == 3:
            src = _resolve_source_id(parts[1])
            if src not in node.channels:
                print(f"Unknown channel '{src}'. Available: {node.source_ids}")
                continue
            updated = node.channels[src].adjust_pieces(abs(int(parts[2])))
            print(f"{src} -> {updated} pieces")
            node.measure_and_publish_channel(src)
        elif cmd == "unstable" and len(parts) == 2:
            src = _resolve_source_id(parts[1])
            if src not in node.channels:
                print(f"Unknown channel '{src}'. Available: {node.source_ids}")
                continue
            node.channels[src].trigger_unstable_once()
            node.measure_and_publish_channel(src)
        elif cmd == "fault" and len(parts) == 2:
            src = _resolve_source_id(parts[1])
            if src not in node.channels:
                print(f"Unknown channel '{src}'. Available: {node.source_ids}")
                continue
            node.channels[src].trigger_fault_once()
            node.measure_and_publish_channel(src)
        elif cmd == "overview":
            _print_stock_overview(backend_client, "LIVE", product_id=None)
        elif cmd == "queue":
            print("SQLite queue stats:", gateway.queue.stats())
        else:
            print("Unrecognized command. Type 'measure', 'set V1 45', 'take V1 5', 'unstable V1', 'overview', 'queue', or 'quit'.")


def _run_scripted(
    node: BiotWeighingNode,
    gateway: BiotGateway,
    backend_client: BiotBackendClient,
) -> None:
    logger.info("=== Step 1: Initial stable weighing cycle (VM-001=30 ks, VM-002=10 ks -> 40 ks < min 50 ks) ===")
    node.measure_and_publish_all()
    _wait_queue_drained(gateway, expected_ack=3)
    _print_stock_overview(backend_client, "STEP 1")

    logger.info("=== Step 2: Restock VM-001 to 45 ks via downlink command (total -> 55 ks >= min 50 ks) ===")
    gateway.send_node_command(
        "UZ-001",
        "set_pieces",
        params={"sourceId": "UZ-001/V1", "pieces": 45},
        request_id="req-restock",
    )
    time.sleep(0.3)
    node.measure_and_publish_channel("UZ-001/V1")
    _wait_queue_drained(gateway, expected_ack=4)
    _print_stock_overview(backend_client, "STEP 2")

    logger.info("=== Step 3: Unstable reading on VM-001 (operator touching bin — BUC-12 preserves last valid estimate) ===")
    node.channels["UZ-001/V1"].trigger_unstable_once()
    node.measure_and_publish_channel("UZ-001/V1")
    _wait_queue_drained(gateway, expected_ack=5)
    _print_stock_overview(backend_client, "STEP 3")

    logger.info("=== Step 4: Restore stable reading on VM-001 ===")
    node.measure_and_publish_channel("UZ-001/V1")
    _wait_queue_drained(gateway, expected_ack=6)
    _print_stock_overview(backend_client, "STEP 4")

    logger.info("Final Gateway SQLite Queue Stats: %s", gateway.queue.stats())


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)-7s [%(name)s] %(message)s",
    )
    parser = argparse.ArgumentParser(description="Run BIOT IoT Node + Gateway demo against NestJS backend.")
    parser.add_argument("--backend-url", default="http://127.0.0.1:3000", help="BIOT NestJS backend URL")
    parser.add_argument("--broker-port", type=int, default=0, help="Local MQTT port (0 = auto)")
    parser.add_argument("--interactive", action="store_true", help="Run interactive REPL for live presentations")
    args = parser.parse_args()

    backend_cfg = BackendConfig(base_url=args.backend_url)
    backend_client = BiotBackendClient(backend_cfg)

    broker = ThreadedMQTTBroker(host="127.0.0.1", port=args.broker_port)
    broker.start()
    mqtt_cfg = MQTTConfig(host=broker.host, port=broker.port)

    tmp_dir = tempfile.TemporaryDirectory(prefix="biot_gw_demo_")
    db_path = Path(tmp_dir.name) / "biot_gateway_queue.db"

    gateway = BiotGateway(
        gateway_id="BR-001",
        mqtt_config=mqtt_cfg,
        backend_config=backend_cfg,
        db_path=db_path,
        forward_interval_s=0.3,
        retry_backoff_s=1.0,
    )
    node = BiotWeighingNode(
        node_id="UZ-001",
        channels=default_uz001_channels(seed=42),
        mqtt_config=mqtt_cfg,
        interval_s=60.0,
    )

    try:
        gateway.start()
        assert node.connect(), "Failed to connect UZ-001 to local MQTT broker"
        if args.interactive:
            _run_interactive(node, gateway, backend_client)
        else:
            _run_scripted(node, gateway, backend_client)
    finally:
        node.stop()
        gateway.stop()
        broker.stop()
        tmp_dir.cleanup()


if __name__ == "__main__":
    main()
