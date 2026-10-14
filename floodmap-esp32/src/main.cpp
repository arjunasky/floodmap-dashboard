// ============================================================
// FloodMap — ESP32 Sensor Fusion (FINAL v18)
// Fix: time-based timeout reset (bukan count-based)
// ============================================================

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <Wire.h>
#include <TinyGPSPlus.h>
#include <HardwareSerial.h>

// ============================================================
// KONFIGURASI
// ============================================================
#define WIFI_SSID       "labubu"
#define WIFI_PASSWORD   "tabbu098"
#define FB_HOST         "https://geo-flood-5cfc6-default-rtdb.asia-southeast1.firebasedatabase.app"

#define GPS_RX_PIN   16
#define GPS_TX_PIN   17
#define GPS_BAUD     9600

#define TRIG_PIN           27
#define ECHO_PIN           14
#define SENSOR_HEIGHT_CM   45.0
#define BLINDSPOT_CM       20.0
#define MAX_DEPTH_CM       25.0
#define DRY_THRESHOLD_CM   3.0
#define MAX_DISTANCE_CM    400.0

#define MPU_ADDR            0x68
#define ACCEL_SCALE         4096.0
#define MPU_SAMPLE_MS       5

#define HPF_ALPHA           0.92
#define IMPACT_MIN_G        1.3
#define DROP_MAX_G          0.55
#define BUMP_RISE_MIN_G     0.30
#define BUMP_RISE_MAX_G     1.0
#define COOLDOWN_MS         2000
#define TWO_WHEEL_MIN_DELAY_MS  80
#define TWO_WHEEL_MAX_DELAY_MS  400

#define ULTRASONIC_INTERVAL_MS  50
#define RAW_BUFFER_SIZE         20
#define MODE_WINDOW             5
#define VALID_TIMEOUT_MS        2500    // 🔧 2.5 dtk tanpa valid = reset

#define CURRENT_READING_INTERVAL_MS  3000
#define SEND_INTERVAL_MS             6000
#define EVENT_SUPPRESS_MS            1500

#define MIN_MOVEMENT_M      5.0
#define MIN_DEPTH_CHANGE    3.0

#define GPS_MIN_SAT         4
#define GPS_MAX_HDOP        3.5
#define GPS_MAX_AGE_MS      2000

// ============================================================
// OBJEK GLOBAL
// ============================================================
TinyGPSPlus gps;
HardwareSerial gpsSerial(2);

unsigned long lastSendTime = 0;
unsigned long totalSent = 0;
unsigned long totalEvents = 0;
unsigned long totalCurrentReadings = 0;
String currentSegment = "";

unsigned long segmentStartTime = 0;
double lastSentLat = 0, lastSentLng = 0;
float lastSentDepth = 0;
bool hasSentFirst = false;

float ax_offset = 0, ay_offset = 0, az_offset = 0;
bool mpuCalibrated = false;
float hpf_prev_x = 0, hpf_prev_y = 0, hpf_prev_z = 0;
float dynamicImuZ = 0.0;
float dynamicImuMag = 0.0;

enum EventState { EV_IDLE, EV_RISING, EV_FALLING, EV_COOLDOWN };
EventState evState = EV_IDLE;
unsigned long evStateStart = 0;
float evPeakG = 0;
unsigned long lastSpikeTime = 0;
int pendingDoubleCheck = 0;
unsigned long firstSpikeTime = 0;
float firstSpikeMagnitude = 0;
bool eventActive = false;
unsigned long eventDetectedAt = 0;
float stableDepth = 0;

// Ultrasonic
float rawBuffer[RAW_BUFFER_SIZE];
int rawIdx = 0;
int rawCount = 0;
float latestDepth = 0;
float latestRaw = 0;
unsigned long lastValidReadTime = 0;   // 🔧 Track waktu valid terakhir
unsigned long lastUltrasonicRead = 0;

WiFiClientSecure secureClient;

// ============================================================
// UTIL
// ============================================================
String classifyStatus(float depth) {
    if (depth < 10.0) return "aman";
    if (depth < 20.0) return "siaga";
    return "bahaya";
}

float absf(float x) { return x < 0 ? -x : x; }

