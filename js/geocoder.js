// ============================================================
// GEOCODER — Reverse geocoding via Nominatim (OSM)
// Gratis, tanpa API key, cache per koordinat grid
// ============================================================

// Cache hasil geocoding (per grid ~50m)
const geocodeCache = {};

// Grid resolution (5 desimal ≈ 1.1 meter)
function gridKey(lat, lng) {
    return `${lat.toFixed(4)},${lng.toFixed(4)}`;
}

// Nama jalan default kalau geocoding gagal
function fallbackName(lat, lng) {
    return `Koordinat ${lat.toFixed(4)}, ${lng.toFixed(4)}`;
}

// Ambil nama jalan dari koordinat (async, pakai cache)
async function getStreetName(lat, lng) {
    const key = gridKey(lat, lng);

    // Cek cache dulu
    if (geocodeCache[key]) {
        return geocodeCache[key];
    }

    // Simpan placeholder untuk hindari duplikat request
    geocodeCache[key] = fallbackName(lat, lng);

    try {
        const url = `https://nominatim.openstreetmap.org/reverse?` +
                    `format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`;

        const res = await fetch(url, {
            headers: {
                'Accept': 'application/json',
                'User-Agent': 'FloodMap-Makassar/1.0'
            }
        });

        if (!res.ok) throw new Error('Nominatim error');

        const data = await res.json();
        const addr = data.address || {};

        // Prioritas nama jalan (dari paling spesifik)
        const streetName =
            addr.road ||
            addr.pedestrian ||
            addr.footway ||
            addr.path ||
            addr.neighbourhood ||
            addr.suburb ||
            addr.village ||
            addr.town ||
            addr.city_district ||
            addr.city ||
            null;

        if (streetName) {
            // Format nama jalan
            let fullName = streetName;
            if (addr.suburb && addr.suburb !== streetName) {
                fullName = `${streetName}, ${addr.suburb}`;
            }

            geocodeCache[key] = fullName;
            return fullName;
        }
    } catch (e) {
        console.warn('⚠️ Geocoding gagal:', e.message);
    }

    return geocodeCache[key];
}

// Pre-fetch nama jalan untuk array data (batch)
async function prefetchStreetNames(dataArray) {
    if (!dataArray || dataArray.length === 0) return;

    // Ambil titik yang belum ada di cache
    const uniquePoints = {};
    dataArray.forEach(p => {
        const key = gridKey(p.latitude, p.longitude);
        if (!geocodeCache[key]) {
            uniquePoints[key] = { lat: p.latitude, lng: p.longitude };
        }
    });

    const points = Object.values(uniquePoints);
    if (points.length === 0) return;

    console.log(`🌐 Geocoding ${points.length} titik baru...`);

    // Nominatim limit: 1 request/detik
    for (let i = 0; i < points.length; i++) {
        await getStreetName(points[i].lat, points[i].lng);
        // Jeda 1.1 detik antar request (rate limit Nominatim)
        if (i < points.length - 1) {
            await new Promise(r => setTimeout(r, 1100));
        }
    }

    console.log('✅ Geocoding selesai');
}

console.log('✅ geocoder.js loaded');   