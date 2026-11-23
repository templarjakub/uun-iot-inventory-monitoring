/**
 * BIOT Automatic Inventory Monitoring – ESP32 + HX711 Weighing Node Firmware
 * Course: BIOT – Tým 4 (Unicorn University)
 *
 * Publishes JSON weight measurements over MQTT to the local BIOT Gateway (BR-001)
 * using the exact topic and payload schema shared with the Python simulator:
 *   - biot/nodes/{NODE_ID}/measurement  (QoS 1)
 *   - biot/nodes/{NODE_ID}/status       (retained + LWT)
 *   - biot/nodes/{NODE_ID}/commands     (subscribed downlink: measure_now, set_interval)
 *   - biot/nodes/{NODE_ID}/ack          (command acknowledgement)
 */

#include <Arduino.h>
#include <ArduinoJson.h>
#include <HX711.h>
#include <PubSubClient.h>
#include <WiFi.h>
#include <time.h>

#include "config.h"

namespace {

WiFiClient wifiClient;
PubSubClient mqttClient(wifiClient);
HX711 scales[CHANNEL_COUNT];

uint32_t measurementIntervalMs = DEFAULT_INTERVAL_MS;
uint32_t lastMeasurementMs = 0;
uint32_t sequenceCounter = 0;
bool measureNowRequested = false;

String topicMeasurement;
String topicStatus;
String topicCommands;
String topicAck;

String utcNowIso8601() {
    struct tm timeinfo;
    if (!getLocalTime(&timeinfo, 100)) {
        return "1970-01-01T00:00:00.000Z";
    }
    char buf[32];
    strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%S.000Z", &timeinfo);
    return String(buf);
}

String buildMeasurementId(const char* sourceId) {
    sequenceCounter++;
    struct tm timeinfo;
    char stamp[20] = "00000000000000";
    if (getLocalTime(&timeinfo, 50)) {
        strftime(stamp, sizeof(stamp), "%Y%m%d%H%M%S", &timeinfo);
    }
    String safeSource(sourceId);
    safeSource.replace("/", "-");

    char seqBuf[12];
    snprintf(seqBuf, sizeof(seqBuf), "%04lu", static_cast<unsigned long>(sequenceCounter));
    return "M-" + String(stamp) + "-" + safeSource + "-" + String(seqBuf);
}

void sortFloatArray(float* arr, size_t n) {
    for (size_t i = 1; i < n; ++i) {
        float key = arr[i];
        int j = static_cast<int>(i) - 1;
        while (j >= 0 && arr[j] > key) {
            arr[j + 1] = arr[j];
            j--;
        }
        arr[j + 1] = key;
    }
}

void publishStatus(const char* statusValue) {
    JsonDocument doc;
    doc["nodeId"] = NODE_ID;
    doc["status"] = statusValue;
    JsonArray sources = doc["sourceIds"].to<JsonArray>();
    for (size_t i = 0; i < CHANNEL_COUNT; ++i) {
        sources.add(CHANNELS[i].sourceId);
    }
    doc["timestamp"] = utcNowIso8601();

    String payload;
    serializeJson(doc, payload);
    mqttClient.publish(topicStatus.c_str(), payload.c_str(), true);
}

void handleCommand(char* topic, byte* payload, unsigned int length) {
    JsonDocument doc;
    DeserializationError err = deserializeJson(doc, payload, length);
    if (err) {
        Serial.printf("[%s] Invalid command JSON: %s\n", NODE_ID, err.c_str());
        return;
    }

    const char* command = doc["command"] | "";
    const char* requestId = doc["requestId"] | "";

    JsonDocument ack;
    ack["nodeId"] = NODE_ID;
    ack["requestId"] = requestId;
    ack["command"] = command;
    ack["timestamp"] = utcNowIso8601();
    ack["ok"] = true;

    if (strcmp(command, "measure_now") == 0) {
        measureNowRequested = true;
        ack["detail"] = "immediate measurement scheduled";
    } else if (strcmp(command, "set_interval") == 0) {
        float sec = doc["params"]["intervalSeconds"] | 0.0f;
        if (sec >= 0.5f) {
            measurementIntervalMs = static_cast<uint32_t>(sec * 1000.0f);
            ack["detail"] = "interval updated";
        } else {
            ack["ok"] = false;
            ack["detail"] = "intervalSeconds must be >= 0.5";
        }
    } else {
        ack["ok"] = false;
        ack["detail"] = "unsupported command";
    }

    String out;
    serializeJson(ack, out);
    mqttClient.publish(topicAck.c_str(), out.c_str(), false);
}

void ensureWiFiConnected() {
    if (WiFi.status() == WL_CONNECTED) {
        return;
    }
    Serial.printf("[%s] Connecting to Wi-Fi '%s'...\n", NODE_ID, WIFI_SSID);
    WiFi.mode(WIFI_STA);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    while (WiFi.status() != WL_CONNECTED) {
        delay(500);
        Serial.print(".");
    }
    Serial.printf("\n[%s] Wi-Fi connected, IP=%s\n", NODE_ID, WiFi.localIP().toString().c_str());
    configTime(0, 0, NTP_SERVER_1, NTP_SERVER_2);
}

void ensureMqttConnected() {
    if (mqttClient.connected()) {
        return;
    }

    // Build LWT payload for unexpected disconnects
    JsonDocument willDoc;
    willDoc["nodeId"] = NODE_ID;
    willDoc["status"] = "offline";
    willDoc["timestamp"] = utcNowIso8601();
    String willPayload;
    serializeJson(willDoc, willPayload);

    String clientId = "biot-node-" + String(NODE_ID);
    while (!mqttClient.connected()) {
        Serial.printf("[%s] Connecting to MQTT broker %s:%u...\n", NODE_ID, MQTT_HOST, MQTT_PORT);
        bool connected = strlen(MQTT_USER) > 0
            ? mqttClient.connect(clientId.c_str(), MQTT_USER, MQTT_PASS, topicStatus.c_str(), 1, true, willPayload.c_str())
            : mqttClient.connect(clientId.c_str(), topicStatus.c_str(), 1, true, willPayload.c_str());

        if (connected) {
            Serial.printf("[%s] MQTT connected\n", NODE_ID);
            mqttClient.subscribe(topicCommands.c_str(), 1);
            publishStatus("online");
        } else {
            Serial.printf("[%s] MQTT failed (rc=%d), retrying in 2s...\n", NODE_ID, mqttClient.state());
            delay(2000);
        }
    }
}

void measureAndPublishChannel(size_t index) {
    const ChannelHardwareConfig& cfg = CHANNELS[index];
    HX711& scale = scales[index];

    float samples[SAMPLES_PER_READING];
    bool sensorReady = true;

    for (size_t i = 0; i < SAMPLES_PER_READING; ++i) {
        if (!scale.wait_ready_timeout(300)) {
            sensorReady = false;
            break;
        }
        samples[i] = scale.get_units(1);
        delay(SAMPLE_DELAY_MS);
    }

    float measuredWeight = -99.9f;
    float spread = 0.0f;
    const char* quality = "invalid";

    if (sensorReady) {
        sortFloatArray(samples, SAMPLES_PER_READING);
        measuredWeight = samples[SAMPLES_PER_READING / 2];
        spread = samples[SAMPLES_PER_READING - 1] - samples[0];

        if (measuredWeight < MIN_VALID_WEIGHT_G || measuredWeight > MAX_VALID_WEIGHT_G) {
            quality = "invalid";
        } else if (spread > STABILITY_SPREAD_THRESHOLD_G) {
            quality = "unstable";
        } else {
            quality = "validAndStable";
        }
    }

    JsonDocument doc;
    doc["nodeId"] = NODE_ID;
    doc["measurementId"] = buildMeasurementId(cfg.sourceId);
    doc["sourceId"] = cfg.sourceId;
    doc["measuredWeight"] = roundf(measuredWeight * 100.0f) / 100.0f;
    doc["measuredAt"] = utcNowIso8601();
    doc["measurementQuality"] = quality;
    doc["sampleCount"] = SAMPLES_PER_READING;
    doc["sampleSpreadG"] = roundf(spread * 1000.0f) / 1000.0f;

    String out;
    serializeJson(doc, out);
    mqttClient.publish(topicMeasurement.c_str(), out.c_str(), false);

    Serial.printf(
        "[%s] %s -> %.2fg (%s, spread=%.3fg)\n",
        NODE_ID,
        cfg.sourceId,
        measuredWeight,
        quality,
        spread
    );
}

} // namespace