// ============================================================
// GPS
// ============================================================
void gpsInit() {
    gpsSerial.begin(GPS_BAUD, SERIAL_8N1, GPS_RX_PIN, GPS_TX_PIN);
    Serial.printf("[GPS] RX=%d TX=%d @%d\n", GPS_RX_PIN, GPS_TX_PIN, GPS_BAUD);
}

void gpsUpdate() {
    while (gpsSerial.available() > 0) gps.encode(gpsSerial.read());
}

bool gpsHasFix() {
    if (!gps.location.isValid()) return false;
    if (gps.location.age() > GPS_MAX_AGE_MS) return false;
    if (gps.satellites.value() < GPS_MIN_SAT) return false;
    if (gps.hdop.hdop() > GPS_MAX_HDOP) return false;
    return true;
}

void gpsGetPosition(double &lat, double &lng, int &sats, bool &isReal) {
    if (gpsHasFix()) {
        lat = gps.location.lat();
        lng = gps.location.lng();
        sats = gps.satellites.value();
        isReal = true;
    } else {
        lat = -5.1470 + (random(-100, 100) / 100000.0);
        lng = 119.4530 + (random(-100, 100) / 100000.0);
        sats = 0;
        isReal = false;
    }
}

// ============================================================
// JSN-SR04T
// ============================================================
void ultrasonicInit() {
    pinMode(TRIG_PIN, OUTPUT);
    pinMode(ECHO_PIN, INPUT);
    digitalWrite(TRIG_PIN, LOW);
    Serial.printf("[US] TRIG=%d ECHO=%d | H=%.1f BS=%.1f Max=%.1f\n",
                  TRIG_PIN, ECHO_PIN, SENSOR_HEIGHT_CM, BLINDSPOT_CM, MAX_DEPTH_CM);
}

float ultrasonicReadOnce() {
    digitalWrite(TRIG_PIN, LOW);
    delayMicroseconds(2);
    digitalWrite(TRIG_PIN, HIGH);
    delayMicroseconds(10);
    digitalWrite(TRIG_PIN, LOW);
    long dur = pulseIn(ECHO_PIN, HIGH, 30000);
    if (dur == 0) return -1;
    return dur * 0.0343 / 2.0;
}

// ============================================================
// MODE FILTER — Nearest Neighbor
// ============================================================
float calculateModeFromLast(int windowSize) {
    if (rawCount == 0) return SENSOR_HEIGHT_CM;

    int n = min(windowSize, rawCount);
    float samples[MODE_WINDOW];
    for (int i = 0; i < n; i++) {
        int idx = (rawIdx - 1 - i + RAW_BUFFER_SIZE) % RAW_BUFFER_SIZE;
        samples[i] = rawBuffer[idx];
    }

    int maxCount = 0;
    float modeVal = samples[0];

    for (int i = 0; i < n; i++) {
        int count = 0;
        float sum = 0;
        for (int j = 0; j < n; j++) {
            if (fabs(samples[j] - samples[i]) <= 0.3) {
                count++;
                sum += samples[j];
            }
        }
        if (count > maxCount) {
            maxCount = count;
            modeVal = sum / count;
        }
    }

    return modeVal;
}

