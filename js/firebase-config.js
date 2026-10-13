// ============================================================
// FIREBASE CONFIGURATION
// ============================================================

const firebaseConfig = {
  apiKey: "AIzaSyDRKonUsNlIrFpqofnPDUfSY3sptuBbE6o",
  authDomain: "geo-flood-5cfc6.firebaseapp.com",
  databaseURL: "https://geo-flood-5cfc6-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "geo-flood-5cfc6",
  storageBucket: "geo-flood-5cfc6.firebasestorage.app",
  messagingSenderId: "139914213706",
  appId: "1:139914213706:web:22ef534f45fa86245a69b3"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();

// ============================================================
// DATABASE FUNCTIONS
// ============================================================

function onFloodPoints(callback) {
  db.ref('flood_points').on('value', (snap) => callback(snap.val() || {}));
}

function onRoadEvents(callback) {
  db.ref('road_events').on('value', (snap) => callback(snap.val() || {}));
}

function onSystemStatus(callback) {
  db.ref('system_status').on('value', (snap) => callback(snap.val() || {}));
}

function clearFloodPoints() {
  return db.ref('flood_points').remove();
}

function clearRoadEvents() {
  return db.ref('road_events').remove();
}

// ============================================================
// CONNECTION STATUS
// ============================================================

db.ref('.info/connected').on('value', (snap) => {
  const connected = snap.val();
  const el = document.getElementById('connStatus');
  if (el) {
      el.innerHTML = connected
          ? '<i class="ti ti-wifi" style="color:#22c55e;"></i> Firebase OK'
          : '<i class="ti ti-wifi-off" style="color:#ef4444;"></i> Terputus';
  }
  console.log('🔥 Firebase:', connected ? 'TERHUBUNG' : 'TERPUTUS');
});

console.log('✅ firebase-config.js loaded');