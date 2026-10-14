// ============================================================
// FloodMap — ESP32 Sensor Fusion (FINAL v11)
// Dual Timer: Current Reading 10x/detik + Flood Points 1x/detik
// + Deteksi Gerakan + Heartbeat System Status
// ============================================================

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <Wire.h>
#include <TinyGPSPlus.h>
#include <HardwareSerial.h>

#define ENABLE_DATABASE
#include <FirebaseClient.h>

// ============================================================
// KONFIGURASI
// ============================================================
#define WIFI_SSID       "labubu"
#define WIFI_PASSWORD   "tabbu098"
#define DATABASE_URL    "https://geo-flood-5cfc6-default-rtdb.asia-southeast1.firebasedatabase.app"

// --- GPS ---
#define GPS_RX_PIN   16
#define GPS_TX_PIN   17
#define GPS_BAUD     9600

// --- JSN-SR04T ---
#define TRIG_PIN     27
#define ECHO_PIN     14
#define SENSOR_HEIGHT_CM   45.0
#define MIN_VALID_DEPTH    3.0
#define MAX_VALID_DEPTH    100.0
#define MAX_DISTANCE_CM    400.0

// --- MPU6050 ---
#define MPU_ADDR            0x68
#define ACCEL_SCALE         4096.0
#define MPU_SAMPLE_MS       5

// --- Deteksi Event ---
#define HPF_ALPHA           0.92
#define IMPACT_MIN_G        1.3
#define DROP_MAX_G          0.55
#define BUMP_RISE_MIN_G     0.30
#define BUMP_RISE_MAX_G     1.0
#define COOLDOWN_MS         2000

// --- Metode 2 Ban ---
#define TWO_WHEEL_MIN_DELAY_MS  80
#define TWO_WHEEL_MAX_DELAY_MS  400

// --- Interval (DUAL TIMER) ---
#define CURRENT_READING_INTERVAL_MS  100    // 10x/detik
#define SEND_INTERVAL_MS             1000   // 1x/detik (flood_points)
#define ULTRASONIC_SAMPLES           3
#define ULTRASONIC_DELAY_MS          20
#define EVENT_SUPPRESS_MS            1500

// --- Deteksi Gerakan (untuk flood_points) ---
#define MIN_MOVEMENT_M      5.0
#define MIN_DEPTH_CHANGE    3.0

// --- GPS Quality ---
#define GPS_MIN_SAT         4
#define GPS_MAX_HDOP        3.5
#define GPS_MAX_AGE_MS      2000

// ============================================================
// OBJEK GLOBAL
// ============================================================
TinyGPSPlus gps;
HardwareSerial gpsSerial(2);

WiFiClientSecure sslClient;
AsyncClientClass aClient(sslClient);
FirebaseApp app;
RealtimeDatabase Database;
NoAuth noAuth;

unsigned long lastSendTime = 0;
unsigned long totalSent = 0;
unsigned long totalEvents = 0;
unsigned long totalCurrentReadings = 0;
String currentSegment = "";

// Segment tracking
unsigned long segmentStartTime = 0;

// Deteksi gerakan untuk flood_points
double lastSentLat = 0;
double lastSentLng = 0;
float lastSentDepth = 0;
bool hasSentFirst = false;

// MPU
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
unsigned long suppressedReadings = 0;

float stableDepth = 0;
int stableCount = 0;

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
    // Debug log tiap 5 detik (untuk diagnosa)
    static unsigned long lastLog = 0;
    if (millis() - lastLog > 5000) {
        lastLog = millis();
        Serial.printf("[GPS-DEBUG] valid=%d age=%u sat=%d hdop=%.1f\n",
                      gps.location.isValid(),
                      gps.location.age(),
                      gps.satellites.value(),
                      gps.hdop.hdop());
    }

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
    Serial.printf("[US] TRIG=%d ECHO=%d | %d sampel × %dms\n",
                  TRIG_PIN, ECHO_PIN, ULTRASONIC_SAMPLES, ULTRASONIC_DELAY_MS);
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

