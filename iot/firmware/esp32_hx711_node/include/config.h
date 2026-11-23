#pragma once

// --- Wi-Fi Configuration ----------------------------------------------------
constexpr char WIFI_SSID[] = "YOUR_WIFI_SSID";
constexpr char WIFI_PASSWORD[] = "YOUR_WIFI_PASSWORD";

// --- Local MQTT Broker (IoT Gateway BR-001) ---------------------------------
constexpr char MQTT_HOST[] = "192.168.1.100";
constexpr uint16_t MQTT_PORT = 1883;
constexpr char MQTT_USER[] = "";
constexpr char MQTT_PASS[] = "";

// --- BIOT Node Identity (matches iotNode/connect in NestJS backend) ---------
constexpr char NODE_ID[] = "UZ-001";

// --- HX711 Channel Wiring & Calibration -------------------------------------
struct ChannelHardwareConfig {
    const char* sourceId;
    uint8_t doutPin;
    uint8_t sckPin;
    float scaleFactor; // Raw ADC counts per gram (calibrate per load cell)
    long zeroOffset;   // Raw ADC offset at 0 g
};

// Up to 3 load cells per ESP32 node (UZ-001/V1..V3)
constexpr ChannelHardwareConfig CHANNELS[] = {
    {"UZ-001/V1", 16, 17, 420.0f, 0L},
    {"UZ-001/V2", 18, 19, 420.0f, 0L},
    {"UZ-001/V3", 21, 22, 420.0f, 0L},
};
constexpr size_t CHANNEL_COUNT = sizeof(CHANNELS) / sizeof(CHANNELS[0]);

// --- Acquisition & Stability Filter Parameters ------------------------------
constexpr uint32_t DEFAULT_INTERVAL_MS = 5000;
constexpr size_t SAMPLES_PER_READING = 5;
constexpr uint32_t SAMPLE_DELAY_MS = 60;
constexpr float STABILITY_SPREAD_THRESHOLD_G = 1.5f;
constexpr float MIN_VALID_WEIGHT_G = -5.0f;
constexpr float MAX_VALID_WEIGHT_G = 5000.0f;

// --- NTP Time Sync (UTC ISO-8601 measuredAt) --------------------------------
constexpr char NTP_SERVER_1[] = "pool.ntp.org";
constexpr char NTP_SERVER_2[] = "time.nist.gov";