// ============================================================
// 🔧 ULTRASONIC — TIME-BASED TIMEOUT RESET
// ============================================================
void ultrasonicUpdateFast() {
    unsigned long now = millis();
    if (now - lastUltrasonicRead < ULTRASONIC_INTERVAL_MS) return;
    lastUltrasonicRead = now;

    float raw = ultrasonicReadOnce();
    latestRaw = raw;

    // ============================================================
    // KASUS 1: TIMEOUT — cek durasi
    // ============================================================
    if (raw < 0) {
        // Kalau sudah 2.5 detik tanpa valid → paksa reset
        if (lastValidReadTime > 0 && (now - lastValidReadTime) > VALID_TIMEOUT_MS) {
            if (latestDepth != 0) {
                Serial.println("[US] ⏰ Timeout lama — reset depth ke 0");
            }
            latestDepth = 0;
            rawCount = 0;
            rawIdx = 0;
            lastValidReadTime = now;   // Reset timer biar tidak spam log
        }
        return;
    }

    // ============================================================
    // KASUS 2: BLINDSPOT (raw < 20cm) → depth = MAX
    // ============================================================
    if (raw < BLINDSPOT_CM) {
        latestDepth = MAX_DEPTH_CM;
        lastValidReadTime = now;
        return;
    }

    // ============================================================
    // KASUS 3: KOSONG (raw > 45cm) → depth = 0
    // ============================================================
    if (raw > SENSOR_HEIGHT_CM) {
        latestDepth = 0;
        rawCount = 0;
        rawIdx = 0;
        lastValidReadTime = now;
        return;
    }

    // ============================================================
    // KASUS 4: VALID (20 ≤ raw ≤ 45)
    // ============================================================
    lastValidReadTime = now;   // 🔧 Update timestamp valid

    rawBuffer[rawIdx] = raw;
    rawIdx = (rawIdx + 1) % RAW_BUFFER_SIZE;
    if (rawCount < RAW_BUFFER_SIZE) rawCount++;

    float modeDistance = calculateModeFromLast(MODE_WINDOW);
    float depth = SENSOR_HEIGHT_CM - modeDistance;

    if (depth < 0) depth = 0;
    if (depth > MAX_DEPTH_CM) depth = MAX_DEPTH_CM;
    if (depth < DRY_THRESHOLD_CM) depth = 0;

    latestDepth = depth;
}

// ============================================================
// MPU6050
// ============================================================
void mpuWrite(uint8_t reg, uint8_t val) {
    Wire.beginTransmission(MPU_ADDR);
    Wire.write(reg);
    Wire.write(val);
    Wire.endTransmission();
}

void mpuInit() {
    Wire.begin(21, 22);
    mpuWrite(0x6B, 0x00);
    delay(50);
    mpuWrite(0x1C, 0x10);
    delay(50);
    mpuWrite(0x1A, 0x03);
    delay(50);
    Serial.println("[MPU] Init OK");
}

void mpuReadRaw(float &ax, float &ay, float &az) {
    Wire.beginTransmission(MPU_ADDR);
    Wire.write(0x3B);
    Wire.endTransmission(false);
    Wire.requestFrom((uint8_t)MPU_ADDR, (uint8_t)6, (uint8_t)true);
    int16_t rx = (Wire.read() << 8) | Wire.read();
    int16_t ry = (Wire.read() << 8) | Wire.read();
    int16_t rz = (Wire.read() << 8) | Wire.read();
    ax = rx / ACCEL_SCALE;
    ay = ry / ACCEL_SCALE;
    az = rz / ACCEL_SCALE;
}

void mpuCalibrate() {
    Serial.println("[MPU] Kalibrasi (3 dtk)");
    delay(500);
    const int N = 100;
    float sx = 0, sy = 0, sz = 0;
    for (int i = 0; i < N; i++) {
        float ax, ay, az;
        mpuReadRaw(ax, ay, az);
        sx += ax; sy += ay; sz += az;
        delay(20);
    }
    ax_offset = sx / N;
    ay_offset = sy / N;
    az_offset = sz / N - 1.0;
    mpuCalibrated = true;
    Serial.printf("[MPU] Offset ax=%.3f ay=%.3f az=%.3f\n",
                  ax_offset, ay_offset, az_offset);
}

float mpuReadDynamic() {
    float ax, ay, az;
    mpuReadRaw(ax, ay, az);
    ax -= ax_offset;
    ay -= ay_offset;
    az -= az_offset;

    float hpf_x = HPF_ALPHA * (hpf_prev_x + ax - hpf_prev_x);
    float hpf_y = HPF_ALPHA * (hpf_prev_y + ay - hpf_prev_y);
    float hpf_z = HPF_ALPHA * (hpf_prev_z + az - hpf_prev_z);

    hpf_prev_x = ax;
    hpf_prev_y = ay;
    hpf_prev_z = az;

    dynamicImuMag = sqrt(hpf_x*hpf_x + hpf_y*hpf_y + hpf_z*hpf_z);
    dynamicImuZ = hpf_z;
    return dynamicImuMag;
}