void setup() {
    Serial.begin(115200);
    delay(200);

    topicMeasurement = "biot/nodes/" + String(NODE_ID) + "/measurement";
    topicStatus = "biot/nodes/" + String(NODE_ID) + "/status";
    topicCommands = "biot/nodes/" + String(NODE_ID) + "/commands";
    topicAck = "biot/nodes/" + String(NODE_ID) + "/ack";

    for (size_t i = 0; i < CHANNEL_COUNT; ++i) {
        scales[i].begin(CHANNELS[i].doutPin, CHANNELS[i].sckPin);
        scales[i].set_scale(CHANNELS[i].scaleFactor);
        scales[i].set_offset(CHANNELS[i].zeroOffset);
    }

    mqttClient.setServer(MQTT_HOST, MQTT_PORT);
    mqttClient.setBufferSize(512);
    mqttClient.setCallback(handleCommand);

    ensureWiFiConnected();
    ensureMqttConnected();
}

void loop() {
    ensureWiFiConnected();
    ensureMqttConnected();
    mqttClient.loop();

    const uint32_t now = millis();
    if (measureNowRequested || (now - lastMeasurementMs >= measurementIntervalMs)) {
        measureNowRequested = false;
        lastMeasurementMs = now;
        for (size_t i = 0; i < CHANNEL_COUNT; ++i) {
            measureAndPublishChannel(i);
        }
    }
}
