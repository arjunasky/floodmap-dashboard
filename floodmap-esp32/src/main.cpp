// ============================================================
// FloodMap — ESP32 Sensor Fusion (FINAL v22)
// GPS Diagnostic + Optimized Thresholds
// Gravity Tracking + Adaptive 2-Wheel + REST API Firebase
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

// --- GPS ---
#define GPS_RX_PIN   16
#define GPS_TX_PIN   17
#define GPS_BAUD     9600

// --- JSN-SR04T ---
#define TRIG_PIN           27
#define ECHO_PIN           14
#define SENSOR_HEIGHT_CM   45.0
#define BLINDSPOT_CM       20.0
#define MAX_DEPTH_CM       25.0
#define DRY_THRESHOLD_CM   3.0
#define MAX_DISTANCE_CM    400.0

// --- MPU6050 ---
#define MPU_ADDR            0x68
#define ACCEL_SCALE         4096.0
#define MPU_SAMPLE_MS       5

// --- Gravity Tracking ---
#define GRAV_ALPHA          0.95
#define GRAV_UPDATE_MS      500

// --- Deteksi Event (2 Ban Adaptive) ---
#define POTHOLE_DROP_G          -0.3
#define POTHOLE_IMPACT_G        0.8
#define BUMP_RISE_G             0.3
#define BUMP_RISE_MAX_G         1.5
#define TWO_WHEEL_BASE_M        1.3
#define TWO_WHEEL_MIN_DELAY_MS  60
#define TWO_WHEEL_MAX_DELAY_MS  600
#define SPEED_MIN_KMPH          5.0
#define COOLDOWN_MS             2500

// --- Ultrasonic ---
#define ULTRASONIC_INTERVAL_MS  50
#define RAW_BUFFER_SIZE         20
#define MODE_WINDOW             5
#define VALID_TIMEOUT_MS        2500

// --- Interval Kirim ---
#define SENSOR_LOG_INTERVAL_MS       3000
#define CURRENT_READING_INTERVAL_MS  3000
#define SEND_INTERVAL_MS             6000
#define EVENT_SUPPRESS_MS            1500

// --- Deteksi Gerakan ---
#define MIN_MOVEMENT_M      5.0
#define MIN_DEPTH_CHANGE    3.0

// --- GPS Quality (OPTIMIZED) ---
#define GPS_MIN_SAT         4       // Minimal 4 satelit
#define GPS_MAX_HDOP        5.0     // Dilonggarkan dari 3.5
#define GPS_MAX_AGE_MS      2500    // Sedikit lebih toleran

// ============================================================
// OBJEK GLOBAL
// ============================================================
TinyGPSPlus gps;
HardwareSerial gpsSerial(2);

unsigned long lastSendTime = 0;
unsigned long lastSensorLogTime = 0;
unsigned long totalSent = 0;
unsigned long totalEvents = 0;
unsigned long totalCurrentReadings = 0;
unsigned long totalSensorLogs = 0;
String currentSegment = "";

unsigned long segmentStartTime = 0;
double lastSentLat = 0, lastSentLng = 0;
float lastSentDepth = 0;
bool hasSentFirst = false;

// MPU Gravity Tracking
float grav_x = 0, grav_y = 0, grav_z = 1.0;
unsigned long lastGravUpdate = 0;
float dynamicImuZ = 0.0;
float dynamicImuMag = 0.0;

// State Machine Event
enum EventState { EV_IDLE, EV_RISING, EV_FALLING, EV_COOLDOWN };
EventState evState = EV_IDLE;
unsigned long evStateStart = 0;
float evPeakG = 0;
unsigned long lastSpikeTime = 0;
int pendingDoubleCheck = 0;
unsigned long firstSpikeTime = 0;
float firstSpikeMagnitude = 0;

bool spike1HasDrop = false;
bool spike1HasImpact = false;
float spike1DropValue = 0;
float spike1ImpactValue = 0;