float mpuReadZDynamic() {
    float ax, ay, az;
    mpuReadRaw(ax, ay, az);
    az -= az_offset;
    return HPF_ALPHA * (hpf_prev_z + az - hpf_prev_z);
}

void mpuReadTilt(float &pitch, float &roll) {
    float ax, ay, az;
    mpuReadRaw(ax, ay, az);
    pitch = atan2(-ax, sqrt(ay*ay + az*az)) * 180.0 / PI;
    roll  = atan2(ay, az) * 180.0 / PI;
}

// ============================================================
// DETEKSI EVENT
// ============================================================
int mpuDetectEvent(float &peak_out) {
    if (!mpuCalibrated) return 0;

    unsigned long now = millis();
    if (evState == EV_COOLDOWN) {
        if (now - evStateStart > COOLDOWN_MS) {
            evState = EV_IDLE;
            pendingDoubleCheck = 0;
        }
        return 0;
    }

    float zDyn = mpuReadZDynamic();
    float magDyn = mpuReadDynamic();
    if (absf(zDyn) > absf(peak_out)) peak_out = zDyn;

    bool isSpike = (magDyn > IMPACT_MIN_G) || (zDyn < DROP_MAX_G);

    if (isSpike && (now - lastSpikeTime > 80)) {
        lastSpikeTime = now;

        if (pendingDoubleCheck == 1) {
            unsigned long delay = now - firstSpikeTime;
            if (delay >= TWO_WHEEL_MIN_DELAY_MS && delay <= TWO_WHEEL_MAX_DELAY_MS) {
                evState = EV_COOLDOWN;
                evStateStart = now;
                eventActive = true;
                eventDetectedAt = now;
                pendingDoubleCheck = 0;

                if (zDyn > BUMP_RISE_MIN_G && zDyn < BUMP_RISE_MAX_G && delay > 200) {
                    Serial.printf("[MPU] SPEED BUMP\n");
                    return 2;
                } else {
                    Serial.printf("[MPU] POTHOLE mag=%.2fg\n", magDyn);
                    return 1;
                }
            }
        } else {
            pendingDoubleCheck = 1;
            firstSpikeTime = now;
            firstSpikeMagnitude = magDyn;
        }
    }

    if (pendingDoubleCheck == 1 && (now - firstSpikeTime > TWO_WHEEL_MAX_DELAY_MS)) {
        pendingDoubleCheck = 0;
        evState = EV_IDLE;
    }

    return 0;
}

// ============================================================
// POLYLINE SEGMENT
// ============================================================
void updatePolylineSegment(float depth, bool depthValid) {
    bool hasFlood = depthValid && (depth >= DRY_THRESHOLD_CM);

    if (hasFlood) {
        if (currentSegment == "") {
            currentSegment = "seg_" + String(millis());
            segmentStartTime = millis();
            Serial.printf("[SEG] Genangan: %s | depth=%.1f\n",
                          currentSegment.c_str(), depth);
        }
    } else {
        if (currentSegment != "") {
            Serial.printf("[SEG] Berakhir: %s\n", currentSegment.c_str());
            currentSegment = "";
        }
    }
}

// ============================================================
// FIREBASE REST
// ============================================================
bool fbPush(String path, String json) {
    if (WiFi.status() != WL_CONNECTED) return false;

    HTTPClient https;
    String url = String(FB_HOST) + path + ".json";

    if (!https.begin(secureClient, url)) return false;

    https.addHeader("Content-Type", "application/json");
    https.setTimeout(3000);

    int httpCode = https.PUT(json);
    https.end();

    return (httpCode == 200);
}

void firebaseSendCurrentReading(double lat, double lng, int sats, bool isReal,
                                 float depth, String status, bool depthValid) {
    String json = "{";
    json += "\"latitude\":\"" + String(lat, 6) + "\",";
    json += "\"longitude\":\"" + String(lng, 6) + "\",";
    json += "\"depth\":\"" + String(depth, 1) + "\",";
    json += "\"status\":\"" + status + "\",";
    json += "\"depth_valid\":" + String(depthValid ? "true" : "false") + ",";
    json += "\"satellites\":" + String(sats) + ",";
    json += "\"source\":\"" + String(isReal ? "gps" : "fallback") + "\",";
    json += "\"imuZ\":\"" + String(dynamicImuZ, 3) + "\",";
    json += "\"timestamp\":" + String((double)(millis() + 1731000000000ULL));
    json += "}";

    if (fbPush("/current_reading", json)) totalCurrentReadings++;
}