float ultrasonicReadFiltered() {
    const int N = ULTRASONIC_SAMPLES;
    float s[N]; int n = 0;
    for (int i = 0; i < N; i++) {
        float d = ultrasonicReadOnce();
        if (d > 0 && d < MAX_DISTANCE_CM) s[n++] = d;
        delay(ULTRASONIC_DELAY_MS);
    }
    if (n < 2) return -1;

    for (int i = 0; i < n - 1; i++)
        for (int j = i + 1; j < n; j++)
            if (s[j] < s[i]) { float t = s[i]; s[i] = s[j]; s[j] = t; }

    float med = (n % 2 == 0) ? (s[n/2-1] + s[n/2]) / 2.0 : s[n/2];

    float sum = 0; int kept = 0;
    for (int i = 0; i < n; i++) {
        if (absf(s[i] - med) <= 15.0) { sum += s[i]; kept++; }
    }
    if (kept == 0) return med;

    float depth = SENSOR_HEIGHT_CM - (sum / kept);
    if (depth < 0) depth = 0;
    if (depth > MAX_VALID_DEPTH) return -1;
    return depth;
}

float ultrasonicReadStable() {
    unsigned long now = millis();
    if (eventActive) {
        if (now - eventDetectedAt < EVENT_SUPPRESS_MS) {
            suppressedReadings++;
            return stableDepth;
        } else {
            eventActive = false;
        }
    }
    float raw = ultrasonicReadFiltered();
    if (raw < 0) return stableDepth;
    if (raw < MIN_VALID_DEPTH) { stableDepth = 0; stableCount++; return 0; }
    if (stableCount >= 3 && absf(raw - stableDepth) > 30.0) return stableDepth;
    if (absf(raw - stableDepth) > 5.0) stableCount = 0;
    else stableCount++;
    stableDepth = raw;
    return raw;
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
    Serial.println("[MPU] Kalibrasi (3 dtk, jangan gerakkan)");
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
// DETEKSI EVENT — METODE 2 BAN
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

                float avgMag = (firstSpikeMagnitude + magDyn) / 2.0;

                if (zDyn > BUMP_RISE_MIN_G && zDyn < BUMP_RISE_MAX_G && delay > 200) {
                    Serial.printf("[MPU] SPEED BUMP (2ban) delay=%lums mag=%.2fg\n",
                                  delay, avgMag);
                    return 2;
                } else {
                    Serial.printf("[MPU] POTHOLE (2ban) delay=%lums mag=%.2fg\n",
                                  delay, avgMag);
                    return 1;
                }
            }
        } else {
            pendingDoubleCheck = 1;
            firstSpikeTime = now;
            firstSpikeMagnitude = magDyn;
            Serial.printf("[MPU] Spike#1 mag=%.2fg\n", magDyn);
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
void updatePolylineSegment(double lat, double lng, float depth, bool depthValid) {
    bool hasFlood = depthValid && (depth >= MIN_VALID_DEPTH);

    if (hasFlood) {
        if (currentSegment == "") {
            currentSegment = "seg_" + String(millis());
            segmentStartTime = millis();
            Serial.printf("[SEG] 🆕 Genangan baru: %s | depth=%.1f\n",
                          currentSegment.c_str(), depth);
        }
    } else {
        if (currentSegment != "") {
            unsigned long duration = millis() - segmentStartTime;
            Serial.printf("[SEG] ✔️  Genangan berakhir: %s | durasi=%lu dtk\n",
                          currentSegment.c_str(), duration / 1000);
            currentSegment = "";
        }
    }
}

// ============================================================
// FIREBASE
// ============================================================
void firebaseInit() {
    sslClient.setInsecure();
    initializeApp(aClient, app, getAuth(noAuth));
    app.getApp<RealtimeDatabase>(Database);
    Database.url(DATABASE_URL);
    Serial.println("[FB] Firebase siap");
}

// ============================================================
// CURRENT READING — 10x/detik (tanpa log)
// ============================================================
void firebaseSendCurrentReading(double lat, double lng, int sats, bool isReal,
                                 float depth, String status, bool depthValid) {
    String basePath = "/current_reading";

    Database.set<String>(aClient, basePath + "/latitude",   String(lat, 6));
    Database.set<String>(aClient, basePath + "/longitude",  String(lng, 6));
    Database.set<String>(aClient, basePath + "/depth",      String(depth, 1));
    Database.set<String>(aClient, basePath + "/status",     status);
    Database.set<bool>(aClient,   basePath + "/depth_valid", depthValid);
    Database.set<String>(aClient, basePath + "/imuZ",       String(dynamicImuZ, 3));
    Database.set<String>(aClient, basePath + "/imuMag",     String(dynamicImuMag, 3));
    Database.set<int>(aClient,    basePath + "/satellites", sats);
    Database.set<String>(aClient, basePath + "/source",     String(isReal ? "gps" : "fallback"));
    Database.set<double>(aClient, basePath + "/timestamp",  (double)(millis() + 1731000000000ULL));

    float pitch, roll;
    mpuReadTilt(pitch, roll);
    Database.set<String>(aClient, basePath + "/pitch",      String(pitch, 2));
    Database.set<String>(aClient, basePath + "/roll",       String(roll, 2));

    totalCurrentReadings++;
}

// ============================================================
// FLOOD POINT — hanya kirim saat bergerak/depth berubah
// ============================================================
bool firebaseSendFloodPoint(double lat, double lng, int sats, bool isReal,
                            float depth, String status, bool depthValid) {
    if (!isReal) return false;

    bool shouldSend = false;

    if (!hasSentFirst) {
        shouldSend = true;
        Serial.println("[FLOOD] ✅ Titik pertama");
    } else {
        double dist = TinyGPSPlus::distanceBetween(lastSentLat, lastSentLng, lat, lng);
        float depthChange = absf(depth - lastSentDepth);

        if (dist > MIN_MOVEMENT_M) {
            shouldSend = true;
            Serial.printf("[FLOOD] ✅ Bergerak %.1f m\n", dist);
        } else if (depthChange > MIN_DEPTH_CHANGE) {
            shouldSend = true;
            Serial.printf("[FLOOD] ✅ Depth berubah %.1f cm\n", depthChange);
        }
    }

    if (!shouldSend) return false;

    String basePath = "/flood_points/reading_" + String(millis());

    float pitch, roll;
    mpuReadTilt(pitch, roll);

    Database.set<String>(aClient, basePath + "/latitude",   String(lat, 6));
    Database.set<String>(aClient, basePath + "/longitude",  String(lng, 6));
    Database.set<String>(aClient, basePath + "/depth",      String(depth, 1));
    Database.set<String>(aClient, basePath + "/status",     status);
    Database.set<bool>(aClient,   basePath + "/depth_valid", depthValid);
    Database.set<String>(aClient, basePath + "/location",   String(""));
    Database.set<double>(aClient, basePath + "/timestamp",  (double)(millis() + 1731000000000ULL));
    Database.set<String>(aClient, basePath + "/imuZ",       String(dynamicImuZ, 3));
    Database.set<String>(aClient, basePath + "/imuMag",     String(dynamicImuMag, 3));
    Database.set<String>(aClient, basePath + "/pitch",      String(pitch, 2));
    Database.set<String>(aClient, basePath + "/roll",       String(roll, 2));
    Database.set<String>(aClient, basePath + "/segment_id", currentSegment);
    Database.set<int>(aClient,    basePath + "/satellites", sats);
    Database.set<String>(aClient, basePath + "/source",     String("gps"));

    lastSentLat = lat;
    lastSentLng = lng;
    lastSentDepth = depth;
    hasSentFirst = true;

    if (aClient.lastError().code() == 0) {
        Serial.printf("[FB] 📍 Push: %.6f,%.6f | depth=%.1f\n", lat, lng, depth);
        return true;
    } else {
        Serial.printf("[FB] Error: %s\n", aClient.lastError().message().c_str());
        return false;
    }
}

void firebaseSendRoadEvent(String type, double lat, double lng,
                           float magnitude, float z_axis, float delay_ms) {
    totalEvents++;
    String basePath = "/road_events/event_" + String(millis());

    Database.set<String>(aClient, basePath + "/event_type",  type);
    Database.set<String>(aClient, basePath + "/latitude",    String(lat, 6));
    Database.set<String>(aClient, basePath + "/longitude",   String(lng, 6));
    Database.set<String>(aClient, basePath + "/magnitude_g", String(magnitude, 2));
    Database.set<String>(aClient, basePath + "/z_axis_g",    String(z_axis, 2));
    Database.set<String>(aClient, basePath + "/delay_ms",    String(delay_ms, 0));
    Database.set<double>(aClient, basePath + "/timestamp",   (double)(millis() + 1731000000000ULL));
    Database.set<String>(aClient, basePath + "/device",      String("ESP32-01"));

    if (aClient.lastError().code() == 0) {
        Serial.printf("[FB] ✅ Event #%lu: %s @ %.6f,%.6f\n",
                      totalEvents, type.c_str(), lat, lng);
    }
}

void firebaseSendSystemStatus(bool gpsOk) {
    Database.set<bool>(aClient,   "/system_status/esp32_online", true);
    Database.set<double>(aClient, "/system_status/last_update",  (double)millis());
    Database.set<String>(aClient, "/system_status/gps_status",
                         String(gpsOk ? "aktif" : "fallback"));
    Database.set<String>(aClient, "/system_status/sensor_status", String("aktif"));
    Database.set<String>(aClient, "/system_status/imu_status",
                         String(mpuCalibrated ? "aktif" : "kalibrasi"));
    Database.set<int>(aClient, "/system_status/total_events", totalEvents);
    Database.set<int>(aClient, "/system_status/total_readings", totalSent);
    Database.set<int>(aClient, "/system_status/total_current_readings", totalCurrentReadings);
    Database.set<String>(aClient, "/system_status/active_segment", currentSegment);
}

// ============================================================
// SETUP
// ============================================================
void setup() {
    Serial.begin(115200);
    delay(500);
    Serial.println("\n===========================================");
    Serial.println(" FloodMap — Sensor Fusion FINAL v11");
    Serial.println(" Dual Timer: CR 10x/dtk + FP 1x/dtk");
    Serial.println("===========================================");

    randomSeed(esp_random());

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

    firebaseInit();
    Serial.println("[SYS] Sistem siap\n");
    Serial.println("Format log:");
    Serial.println("  [GPS-DEBUG] = status GPS tiap 5 dtk");
    Serial.println("  [#N] = flood_point 1x/detik");
    Serial.println("  (current_reading tidak di-log, 10x/detik)\n");
}

// ============================================================
// LOOP — 2 Timer Terpisah
// ============================================================
void loop() {
    gpsUpdate();

    // ============================================================
    // 1. MPU EVENT DETECTION (200 Hz)
    // ============================================================
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
                Serial.printf("[EVENT] (%.6f,%.6f) — %s\n", lat, lng, type.c_str());
            }
        }
    }

    // ============================================================
    // 2. CURRENT READING — 10x per detik (100ms)
    // ============================================================
    static unsigned long lastCurrentReading = 0;
    if (millis() - lastCurrentReading >= CURRENT_READING_INTERVAL_MS) {
        lastCurrentReading = millis();

        if (WiFi.status() == WL_CONNECTED) {
            float depth = ultrasonicReadStable();

            if (eventActive && (millis() - eventDetectedAt < EVENT_SUPPRESS_MS)) {
                depth = stableDepth;
            }

            mpuReadDynamic();

            double lat, lng; int sats; bool isReal;
            gpsGetPosition(lat, lng, sats, isReal);

            String status = classifyStatus(depth);

            firebaseSendCurrentReading(lat, lng, sats, isReal, depth, status, true);
        }
    }

    // ============================================================
    // 3. FLOOD POINTS + SYSTEM STATUS — 1x per detik
    // ============================================================
    if (millis() - lastSendTime >= SEND_INTERVAL_MS) {
        lastSendTime = millis();

        if (WiFi.status() != WL_CONNECTED) {
            Serial.println("[WiFi] Terputus");
        } else {
            double lat, lng; int sats; bool isReal;
            gpsGetPosition(lat, lng, sats, isReal);

            bool depthSuppressed = eventActive &&
                                   (millis() - eventDetectedAt < EVENT_SUPPRESS_MS);
            float depth;
            String status;
            bool depthValid;

            if (depthSuppressed) {
                depth = stableDepth;
                status = "suppressed";
                depthValid = false;
            } else {
                depth = ultrasonicReadStable();
                status = classifyStatus(depth);
                depthValid = true;
            }

            mpuReadDynamic();

            if (isReal) {
                updatePolylineSegment(lat, lng, depth, depthValid);
            }

            firebaseSendFloodPoint(lat, lng, sats, isReal, depth, status, depthValid);
            firebaseSendSystemStatus(isReal);

            totalSent++;
            Serial.printf("[#%lu] %.6f,%.6f | sat=%d | depth=%.1f | %s | %s\n",
                          totalSent, lat, lng, sats, depth, status.c_str(),
                          !isReal ? "FALLBACK" :
                          (currentSegment == "" ? "KERING" : currentSegment.c_str()));
        }
    }

    app.loop();
}