bool eventActive = false;
unsigned long eventDetectedAt = 0;
float stableDepth = 0;

// Ultrasonic
float rawBuffer[RAW_BUFFER_SIZE];
int rawIdx = 0;
int rawCount = 0;
float latestDepth = 0;
float latestRaw = 0;
unsigned long lastValidReadTime = 0;
unsigned long lastUltrasonicRead = 0;

WiFiClientSecure secureClient;

// ============================================================
// UTIL
// ============================================================
// CLASSIFY STATUS — dengan Kering
// ============================================================
String classifyStatus(float depth) {
    if (depth < DRY_THRESHOLD_CM) return "kering";   // 🔧 < 3 cm = kering
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
    Serial.printf("[GPS] RX=%d TX=%d @%d baud\n", GPS_RX_PIN, GPS_TX_PIN, GPS_BAUD);
}

void gpsUpdate() {
    while (gpsSerial.available() > 0) gps.encode(gpsSerial.read());
}

// ============================================================
// GPS QUALITY CHECK — dengan DIAGNOSTIC LOG
// ============================================================
bool gpsHasFix() {
    // ============================================================
    // DIAGNOSTIC LOG — tiap 5 detik
    // ============================================================
    static unsigned long lastLog = 0;
    if (millis() - lastLog > 5000) {
        lastLog = millis();
        Serial.printf("[GPS-DEBUG] chars=%lu pass=%lu fail=%lu | valid=%d age=%u sat=%d hdop=%.1f\n",
                      gps.charsProcessed(),
                      gps.passedChecksum(),
                      gps.failedChecksum(),
                      gps.location.isValid(),
                      gps.location.age(),
                      gps.satellites.value(),
                      gps.hdop.hdop());
    }

    // ============================================================
    // Cek 1: ESP32 terima data GPS?
    // ============================================================
    if (gps.charsProcessed() < 100) {
        static unsigned long lastWarn = 0;
        if (millis() - lastWarn > 10000) {
            lastWarn = millis();
            Serial.println("❌ GPS TIDAK TRANSMISI — cek kabel TX/RX + baud");
            Serial.printf("   chars=%lu (harus > 100)\n", gps.charsProcessed());
        }
        return false;
    }

    // ============================================================
    // Cek 2: NMEA valid? (checksum)
    // ============================================================
    if (gps.failedChecksum() > gps.passedChecksum() * 0.5) {
        static unsigned long lastWarn = 0;
        if (millis() - lastWarn > 10000) {
            lastWarn = millis();
            Serial.println("❌ BANYAK CHECKSUM ERROR — baud rate salah");
            Serial.printf("   pass=%lu fail=%lu\n",
                          gps.passedChecksum(), gps.failedChecksum());
        }
        return false;
    }

    // ============================================================
    // Cek 3: Lokasi valid?
    // ============================================================
    if (!gps.location.isValid()) return false;

    // ============================================================
    // Cek 4: Data fresh?
    // ============================================================
    if (gps.location.age() > GPS_MAX_AGE_MS) return false;

    // ============================================================
    // Cek 5: Satelit cukup?
    // ============================================================
    if (gps.satellites.value() < GPS_MIN_SAT) return false;

    // ============================================================
    // Cek 6: HDOP OK?
    // ============================================================
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

void ultrasonicUpdateFast() {
    unsigned long now = millis();
    if (now - lastUltrasonicRead < ULTRASONIC_INTERVAL_MS) return;
    lastUltrasonicRead = now;

    float raw = ultrasonicReadOnce();
    latestRaw = raw;

    // TIMEOUT
    if (raw < 0) {
        if (lastValidReadTime > 0 && (now - lastValidReadTime) > VALID_TIMEOUT_MS) {
            if (latestDepth != 0) Serial.println("[US] Timeout lama — reset ke 0");
            latestDepth = 0;
            rawCount = 0;
            rawIdx = 0;
            lastValidReadTime = now;
        }
        return;
    }

    // BLINDSPOT
    if (raw < BLINDSPOT_CM) {
        latestDepth = MAX_DEPTH_CM;
        lastValidReadTime = now;
        return;
    }

    // KOSONG
    if (raw > SENSOR_HEIGHT_CM) {
        latestDepth = 0;
        rawCount = 0;
        rawIdx = 0;
        lastValidReadTime = now;
        return;
    }

    // VALID
    lastValidReadTime = now;
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
// MPU6050 — Gravity Tracking
// ============================================================
void mpuWrite(uint8_t reg, uint8_t val) {
    Wire.beginTransmission(MPU_ADDR);
    Wire.write(reg);
    Wire.write(val);
    Wire.endTransmission();
}

void mpuInit() {
    Wire.begin(21, 22);
    delay(100);
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

float mpuReadDynamic() {
    float ax, ay, az;
    mpuReadRaw(ax, ay, az);

    unsigned long now = millis();
    if (now - lastGravUpdate >= GRAV_UPDATE_MS) {
        lastGravUpdate = now;
        grav_x = GRAV_ALPHA * grav_x + (1.0 - GRAV_ALPHA) * ax;
        grav_y = GRAV_ALPHA * grav_y + (1.0 - GRAV_ALPHA) * ay;
        grav_z = GRAV_ALPHA * grav_z + (1.0 - GRAV_ALPHA) * az;
    }

    float dx = ax - grav_x;
    float dy = ay - grav_y;
    float dz = az - grav_z;

    dynamicImuZ = dz;
    dynamicImuMag = sqrt(dx*dx + dy*dy + dz*dz);
    return dynamicImuMag;
}

float mpuReadZDynamic() {
    float ax, ay, az;
    mpuReadRaw(ax, ay, az);
    return az - grav_z;
}

void mpuReadTilt(float &pitch, float &roll) {
    float ax, ay, az;
    mpuReadRaw(ax, ay, az);
    pitch = atan2(-ax, sqrt(ay*ay + az*az)) * 180.0 / PI;
    roll  = atan2(ay, az) * 180.0 / PI;
}

void mpuCalibrate() {
    Serial.println("[MPU] Kalibrasi baseline (3 dtk, jangan gerakkan)");
    delay(500);

    const int N = 100;
    float sx = 0, sy = 0, sz = 0;
    for (int i = 0; i < N; i++) {
        float ax, ay, az;
        mpuReadRaw(ax, ay, az);
        sx += ax; sy += ay; sz += az;
        delay(20);
    }

    grav_x = sx / N;
    grav_y = sy / N;
    grav_z = sz / N;
    lastGravUpdate = millis();

    Serial.printf("[MPU] Baseline: X=%+.3f Y=%+.3f Z=%+.3f\n",
                  grav_x, grav_y, grav_z);
}

// ============================================================
// DETEKSI EVENT — Metode 2 Ban Adaptive
// ============================================================
int mpuDetectEvent(float &peak_out) {
    unsigned long now = millis();

    if (evState == EV_COOLDOWN) {
        if (now - evStateStart > COOLDOWN_MS) {
            evState = EV_IDLE;
            pendingDoubleCheck = 0;
            spike1HasDrop = false;
            spike1HasImpact = false;
        }
        return 0;
    }

    float zDyn = mpuReadZDynamic();
    float magDyn = mpuReadDynamic();

    if (absf(zDyn) > absf(peak_out)) peak_out = zDyn;

    bool hasDrop = (zDyn < POTHOLE_DROP_G);
    bool hasImpact = (magDyn > POTHOLE_IMPACT_G);
    bool hasBump = (zDyn > BUMP_RISE_G && zDyn < BUMP_RISE_MAX_G);

    if ((hasDrop || hasImpact || hasBump) && (now - lastSpikeTime > 100)) {
        lastSpikeTime = now;

        if (pendingDoubleCheck == 0) {
            pendingDoubleCheck = 1;
            firstSpikeTime = now;
            firstSpikeMagnitude = magDyn;

            spike1HasDrop = hasDrop;
            spike1HasImpact = hasImpact;
            spike1DropValue = hasDrop ? zDyn : 0;
            spike1ImpactValue = hasImpact ? magDyn : 0;

            Serial.printf("[MPU] Spike#1 (depan) mag=%.2f z=%.2f | drop=%d impact=%d bump=%d\n",
                          magDyn, zDyn, hasDrop, hasImpact, hasBump);
            return 0;
        }

        if (pendingDoubleCheck == 1) {
            unsigned long delay = now - firstSpikeTime;

            float speedKmph = gps.speed.isValid() ? gps.speed.kmph() : 0;
            unsigned long minDelay = TWO_WHEEL_MIN_DELAY_MS;
            unsigned long maxDelay = TWO_WHEEL_MAX_DELAY_MS;

            if (speedKmph > SPEED_MIN_KMPH) {
                float speedMs = speedKmph / 3.6;
                unsigned long expectedDelay = (TWO_WHEEL_BASE_M / speedMs) * 1000;
                minDelay = expectedDelay * 0.4;
                maxDelay = expectedDelay * 1.6;
                if (minDelay < TWO_WHEEL_MIN_DELAY_MS) minDelay = TWO_WHEEL_MIN_DELAY_MS;
                if (maxDelay > TWO_WHEEL_MAX_DELAY_MS) maxDelay = TWO_WHEEL_MAX_DELAY_MS;
            }

            if (delay >= minDelay && delay <= maxDelay) {
                evState = EV_COOLDOWN;
                evStateStart = now;
                eventActive = true;
                eventDetectedAt = now;
                pendingDoubleCheck = 0;

                float avgMag = (firstSpikeMagnitude + magDyn) / 2.0;
                bool isPothole = spike1HasDrop || hasDrop || spike1HasImpact;

                if (isPothole) {
                    Serial.printf("[MPU] 🕳️  POTHOLE delay=%lums\n", delay);
                    return 1;
                } else {
                    Serial.printf("[MPU] 🚧 SPEED BUMP delay=%lums\n", delay);
                    return 2;
                }
            }
        }
    }

    if (pendingDoubleCheck == 1 && (now - firstSpikeTime > TWO_WHEEL_MAX_DELAY_MS)) {
        pendingDoubleCheck = 0;
        evState = EV_IDLE;
        spike1HasDrop = false;
        spike1HasImpact = false;
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
// FIREBASE REST API
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

// ============================================================
// CURRENT READING
// ============================================================
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
    json += "\"imuMag\":\"" + String(dynamicImuMag, 3) + "\",";
    json += "\"timestamp\":" + String((double)(millis() + 1731000000000ULL));
    json += "}";

    if (fbPush("/current_reading", json)) totalCurrentReadings++;
}

// ============================================================
// SENSOR LOGS
// ============================================================
// ============================================================
// SENSOR LOGS — SKIP kalau kering (depth < 3cm)
// ============================================================
void firebaseSendSensorLog(double lat, double lng, int sats, bool isReal,
                            float depth, String status, bool depthValid) {
    // 🔧 Skip kalau kering — tidak perlu disimpan ke sensor_logs
    if (depth < DRY_THRESHOLD_CM) {
        return;
    }

    float pitch, roll;
    mpuReadTilt(pitch, roll);

    String key = "log_" + String(millis());
    String basePath = "/sensor_logs/" + key;

    String json = "{";
    json += "\"timestamp\":" + String((double)(millis() + 1731000000000ULL)) + ",";
    json += "\"device\":\"ESP32-01\",";
    json += "\"depth\":\"" + String(depth, 1) + "\",";
    json += "\"depth_raw\":\"" + String(latestRaw, 1) + "\",";
    json += "\"status\":\"" + status + "\",";
    json += "\"depth_valid\":" + String(depthValid ? "true" : "false") + ",";
    json += "\"buffer_count\":" + String(rawCount) + ",";
    json += "\"latitude\":\"" + String(lat, 6) + "\",";
    json += "\"longitude\":\"" + String(lng, 6) + "\",";
    json += "\"satellites\":" + String(sats) + ",";
    json += "\"hdop\":\"" + String(gps.hdop.hdop(), 1) + "\",";
    json += "\"source\":\"" + String(isReal ? "gps" : "fallback") + "\",";
    json += "\"imuZ\":\"" + String(dynamicImuZ, 3) + "\",";
    json += "\"imuMag\":\"" + String(dynamicImuMag, 3) + "\",";
    json += "\"pitch\":\"" + String(pitch, 2) + "\",";
    json += "\"roll\":\"" + String(roll, 2) + "\",";
    json += "\"segment_id\":\"" + currentSegment + "\"";
    json += "}";

    if (fbPush(basePath, json)) totalSensorLogs++;
}

// ============================================================
// FLOOD POINTS
// ============================================================
bool firebaseSendFloodPoint(double lat, double lng, int sats, bool isReal,
                            float depth, String status, bool depthValid) {
    if (!isReal) return false;

    // 🔧 Skip kalau kering — tidak perlu ke flood_points
    if (depth < DRY_THRESHOLD_CM) return false;

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
    json += "\"imuMag\":\"" + String(dynamicImuMag, 3) + "\",";
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

// ============================================================
// ROAD EVENTS
// ============================================================
void firebaseSendRoadEvent(String type, double lat, double lng,
                           float magnitude, float z_axis, float delay_ms, float speed_kmph) {
    totalEvents++;
    String key = "event_" + String(millis());
    String json = "{";
    json += "\"event_type\":\"" + type + "\",";
    json += "\"latitude\":\"" + String(lat, 6) + "\",";
    json += "\"longitude\":\"" + String(lng, 6) + "\",";
    json += "\"magnitude_g\":\"" + String(magnitude, 2) + "\",";
    json += "\"z_axis_g\":\"" + String(z_axis, 2) + "\",";
    json += "\"delay_ms\":\"" + String(delay_ms, 0) + "\",";
    json += "\"speed_kmph\":\"" + String(speed_kmph, 1) + "\",";
    json += "\"wheelbase_m\":\"" + String(TWO_WHEEL_BASE_M, 2) + "\",";
    json += "\"device\":\"ESP32-01\",";
    json += "\"timestamp\":" + String((double)(millis() + 1731000000000ULL));
    json += "}";

    if (fbPush("/road_events/" + key, json)) {
        Serial.printf("[FB] ✅ Event: %s @ %.1f km/h\n", type.c_str(), speed_kmph);
    }
}

// ============================================================
// SYSTEM STATUS
// ============================================================
void firebaseSendSystemStatus(bool gpsOk) {
    String json = "{";
    json += "\"esp32_online\":true,";
    json += "\"gps_status\":\"" + String(gpsOk ? "aktif" : "fallback") + "\",";
    json += "\"sensor_status\":\"aktif\",";
    json += "\"imu_status\":\"aktif\",";
    json += "\"total_events\":" + String(totalEvents) + ",";
    json += "\"total_readings\":" + String(totalSent) + ",";
    json += "\"total_current_readings\":" + String(totalCurrentReadings) + ",";
    json += "\"total_sensor_logs\":" + String(totalSensorLogs) + ",";
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
    Serial.println(" FloodMap — FINAL v22");
    Serial.println(" GPS Diagnostic + Optimized Thresholds");
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

    Serial.println("[SYS] Sistem siap");
    Serial.println("📊 Data tersimpan di:");
    Serial.println("   /sensor_logs     — SEMUA pembacaan (penelitian)");
    Serial.println("   /current_reading — dashboard real-time");
    Serial.println("   /flood_points    — titik genangan");
    Serial.println("   /road_events     — event lubang/polisi tidur");
    Serial.println("   /system_status   — status device\n");
}

// ============================================================
// LOOP — dengan GPS state caching
// ============================================================
void loop() {
    gpsUpdate();
    ultrasonicUpdateFast();

    // ============================================================
    // 🔧 AMBIL STATE GPS SEKALI — pakai di semua blok
    // ============================================================
    double lat, lng;
    int sats;
    bool isReal;
    gpsGetPosition(lat, lng, sats, isReal);    // ← Sekali saja per loop

    // Debug log
    static unsigned long lastDebug = 0;
    if (millis() - lastDebug > 5000) {
        lastDebug = millis();
        Serial.printf("[STATUS] depth=%.1f | imuMag=%.3f | GPS=%s sat=%d | logs=%lu events=%lu\n",
                      latestDepth, dynamicImuMag,
                      isReal ? "FIX" : "FALLBACK", sats,
                      totalSensorLogs, totalEvents);
    }

    // ============================================================
    // MPU Event Detection (200 Hz)
    // ============================================================
    static unsigned long lastMpu = 0;
    if (millis() - lastMpu >= MPU_SAMPLE_MS) {
        lastMpu = millis();
        float peak = 0;
        int event = mpuDetectEvent(peak);

        if (event != 0 && isReal) {          // ← pakai cached isReal
            unsigned long delayMs = millis() - firstSpikeTime;
            String type = (event == 1) ? "pothole" : "speed_bump";
            float speedKmph = gps.speed.isValid() ? gps.speed.kmph() : 0;
            firebaseSendRoadEvent(type, lat, lng, peak, peak, delayMs, speedKmph);
        }
    }

    // ============================================================
    // Sensor Log (3 detik)
    // ============================================================
    if (millis() - lastSensorLogTime >= SENSOR_LOG_INTERVAL_MS) {
        lastSensorLogTime = millis();

        if (WiFi.status() == WL_CONNECTED) {
            float depth = latestDepth;
            if (eventActive && (millis() - eventDetectedAt < EVENT_SUPPRESS_MS)) {
                depth = stableDepth;
            }

            mpuReadDynamic();
            String status = classifyStatus(depth);

            firebaseSendSensorLog(lat, lng, sats, isReal, depth, status, true);
        }
    }

    // ============================================================
    // Current Reading (3 detik)
    // ============================================================
    static unsigned long lastCR = 0;
    if (millis() - lastCR >= CURRENT_READING_INTERVAL_MS) {
        lastCR = millis();

        if (WiFi.status() == WL_CONNECTED) {
            float depth = latestDepth;
            if (eventActive && (millis() - eventDetectedAt < EVENT_SUPPRESS_MS)) {
                depth = stableDepth;
            }

            mpuReadDynamic();
            String status = classifyStatus(depth);

            unsigned long t0 = millis();
            firebaseSendCurrentReading(lat, lng, sats, isReal, depth, status, true);
            unsigned long dt = millis() - t0;

            Serial.printf("[CR] depth=%.1f | GPS=%s sat=%d | HTTP %lu ms\n",
                          depth, isReal ? "FIX" : "FALLBACK", sats, dt);
        }
    }

    // ============================================================
    // Flood Points (6 detik)
    // ============================================================
    if (millis() - lastSendTime >= SEND_INTERVAL_MS) {
        lastSendTime = millis();

        if (WiFi.status() == WL_CONNECTED) {
            bool depthSuppressed = eventActive &&
                                   (millis() - eventDetectedAt < EVENT_SUPPRESS_MS);
            float depth = depthSuppressed ? stableDepth : latestDepth;
            String status = depthSuppressed ? "suppressed" : classifyStatus(depth);
            bool depthValid = !depthSuppressed;

            mpuReadDynamic();

            if (isReal) {                    // ← pakai cached isReal
                updatePolylineSegment(depth, depthValid);
                firebaseSendFloodPoint(lat, lng, sats, isReal, depth, status, depthValid);
            }

            firebaseSendSystemStatus(isReal);   // ← konsisten!
            totalSent++;
        }
    }
}