bool firebaseSendFloodPoint(double lat, double lng, int sats, bool isReal,
                            float depth, String status, bool depthValid) {
    if (!isReal) return false;

    bool shouldSend = false;
    if (!hasSentFirst) shouldSend = true;
    else {
        double dist = TinyGPSPlus::distanceBetween(lastSentLat, lastSentLng, lat, lng);
        float depthChange = absf(depth - lastSentDepth);
        if (dist > MIN_MOVEMENT_M) shouldSend = true;
        else if (depthChange > MIN_DEPTH_CHANGE) shouldSend = true;
    }

    if (!shouldSend) return false;

    float pitch, roll;
    mpuReadTilt(pitch, roll);

    String key = "reading_" + String(millis());
    String json = "{";
    json += "\"latitude\":\"" + String(lat, 6) + "\",";
    json += "\"longitude\":\"" + String(lng, 6) + "\",";
    json += "\"depth\":\"" + String(depth, 1) + "\",";
    json += "\"status\":\"" + status + "\",";
    json += "\"depth_valid\":" + String(depthValid ? "true" : "false") + ",";
    json += "\"imuZ\":\"" + String(dynamicImuZ, 3) + "\",";
    json += "\"pitch\":\"" + String(pitch, 2) + "\",";
    json += "\"roll\":\"" + String(roll, 2) + "\",";
    json += "\"segment_id\":\"" + currentSegment + "\",";
    json += "\"satellites\":" + String(sats) + ",";
    json += "\"source\":\"gps\",";
    json += "\"timestamp\":" + String((double)(millis() + 1731000000000ULL));
    json += "}";

    if (fbPush("/flood_points/" + key, json)) {
        lastSentLat = lat; lastSentLng = lng;
        lastSentDepth = depth;
        hasSentFirst = true;
        Serial.printf("[FB] flood: depth=%.1f\n", depth);
        return true;
    }
    return false;
}

void firebaseSendRoadEvent(String type, double lat, double lng,
                           float magnitude, float z_axis, float delay_ms) {
    totalEvents++;
    String key = "event_" + String(millis());
    String json = "{";
    json += "\"event_type\":\"" + type + "\",";
    json += "\"latitude\":\"" + String(lat, 6) + "\",";
    json += "\"longitude\":\"" + String(lng, 6) + "\",";
    json += "\"magnitude_g\":\"" + String(magnitude, 2) + "\",";
    json += "\"z_axis_g\":\"" + String(z_axis, 2) + "\",";
    json += "\"delay_ms\":\"" + String(delay_ms, 0) + "\",";
    json += "\"device\":\"ESP32-01\",";
    json += "\"timestamp\":" + String((double)(millis() + 1731000000000ULL));
    json += "}";

    if (fbPush("/road_events/" + key, json))
        Serial.printf("[FB] Event: %s\n", type.c_str());
}

void firebaseSendSystemStatus(bool gpsOk) {
    String json = "{";
    json += "\"esp32_online\":true,";
    json += "\"gps_status\":\"" + String(gpsOk ? "aktif" : "fallback") + "\",";
    json += "\"sensor_status\":\"aktif\",";
    json += "\"imu_status\":\"" + String(mpuCalibrated ? "aktif" : "kalibrasi") + "\",";
    json += "\"total_events\":" + String(totalEvents) + ",";
    json += "\"total_readings\":" + String(totalSent) + ",";
    json += "\"total_current_readings\":" + String(totalCurrentReadings) + ",";
    json += "\"active_segment\":\"" + currentSegment + "\",";
    json += "\"last_update\":" + String((double)millis());
    json += "}";

    fbPush("/system_status", json);
}

