// ============================================================
// Google Maps helper — loader, dark style, marker helpers
// ============================================================

const GMAPS_DARK_STYLE = [
  { elementType: "geometry", stylers: [{ color: "#1a1a1a" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#0a0a0a" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#888888" }] },
  { featureType: "administrative", elementType: "geometry", stylers: [{ visibility: "off" }] },
  { featureType: "administrative.locality", elementType: "labels.text.fill", stylers: [{ color: "#bdbdbd" }] },
  { featureType: "poi", elementType: "labels.text.fill", stylers: [{ color: "#777777" }] },
  { featureType: "poi.park", elementType: "geometry", stylers: [{ color: "#1f2a1f" }] },
  { featureType: "poi.park", elementType: "labels.text.fill", stylers: [{ color: "#5a7a5a" }] },
  { featureType: "road", elementType: "geometry.fill", stylers: [{ color: "#2c2c2c" }] },
  { featureType: "road", elementType: "labels.text.fill", stylers: [{ color: "#9a9a9a" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#3d3d3d" }] },
  { featureType: "road.highway", elementType: "labels.text.fill", stylers: [{ color: "#c8c8c8" }] },
  { featureType: "transit", elementType: "geometry", stylers: [{ color: "#2a2a2a" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#0e1a2a" }] },
  { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#3b5878" }] },
];

let _gmapsPromise = null;
let _authFailed = false;

// Google calls this function when the API key is invalid / restricted / API not enabled.
// We mark a flag so subsequent map creation calls render a helpful message.
window.gm_authFailure = function () {
  _authFailed = true;
  // Re-render placeholders in any already-mounted map container
  document.querySelectorAll(".gmap-container").forEach((el) => {
    renderMapError(el, "auth-failure");
  });
};

/**
 * Loads Google Maps JS API (idempotent). Resolves to google.maps.
 * Rejects with Error('missing-key') if no key configured.
 */
function loadGoogleMaps() {
  if (_gmapsPromise) return _gmapsPromise;
  const key = window.SAYDALIYATI_CONFIG?.GOOGLE_MAPS_API_KEY;
  if (!key || key === "YOUR_KEY_HERE") {
    return Promise.reject(new Error("missing-key"));
  }
  _gmapsPromise = new Promise((resolve, reject) => {
    if (window.google?.maps?.Map) return resolve(window.google.maps);
    const script = document.createElement("script");
    // No loading=async here — we want google.maps.Map ready synchronously after onload.
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly`;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      // Even if the script "loaded", auth may have failed.
      // Give Google a tick to call gm_authFailure if it's going to.
      setTimeout(() => {
        if (_authFailed) reject(new Error("auth-failure"));
        else if (window.google?.maps?.Map) resolve(window.google.maps);
        else reject(new Error("script-loaded-but-no-maps"));
      }, 50);
    };
    script.onerror = () => reject(new Error("Failed to load Google Maps"));
    document.head.appendChild(script);
  });
  return _gmapsPromise;
}

/**
 * Render a styled error/help message inside a map container.
 */
function renderMapError(container, kind, lang) {
  const isAr = (lang || document.documentElement.lang || "en") === "ar";
  let title, hint;
  if (kind === "missing-key") {
    title = isAr ? "ما تم إعداد خرائط Google" : "Google Maps not configured";
    hint = isAr
      ? "أضف مفتاح API في ملف <code>.env</code> ثم أعد تشغيل السيرفر."
      : "Add your API key to <code>.env</code> and restart the server.";
  } else if (kind === "auth-failure") {
    title = isAr ? "خطأ في مفتاح Google Maps" : "Google Maps key rejected";
    hint = isAr
      ? "تأكد من تفعيل <b>Maps JavaScript API</b> في Google Cloud، وإن المفتاح ما عليه قيود تمنع <code>localhost</code>."
      : "Make sure <b>Maps JavaScript API</b> is enabled in Google Cloud, and the key isn't restricted to a domain that excludes <code>localhost</code>.";
  } else {
    title = isAr ? "ما قدرنا نحمّل الخريطة" : "Couldn't load the map";
    hint = isAr ? "جرّب تحديث الصفحة." : "Try refreshing the page.";
  }
  container.innerHTML = `
    <div class="gmap-warning">
      <div style="font-size:2rem;margin-bottom:0.5rem">🗺️</div>
      <div style="color:var(--fg);font-weight:600;margin-bottom:0.5rem">${title}</div>
      <div>${hint}</div>
    </div>
  `;
}

// Backwards-compat alias used by older pages
function renderMapPlaceholder(container, lang) {
  renderMapError(container, "missing-key", lang);
}

/**
 * Create a draggable map. Returns { ok, map, marker, setLocation }.
 * On any failure renders a helpful message and returns { ok: false }.
 */
async function createDraggableMap({ container, lat, lng, zoom = 13, lang = "en" }) {
  try {
    await loadGoogleMaps();
  } catch (err) {
    renderMapError(container, err.message, lang);
    return { ok: false };
  }
  const center = { lat, lng };
  const map = new google.maps.Map(container, {
    center,
    zoom,
    styles: GMAPS_DARK_STYLE,
    disableDefaultUI: true,
    zoomControl: true,
    gestureHandling: "greedy",
    backgroundColor: "#1a1a1a",
  });
  const marker = new google.maps.Marker({
    position: center,
    map,
    draggable: true,
    icon: {
      path: google.maps.SymbolPath.CIRCLE,
      scale: 14,
      fillColor: "#00E5A8",
      fillOpacity: 1,
      strokeColor: "#0A0A0A",
      strokeWeight: 4,
    },
  });
  return {
    ok: true,
    map,
    marker,
    setLocation(newLat, newLng) {
      const p = { lat: newLat, lng: newLng };
      map.setCenter(p);
      map.setZoom(16);
      marker.setPosition(p);
    },
  };
}

/**
 * Multi-marker map (read-only). Returns { ok, map, markers }.
 */
async function createListMap({ container, center, locations, onMarkerClick, lang = "en" }) {
  try {
    await loadGoogleMaps();
  } catch (err) {
    renderMapError(container, err.message, lang);
    return { ok: false };
  }
  const map = new google.maps.Map(container, {
    center,
    zoom: 12,
    styles: GMAPS_DARK_STYLE,
    disableDefaultUI: true,
    zoomControl: true,
    gestureHandling: "greedy",
    backgroundColor: "#1a1a1a",
  });
  const markers = locations.map((loc) => {
    const m = new google.maps.Marker({
      position: { lat: loc.lat, lng: loc.lng },
      map,
      title: loc.title || "",
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 10,
        fillColor: "#00E5A8",
        fillOpacity: 1,
        strokeColor: "#0A0A0A",
        strokeWeight: 3,
      },
    });
    if (onMarkerClick) m.addListener("click", () => onMarkerClick(loc, m));
    return m;
  });
  return { ok: true, map, markers };
}
