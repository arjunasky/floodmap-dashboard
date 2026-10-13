// ============================================================
// ESP32 + GPS NEO-7M → Firebase (FirebaseClient Library)
// ============================================================

#include <WiFi.h>
#include <TinyGPSPlus.h>
#include <HardwareSerial.h>

// FirebaseClient — library baru
#define ENABLE_DATABASE
#include <FirebaseClient.h>

// ============================================================
// KONFIGURASI — GANTI DENGAN MILIK ANDA
// ============================================================

#define WIFI_SSID       "labubu"
#define WIFI_PASSWORD   "tabbu098"
#define DATABASE_URL    "https://geo-flood-5cfc6-default-rtdb.asia-southeast1.firebasedatabase.app/"

// ============================================================
// PIN GPS
// ============================================================

static const int GPS_RX_PIN = 16;
static const int GPS_TX_PIN = 17;
static const uint32_t GPS_BAUD = 9600;

// ============================================================
// OBJEK GLOBAL
// ============================================================

TinyGPSPlus gps;
HardwareSerial gpsSerial(2);

// FirebaseClient objects
using AsyncClient = AsyncClientClass;
AsyncClient aClient;
RealtimeDatabase Database;

// SSL client
WiFiClientSecure sslClient;

// Authentication (test mode = no auth)
NoAuth noAuth;

// Throttle
unsigned long lastSendTime = 0;
const unsigned long SEND_INTERVAL = 1000;
unsigned long totalSent = 0;

// ============================================================
// SETUP
// ============================================================

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println();
  Serial.println("===========================================");
  Serial.println(" FloodMap — ESP32 GPS Tracker (FirebaseClient)");
  Serial.println("===========================================");

  // GPS
  gpsSerial.begin(GPS_BAUD, SERIAL_8N1, GPS_RX_PIN, GPS_TX_PIN);
  Serial.println("[GPS] UART2 siap");

  // WiFi
  connectWiFi();

  // Firebase
  sslClient.setInsecure();  // ← untuk testing; produksi pakai certificate
  aClient.setClient(sslClient);
  aClient.setUrl(DATABASE_URL);

  initializeApp(aClient, app, getAuth(noAuth));
  app.getApp<RealtimeDatabase>(Database);

  Serial.println("[FB] Firebase client siap");
  Serial.println("Menunggu GPS fix...");
}

// ============================================================
// LOOP
// ============================================================

void loop() {
  // Baca GPS
  while (gpsSerial.available() > 0) {
    gps.encode(gpsSerial.read());
  }

  // Kirim ke Firebase setiap 1 detik
  if (millis() - lastSendTime >= SEND_INTERVAL) {
    lastSendTime = millis();
    sendToFirebase();
  }

  // Proses async Firebase
  app.loop();
}

// ============================================================
// WIFI
// ============================================================

void connectWiFi() {
  Serial.printf("[WiFi] Menghubungkan ke %s", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 40) {
    delay(500);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println();
    Serial.print("[WiFi] IP: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("\n[WiFi] GAGAL. Restart...");
    ESP.restart();
  }
}

// ============================================================
// KIRIM KE FIREBASE
// ============================================================

void sendToFirebase() {
  if (!gps.location.isValid()) {
    Serial.println("[GPS] Belum fix, skip");
    return;
  }

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[WiFi] Terputus, reconnect...");
    connectWiFi();
    return;
  }

  // Buat JSON
  object_t json;
  JsonWriter writer;

  writer.create(json);
  writer.set(json, "lat", gps.location.lat());
  writer.set(json, "lng", gps.location.lng());
  writer.set(json, "satellites", (int)gps.satellites.value());
  writer.set(json, "hdop", gps.hdop.hdop());
  writer.set(json, "speed", gps.speed.kmph());
  writer.set(json, "timestamp", (double)millis());
  writer.end();

  // Push ke Firebase
  String key = Database.push<object_t>(aClient, "/gps_track", json);

  if (aClient.lastError().code() == 0) {
    totalSent++;
    Serial.printf("[FB] Terkirim #%lu | Lat=%.6f Lng=%.6f | Key=%s\n",
                  totalSent, gps.location.lat(), gps.location.lng(), key.c_str());
  } else {
    Serial.printf("[FB] GAGAL: %s\n", aClient.lastError().message().c_str());
  }
}