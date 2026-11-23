# Základní implementace IoT části (IoT Node & Gateway) – BIOT Tým 4

Simulated Python + MQTT implementation of the **IoT Node (`UZ-xxx`)** and **IoT Gateway (`BR-xxx`)** layers, aligned 1:1 with the NestJS + Mongoose backend (`src/`) of `uun-iot-inventory-monitoring`.

## Architecture

```text
+------------------------------------------+
|  IoT Node (UZ-001)  [ESP32 + HX711 sim]  |
|  - Channels: UZ-001/V1, V2, V3           |
|  - Multi-sample stability filter:        |
|    validAndStable | unstable | invalid   |
|  - Unique measurementId + measuredAt     |
+--------------------+---------------------+
                     | MQTT (QoS 1)
                     | biot/nodes/{nodeId}/measurement
                     | biot/nodes/{nodeId}/status (LWT)
                     | biot/nodes/{nodeId}/commands
                     v
+------------------------------------------+
|  MQTT Broker (local_broker.py / Mosquitto)|
+--------------------+---------------------+
                     v
+------------------------------------------+
|  IoT Gateway (BR-001)                    |
|  - Validates node payloads               |
|  - SQLite retention queue (store&forward)|
|  - Retries idempotently via measurementId|
+--------------------+---------------------+
                     | HTTP POST /measurement/ingest
                     | Header: x-uu-profile: Gateways
                     v
+------------------------------------------+
|  NestJS Cloud Backend (http://localhost:3000) |
+------------------------------------------+
```

## Structure

- `common/config.py` – `MQTTConfig`, `BackendConfig`, and `Topics`.
- `common/models.py` – `NodeMeasurementMessage`, `NodeStatusMessage`, `NodeCommandMessage` matching `MeasurementIngestDtoIn`.
- `node/load_cell.py` – Multi-sample HX711 + Load Cell simulator with stability classification (`validAndStable`, `unstable`, `invalid`).
- `node/iot_node.py` – Multi-channel IoT weighing node (`UZ-001` with `UZ-001/V1`, `UZ-001/V2`, `UZ-001/V3`), LWT presence, and downlink commands (`measure_now`, `set_interval`, `set_pieces`, `simulate_unstable`, `simulate_fault`).
- `gateway/queue_db.py` – Thread-safe SQLite retention queue (`measurement_queue`) with `measurementId` deduplication and `pending` / `acknowledged` / `rejected` delivery states.
- `gateway/backend_client.py` – HTTP client for `POST /measurement/ingest`, `POST /gateway/register`, `POST /iotNode/connect`, and `GET /stockOverview/load`.
- `gateway/iot_gateway.py` – `BiotGateway` (`BR-001`) bridging MQTT nodes to the NestJS backend with store-and-forward outage recovery.
- `broker/local_broker.py` – Lightweight pure-Python MQTT 3.1.1 broker for zero-setup local runs.
- `docker-compose.yml` & `mosquitto/mosquitto.conf` – Eclipse Mosquitto 2 broker configuration.
- `firmware/esp32_hx711_node/` – Ready-to-flash PlatformIO/Arduino firmware (`ESP32 + HX711 + Load Cells`) speaking the exact same MQTT protocol & JSON schema as the Python node simulator.
- `run_demo.py` – End-to-end demo (`--interactive` REPL or scripted walkthrough) driving live stock updates against the running NestJS backend.
- `tests/test_biot_iot.py` – Unit & integration tests (including backend outage recovery).

## Setup

```powershell
cd iot
python -m venv .venv
.\.venv\Scripts\pip install -r requirements.txt
```

## Running Automated IoT Tests

```powershell
cd iot
.\.venv\Scripts\pytest -v
```

## End-to-End Run with the NestJS Backend

1. Start the NestJS backend in terminal 1 (from repo root):
   ```powershell
   npm install
   npm run dev
   ```
2. Run the end-to-end IoT demo in terminal 2 (from `iot/`):
   ```powershell
   # Scripted 4-step walkthrough
   .\.venv\Scripts\python run_demo.py --backend-url http://127.0.0.1:3000

   # Interactive live presentation mode (take / add / set / unstable / fault / overview)
   .\.venv\Scripts\python run_demo.py --backend-url http://127.0.0.1:3000 --interactive
   ```

## Flashing Real Hardware (`ESP32 + HX711`)

1. Edit `firmware/esp32_hx711_node/include/config.h` with your Wi-Fi credentials, local MQTT broker IP, GPIO pins, and load-cell calibration factors (`scaleFactor` / `zeroOffset`).
2. Build and flash via PlatformIO:
   ```bash
   cd iot/firmware/esp32_hx711_node
   pio run -t upload
   ```
   The ESP32 publishes directly to the same `biot/nodes/UZ-001/measurement` MQTT topic handled by `gateway/iot_gateway.py` with no gateway changes required.
   Or start each component independently:
   ```powershell
   # Broker (or `docker compose up -d` for Mosquitto)
   .\.venv\Scripts\python -m broker.local_broker --port 1883

   # Gateway BR-001 -> NestJS backend
   .\.venv\Scripts\python -m gateway.iot_gateway --gateway-id BR-001 --backend-url http://127.0.0.1:3000

   # Weighing Node UZ-001 (V1, V2, V3)
   .\.venv\Scripts\python -m node.iot_node --node-id UZ-001 --interval 5.0
   ```