// ============================================================
// SETUP
// ============================================================
void setup() {
    Serial.begin(115200);
    delay(500);
    Serial.println("\n===========================================");
    Serial.println(" FloodMap — FINAL v18");
    Serial.println(" Fix: time-based timeout reset");
    Serial.println("===========================================");

    randomSeed(esp_random());

    for (int i = 0; i < RAW_BUFFER_SIZE; i++) rawBuffer[i] = SENSOR_HEIGHT_CM;
    rawCount = 0;
    rawIdx = 0;
    latestDepth = 0;
    lastValidReadTime = millis();

    ultrasonicInit();
    mpuInit();
    mpuCalibrate();
    gpsInit();

    WiFi.mode(WIFI_STA);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    Serial.print("[WiFi] Menghubungkan");
    int tries = 0;
    while (WiFi.status() != WL_CONNECTED && tries++ < 40) {
        Serial.print("."); delay(500);
    }
    if (WiFi.status() != WL_CONNECTED) {
        Serial.println("\n[WiFi] Gagal. Restart...");
        ESP.restart();
    }
    Serial.println("\n[WiFi] OK: " + WiFi.localIP().toString());
    Serial.printf("[WiFi] RSSI: %d dBm\n", WiFi.RSSI());

    secureClient.setInsecure();
    secureClient.setTimeout(5);

    Serial.println("[SYS] Sistem siap\n");
}

// ============================================================
// LOOP
// ============================================================
void loop() {
    gpsUpdate();
    ultrasonicUpdateFast();

    // 🔧 Debug log — tampilkan umur valid read
    static unsigned long lastDebug = 0;
    if (millis() - lastDebug > 3000) {
        lastDebug = millis();
        unsigned long age = millis() - lastValidReadTime;
        Serial.printf("[DEBUG] raw=%.1f depth=%.1f buffer=%d age=%lu | sat=%d\n",
                      latestRaw, latestDepth, rawCount, age, gps.satellites.value());
    }

    // MPU event
    static unsigned long lastMpu = 0;
    if (millis() - lastMpu >= MPU_SAMPLE_MS) {
        lastMpu = millis();
        float peak = 0;
        int event = mpuDetectEvent(peak);
        if (event != 0) {
            double lat, lng; int sats; bool isReal;
            gpsGetPosition(lat, lng, sats, isReal);
            if (isReal) {
                unsigned long delayMs = millis() - firstSpikeTime;
                String type = (event == 1) ? "pothole" : "speed_bump";
                firebaseSendRoadEvent(type, lat, lng, peak, peak, delayMs);
            }
        }
    }

    // Current reading
    static unsigned long lastCR = 0;
    if (millis() - lastCR >= CURRENT_READING_INTERVAL_MS) {
        lastCR = millis();

        if (WiFi.status() == WL_CONNECTED) {
            float depth = latestDepth;
            if (eventActive && (millis() - eventDetectedAt < EVENT_SUPPRESS_MS)) {
                depth = stableDepth;
            }

            mpuReadDynamic();

            double lat, lng; int sats; bool isReal;
            gpsGetPosition(lat, lng, sats, isReal);

            String status = classifyStatus(depth);

            unsigned long t0 = millis();
            firebaseSendCurrentReading(lat, lng, sats, isReal, depth, status, true);
            unsigned long dt = millis() - t0;

            Serial.printf("[CR] depth=%.1f | HTTP %lu ms\n", depth, dt);
        }
    }

    // Flood points
    if (millis() - lastSendTime >= SEND_INTERVAL_MS) {
        lastSendTime = millis();

        if (WiFi.status() == WL_CONNECTED) {
            double lat, lng; int sats; bool isReal;
            gpsGetPosition(lat, lng, sats, isReal);

            bool depthSuppressed = eventActive &&
                                   (millis() - eventDetectedAt < EVENT_SUPPRESS_MS);
            float depth = depthSuppressed ? stableDepth : latestDepth;
            String status = depthSuppressed ? "suppressed" : classifyStatus(depth);
            bool depthValid = !depthSuppressed;

            mpuReadDynamic();

            if (isReal) {
                updatePolylineSegment(depth, depthValid);
                firebaseSendFloodPoint(lat, lng, sats, isReal, depth, status, depthValid);
            }

            firebaseSendSystemStatus(isReal);
            totalSent++;
        }
    }
}