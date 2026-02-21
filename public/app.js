/* Snohomish County Gym Sites — MapLibre GL JS app */

// Mobile sidebar toggle
document.getElementById("sidebar-toggle").addEventListener("click", () => {
  const sidebar = document.getElementById("sidebar");
  const open = sidebar.classList.toggle("open");
  document.getElementById("sidebar-toggle").textContent = open ? "Close" : "Filters";
});

// Info tooltip toggle
document.getElementById("info-btn").addEventListener("click", (e) => {
  e.stopPropagation();
  document.getElementById("gym-criteria").classList.toggle("visible");
});
document.addEventListener("click", () => {
  document.getElementById("gym-criteria").classList.remove("visible");
});

const ZONE_COLORS = {
  Residential:          "#f4c542",
  Commercial:           "#e74c3c",
  Industrial:           "#8e44ad",
  Trade:                "#e67e22",
  Services:             "#2ecc71",
  "Cultural/Recreation":"#1abc9c",
  Undeveloped:          "#bdc3c7",
};

const ZONE_CATS = Object.keys(ZONE_COLORS);

// Basemap styles
const STREET_STYLE = "https://tiles.openfreemap.org/styles/liberty";
const SATELLITE_STYLE = {
  version: 8,
  glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
  sources: {
    satellite: {
      type: "raster",
      tiles: [
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      ],
      tileSize: 256,
      attribution: "Esri, Maxar, Earthstar Geographics",
    },
  },
  layers: [{ id: "satellite-tiles", type: "raster", source: "satellite" }],
};
let isSatellite = false;

/* ── Initialize sidebar controls ── */

// Zoning checkboxes
const zoneDiv = document.getElementById("zone-filters");
ZONE_CATS.forEach((cat) => {
  const label = document.createElement("label");
  label.className = "zone-checkbox";
  label.innerHTML =
    `<input type="checkbox" value="${cat}" checked>` +
    `<span class="zone-swatch" style="background:${ZONE_COLORS[cat]}"></span>` +
    `${cat}`;
  zoneDiv.appendChild(label);
});

// Acreage dual slider
const acresMinSlider = document.getElementById("acres-min");
const acresMaxSlider = document.getElementById("acres-max");
const acresMinVal = document.getElementById("acres-min-val");
const acresMaxVal = document.getElementById("acres-max-val");

acresMinSlider.addEventListener("input", () => {
  if (parseFloat(acresMinSlider.value) > parseFloat(acresMaxSlider.value)) {
    acresMinSlider.value = acresMaxSlider.value;
  }
  acresMinVal.textContent = acresMinSlider.value;
  applyFilters();
});
acresMaxSlider.addEventListener("input", () => {
  if (parseFloat(acresMaxSlider.value) < parseFloat(acresMinSlider.value)) {
    acresMaxSlider.value = acresMinSlider.value;
  }
  acresMaxVal.textContent = acresMaxSlider.value >= 100 ? "100+" : acresMaxSlider.value;
  applyFilters();
});

// Market value dual slider
const valueMinSlider = document.getElementById("value-min");
const valueMaxSlider = document.getElementById("value-max");
const valueMinVal = document.getElementById("value-min-val");
const valueMaxVal = document.getElementById("value-max-val");

function fmtDollar(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1000) return (n / 1000).toFixed(0) + "K";
  return String(n);
}

valueMinSlider.addEventListener("input", () => {
  if (Number(valueMinSlider.value) > Number(valueMaxSlider.value)) {
    valueMinSlider.value = valueMaxSlider.value;
  }
  valueMinVal.textContent = fmtDollar(Number(valueMinSlider.value));
  applyFilters();
});
valueMaxSlider.addEventListener("input", () => {
  if (Number(valueMaxSlider.value) < Number(valueMinSlider.value)) {
    valueMaxSlider.value = valueMinSlider.value;
  }
  const v = Number(valueMaxSlider.value);
  valueMaxVal.textContent = v >= 2000000 ? "2M+" : fmtDollar(v);
  applyFilters();
});

// Zone checkbox change
zoneDiv.addEventListener("change", () => applyFilters());

// City dropdown
const citySelect = document.getElementById("city-filter");
citySelect.addEventListener("change", () => applyFilters());

// Reset button
document.getElementById("reset-btn").addEventListener("click", () => {
  zoneDiv.querySelectorAll("input").forEach((cb) => (cb.checked = true));
  acresMinSlider.value = 2;
  acresMaxSlider.value = 100;
  acresMinVal.textContent = "2";
  acresMaxVal.textContent = "100+";
  valueMinSlider.value = 0;
  valueMaxSlider.value = 2000000;
  valueMinVal.textContent = "0";
  valueMaxVal.textContent = "2M+";
  citySelect.value = "";
  // Reset buffer checkboxes
  document.getElementById("show-buffer-3mi").checked = false;
  document.getElementById("show-buffer-5mi").checked = false;
  if (map.getLayer("gym-buffer-3mi-fill")) {
    map.setLayoutProperty("gym-buffer-3mi-fill", "visibility", "none");
    map.setLayoutProperty("gym-buffer-3mi-outline", "visibility", "none");
  }
  if (map.getLayer("gym-buffer-5mi-fill")) {
    map.setLayoutProperty("gym-buffer-5mi-fill", "visibility", "none");
    map.setLayoutProperty("gym-buffer-5mi-outline", "visibility", "none");
  }
  // Reset income layer
  document.getElementById("show-income").checked = false;
  if (map.getLayer("income-fill")) {
    map.setLayoutProperty("income-fill", "visibility", "none");
    map.setLayoutProperty("income-outline", "visibility", "none");
  }
  document.getElementById("income-legend").style.display = "none";
  applyFilters();
});

/* ── Address search (local parcel data) ── */

let parcelsData = null; // set after GeoJSON loads
let gymsData = null;    // set after gyms.geojson loads
let gymBuffers3mi = null; // computed once after gyms load
let gymBuffers5mi = null;
let incomeData = null;
const searchForm = document.getElementById("search-form");
const searchInput = document.getElementById("search-input");
const searchStatus = document.getElementById("search-status");

searchForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const query = searchInput.value.trim().toUpperCase();
  if (!query) return;

  searchStatus.textContent = "Searching...";
  searchStatus.className = "";

  // First check gym names
  const gymFeatures = gymsData ? gymsData.features : [];
  if (gymFeatures.length) {
    const gymMatches = gymFeatures.filter((f) => {
      const name = f.properties.name;
      return name && name.toUpperCase().includes(query);
    });
    if (gymMatches.length) {
      const g = gymMatches[0];
      const lngLat = g.geometry.coordinates;
      map.flyTo({ center: lngLat, zoom: 16, duration: 1500 });
      // Open popup at gym location after fly completes
      map.once("moveend", () => {
        const p = g.properties;
        new maplibregl.Popup({ maxWidth: "280px" })
          .setLngLat(lngLat)
          .setHTML(`<h4>${p.name}</h4><p>${p.category}</p>`)
          .addTo(map);
      });
      searchStatus.textContent = gymMatches.length === 1
        ? `Gym: ${g.properties.name}`
        : `${gymMatches.length} gyms match (showing first)`;
      searchStatus.className = "";
      return;
    }
  }

  // Then search parcel addresses
  if (!parcelsData) return;
  const matches = parcelsData.features.filter((f) => {
    const addr = f.properties.SITUSLINE1;
    return addr && addr.toUpperCase().includes(query);
  });

  if (!matches.length) {
    searchStatus.textContent = "No parcels or gyms found";
    searchStatus.className = "error";
    return;
  }

  // Compute bounding box of all matches
  const bounds = new maplibregl.LngLatBounds();
  matches.forEach((f) => {
    const geom = f.geometry;
    if (!geom) return;
    const addCoord = (c) => bounds.extend(c);
    const walk = (coords) => {
      if (typeof coords[0] === "number") { addCoord(coords); return; }
      coords.forEach(walk);
    };
    walk(geom.coordinates);
  });

  // Highlight matched parcels via feature state
  parcelsData.features.forEach((f) => {
    map.setFeatureState({ source: "parcels", id: f.id }, { searched: false });
  });
  matches.forEach((f) => {
    map.setFeatureState({ source: "parcels", id: f.id }, { searched: true });
  });

  // Fly to bounds
  map.fitBounds(bounds, { padding: 80, maxZoom: 17, duration: 1500 });

  const label = matches.length === 1
    ? `Found: ${matches[0].properties.SITUSLINE1}`
    : `${matches.length} parcels match`;
  searchStatus.textContent = label;
  searchStatus.className = "";
});

/* ── Map setup ── */

const map = new maplibregl.Map({
  container: "map",
  style: STREET_STYLE,
  center: [-122.2, 48.0],
  zoom: 10,
  maxZoom: 18,
});

map.addControl(new maplibregl.NavigationControl(), "top-right");

let hoveredId = null;

/* ── Add data sources & layers (called on initial load and after style switch) ── */

function addDataLayers() {
  // Income choropleth layers (rendered underneath everything else)
  if (incomeData) {
    map.addSource("income-tracts", { type: "geojson", data: incomeData });
    map.addLayer({
      id: "income-fill",
      type: "fill",
      source: "income-tracts",
      paint: {
        "fill-color": [
          "match", ["get", "income_bracket"],
          "high", "#2d8a4e",
          "medium", "#d4a017",
          "low", "#c0392b",
          "nodata", "#999",
          "#999"
        ],
        "fill-opacity": isSatellite ? 0.35 : 0.25,
      },
      layout: { visibility: "none" },
    });
    map.addLayer({
      id: "income-outline",
      type: "line",
      source: "income-tracts",
      paint: {
        "line-color": isSatellite ? "rgba(255,255,255,0.3)" : "rgba(0,0,0,0.15)",
        "line-width": 1,
      },
      layout: { visibility: "none" },
    });

    // Restore visibility from checkbox state (for style switch support)
    const incVis = document.getElementById("show-income").checked ? "visible" : "none";
    map.setLayoutProperty("income-fill", "visibility", incVis);
    map.setLayoutProperty("income-outline", "visibility", incVis);
  }

  // Buffer ring layers (rendered underneath parcels)
  if (gymBuffers5mi) {
    map.addSource("gym-buffer-5mi", { type: "geojson", data: gymBuffers5mi });
    map.addLayer({
      id: "gym-buffer-5mi-fill",
      type: "fill",
      source: "gym-buffer-5mi",
      paint: { "fill-color": "#ff9800", "fill-opacity": 0.08 },
      layout: { visibility: "none" },
    });
    map.addLayer({
      id: "gym-buffer-5mi-outline",
      type: "line",
      source: "gym-buffer-5mi",
      paint: { "line-color": "#ff9800", "line-width": 0.5, "line-opacity": 0.3 },
      layout: { visibility: "none" },
    });
  }

  if (gymBuffers3mi) {
    map.addSource("gym-buffer-3mi", { type: "geojson", data: gymBuffers3mi });
    map.addLayer({
      id: "gym-buffer-3mi-fill",
      type: "fill",
      source: "gym-buffer-3mi",
      paint: { "fill-color": "#ff4136", "fill-opacity": 0.10 },
      layout: { visibility: "none" },
    });
    map.addLayer({
      id: "gym-buffer-3mi-outline",
      type: "line",
      source: "gym-buffer-3mi",
      paint: { "line-color": "#ff4136", "line-width": 0.5, "line-opacity": 0.3 },
      layout: { visibility: "none" },
    });
  }

  // Respect current buffer checkbox state after style switch
  const buf3Vis = document.getElementById("show-buffer-3mi").checked ? "visible" : "none";
  const buf5Vis = document.getElementById("show-buffer-5mi").checked ? "visible" : "none";
  if (map.getLayer("gym-buffer-3mi-fill")) {
    map.setLayoutProperty("gym-buffer-3mi-fill", "visibility", buf3Vis);
    map.setLayoutProperty("gym-buffer-3mi-outline", "visibility", buf3Vis);
  }
  if (map.getLayer("gym-buffer-5mi-fill")) {
    map.setLayoutProperty("gym-buffer-5mi-fill", "visibility", buf5Vis);
    map.setLayoutProperty("gym-buffer-5mi-outline", "visibility", buf5Vis);
  }

  // Parcel source + layers
  map.addSource("parcels", {
    type: "geojson",
    data: parcelsData,
    generateId: false,
  });

  const matchExpr = ["match", ["get", "ZONE_CAT"]];
  ZONE_CATS.forEach((cat) => matchExpr.push(cat, ZONE_COLORS[cat]));
  matchExpr.push("#95a5a6"); // fallback

  map.addLayer({
    id: "parcels-fill",
    type: "fill",
    source: "parcels",
    paint: {
      "fill-color": matchExpr,
      "fill-opacity": [
        "case",
        ["boolean", ["feature-state", "hover"], false],
        isSatellite ? 0.5 : 0.85,
        isSatellite ? 0.25 : 0.55,
      ],
    },
  });

  map.addLayer({
    id: "parcels-outline",
    type: "line",
    source: "parcels",
    minzoom: 12,
    paint: {
      "line-color": isSatellite ? "#fff" : "#333",
      "line-width": 0.5,
    },
  });

  map.addLayer({
    id: "parcels-search-highlight",
    type: "line",
    source: "parcels",
    paint: {
      "line-color": "#e74c3c",
      "line-width": [
        "case",
        ["boolean", ["feature-state", "searched"], false],
        3.5,
        0,
      ],
    },
  });

  // Gym source + layers
  if (gymsData) {
    map.addSource("gyms", { type: "geojson", data: gymsData });

    map.addLayer({
      id: "gyms-glow",
      type: "circle",
      source: "gyms",
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 10, 14, 20],
        "circle-color": "rgba(255, 65, 54, 0.35)",
      },
    });

    map.addLayer({
      id: "gyms-circle",
      type: "circle",
      source: "gyms",
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 6, 14, 12],
        "circle-color": "#ff4136",
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 3,
      },
    });

    map.addLayer({
      id: "gyms-label",
      type: "symbol",
      source: "gyms",
      minzoom: 11,
      layout: {
        "text-field": ["get", "name"],
        "text-size": 12,
        "text-font": ["Noto Sans Bold"],
        "text-offset": [0, 1.8],
        "text-anchor": "top",
        "text-allow-overlap": false,
      },
      paint: {
        "text-color": isSatellite ? "#fff" : "#b71c1c",
        "text-halo-color": isSatellite ? "#000" : "#fff",
        "text-halo-width": 2,
      },
    });

    // Force gym layers above all other layers
    map.moveLayer("gyms-glow");
    map.moveLayer("gyms-circle");
    map.moveLayer("gyms-label");

    // Respect current gym visibility toggle
    const gymVis = document.getElementById("show-gyms").checked ? "visible" : "none";
    map.setLayoutProperty("gyms-glow", "visibility", gymVis);
    map.setLayoutProperty("gyms-circle", "visibility", gymVis);
    map.setLayoutProperty("gyms-label", "visibility", gymVis);
  }
}

/* ── Basemap toggle ── */

document.getElementById("basemap-toggle").addEventListener("click", () => {
  isSatellite = !isSatellite;
  map.setStyle(isSatellite ? SATELLITE_STYLE : STREET_STYLE, { diff: false });
  document.getElementById("basemap-toggle").textContent =
    isSatellite ? "Street" : "Satellite";
});

// Re-add data layers after any style change
map.on("style.load", () => {
  if (parcelsData) {
    addDataLayers();
    applyFilters();
  }
});

/* ── Initial data load ── */

map.on("load", () => {
  const loadingOverlay = document.getElementById("loading-overlay");

  fetch("parcels-web.geojson")
    .then((r) => {
      if (!r.ok) throw new Error("Failed to load GeoJSON");
      return r.json();
    })
    .then((data) => {
      // Populate city dropdown (once)
      const cities = new Set();
      data.features.forEach((f) => {
        const city = f.properties.SITUSCITY;
        if (city) cities.add(city);
      });
      [...cities]
        .sort()
        .forEach((city) => {
          const opt = document.createElement("option");
          opt.value = city;
          opt.textContent = city;
          citySelect.appendChild(opt);
        });

      // Assign sequential IDs for feature-state hover
      data.features.forEach((f, i) => (f.id = i));

      parcelsData = data;

      // Load gyms
      return fetch("gyms.geojson?v=2").then((r) => r.json());
    })
    .then((gyms) => {
      gymsData = gyms;

      // Compute competition buffer rings (once)
      gymBuffers3mi = turf.buffer(gymsData, 3, { units: "miles" });
      gymBuffers5mi = turf.buffer(gymsData, 5, { units: "miles" });

      // Load income tract data
      return fetch("income-tracts.geojson")
        .then((r) => {
          if (!r.ok) throw new Error("Failed to load income data");
          return r.json();
        })
        .then((income) => {
          incomeData = income;
        })
        .catch((err) => {
          console.warn("Income data not available:", err.message);
        });
    })
    .then(() => {
      // Add layers (initial)
      addDataLayers();

      loadingOverlay.classList.add("hidden");
      setTimeout(() => applyFilters(), 100);
    })
    .catch((err) => {
      loadingOverlay.innerHTML = `<p style="color:red">Error: ${err.message}</p>`;
      console.error(err);
    });
});

// Toggle gyms visibility
document.getElementById("show-gyms").addEventListener("change", (e) => {
  const vis = e.target.checked ? "visible" : "none";
  if (map.getLayer("gyms-glow")) map.setLayoutProperty("gyms-glow", "visibility", vis);
  if (map.getLayer("gyms-circle")) map.setLayoutProperty("gyms-circle", "visibility", vis);
  if (map.getLayer("gyms-label")) map.setLayoutProperty("gyms-label", "visibility", vis);
});

// Toggle income layer visibility
document.getElementById("show-income").addEventListener("change", (e) => {
  const vis = e.target.checked ? "visible" : "none";
  if (map.getLayer("income-fill")) map.setLayoutProperty("income-fill", "visibility", vis);
  if (map.getLayer("income-outline")) map.setLayoutProperty("income-outline", "visibility", vis);
  document.getElementById("income-legend").style.display = e.target.checked ? "block" : "none";
});

// Toggle buffer ring visibility
document.getElementById("show-buffer-3mi").addEventListener("change", (e) => {
  const vis = e.target.checked ? "visible" : "none";
  if (map.getLayer("gym-buffer-3mi-fill")) map.setLayoutProperty("gym-buffer-3mi-fill", "visibility", vis);
  if (map.getLayer("gym-buffer-3mi-outline")) map.setLayoutProperty("gym-buffer-3mi-outline", "visibility", vis);
});
document.getElementById("show-buffer-5mi").addEventListener("change", (e) => {
  const vis = e.target.checked ? "visible" : "none";
  if (map.getLayer("gym-buffer-5mi-fill")) map.setLayoutProperty("gym-buffer-5mi-fill", "visibility", vis);
  if (map.getLayer("gym-buffer-5mi-outline")) map.setLayoutProperty("gym-buffer-5mi-outline", "visibility", vis);
});

// Click popup for income tracts (only when no parcel covers the click)
map.on("click", "income-fill", (e) => {
  // Skip if a parcel was clicked (parcels-fill handler will fire instead)
  const parcelFeatures = map.queryRenderedFeatures(e.point, { layers: ["parcels-fill"] });
  if (parcelFeatures.length) return;
  if (!e.features.length) return;
  const p = e.features[0].properties;
  const income = p.median_income
    ? "$" + Number(p.median_income).toLocaleString()
    : "No data";
  const bracketLabel = { high: "High ($75K+)", medium: "Medium ($50-75K)", low: "Low (<$50K)", nodata: "No data" };
  const html = `
    <h4>${p.tract_name || "Census Tract"}</h4>
    <table>
      <tr><td>Median Income</td><td>${income}</td></tr>
      <tr><td>Bracket</td><td>${bracketLabel[p.income_bracket] || "—"}</td></tr>
      <tr><td>GEOID</td><td>${p.GEOID}</td></tr>
    </table>`;
  new maplibregl.Popup({ maxWidth: "280px" })
    .setLngLat(e.lngLat)
    .setHTML(html)
    .addTo(map);
});

// Click popup for parcels
map.on("click", "parcels-fill", (e) => {
  if (!e.features.length) return;
  const p = e.features[0].properties;
  const html = `
    <h4>${p.SITUSLINE1 || "No address"}</h4>
    <table>
      <tr><td>Parcel ID</td><td>${p.PARCEL_ID}</td></tr>
      <tr><td>Zoning</td><td>${p.ZONE_CAT}</td></tr>
      <tr><td>Use Code</td><td>${p.USECODE || "—"}</td></tr>
      <tr><td>Acres</td><td>${p.GIS_ACRES != null ? Number(p.GIS_ACRES).toFixed(2) : "—"}</td></tr>
      <tr><td>Sq Ft</td><td>${p.GIS_SQ_FT != null ? Number(p.GIS_SQ_FT).toLocaleString() : "—"}</td></tr>
      <tr><td>City</td><td>${p.SITUSCITY || "—"}</td></tr>
      <tr><td>ZIP</td><td>${p.SITUSZIP || "—"}</td></tr>
      <tr><td>Market Value</td><td>${p.MKTTL != null ? "$" + Number(p.MKTTL).toLocaleString() : "—"}</td></tr>
    </table>`;
  new maplibregl.Popup({ maxWidth: "320px" })
    .setLngLat(e.lngLat)
    .setHTML(html)
    .addTo(map);
});

// Click popup for gyms
map.on("click", "gyms-circle", (e) => {
  if (!e.features.length) return;
  const p = e.features[0].properties;
  let html = `<h4>${p.name}</h4>`;
  if (p.addr) html += `<p>${p.addr}</p>`;
  if (p.phone) html += `<p>${p.phone}</p>`;
  if (p.website) html += `<p><a href="${p.website}" target="_blank">Website</a></p>`;
  new maplibregl.Popup({ maxWidth: "280px" })
    .setLngLat(e.lngLat)
    .setHTML(html)
    .addTo(map);
});

// Hover highlight for parcels
map.on("mousemove", "parcels-fill", (e) => {
  if (e.features.length) {
    map.getCanvas().style.cursor = "pointer";
    if (hoveredId !== null) {
      map.setFeatureState({ source: "parcels", id: hoveredId }, { hover: false });
    }
    hoveredId = e.features[0].id;
    map.setFeatureState({ source: "parcels", id: hoveredId }, { hover: true });
  }
});

map.on("mouseleave", "parcels-fill", () => {
  map.getCanvas().style.cursor = "";
  if (hoveredId !== null) {
    map.setFeatureState({ source: "parcels", id: hoveredId }, { hover: false });
    hoveredId = null;
  }
});

// Cursor for gyms
map.on("mouseenter", "gyms-circle", () => {
  map.getCanvas().style.cursor = "pointer";
});
map.on("mouseleave", "gyms-circle", () => {
  map.getCanvas().style.cursor = "";
});

/* ── Filtering ── */

function applyFilters() {
  if (!map.getSource("parcels")) return;

  const checkedZones = [
    ...zoneDiv.querySelectorAll("input:checked"),
  ].map((cb) => cb.value);

  const minAcres = parseFloat(acresMinSlider.value);
  const maxAcres = parseFloat(acresMaxSlider.value);
  const minValue = Number(valueMinSlider.value);
  const maxValue = Number(valueMaxSlider.value);
  const city = citySelect.value;

  const conditions = [];

  // Zoning filter
  if (checkedZones.length < ZONE_CATS.length) {
    conditions.push(["in", ["get", "ZONE_CAT"], ["literal", checkedZones]]);
  }

  // Acreage filter (coalesce null to 0)
  if (minAcres > 0) {
    conditions.push([">=", ["coalesce", ["get", "GIS_ACRES"], 0], minAcres]);
  }
  if (maxAcres < 100) {
    conditions.push(["<=", ["coalesce", ["get", "GIS_ACRES"], 0], maxAcres]);
  }

  // Market value filter (coalesce null to 0)
  if (minValue > 0) {
    conditions.push([">=", ["coalesce", ["get", "MKTTL"], 0], minValue]);
  }
  if (maxValue < 2000000) {
    conditions.push(["<=", ["coalesce", ["get", "MKTTL"], 0], maxValue]);
  }

  // City filter
  if (city) {
    conditions.push(["==", ["get", "SITUSCITY"], city]);
  }

  const filter = conditions.length > 0 ? ["all", ...conditions] : null;

  map.setFilter("parcels-fill", filter);
  map.setFilter("parcels-outline", filter);

  // Count matching parcels directly from data
  if (parcelsData) {
    let count = 0;
    for (const f of parcelsData.features) {
      const p = f.properties;
      if (checkedZones.length < ZONE_CATS.length && !checkedZones.includes(p.ZONE_CAT)) continue;
      const acres = Number(p.GIS_ACRES) || 0;
      if (minAcres > 0 && acres < minAcres) continue;
      if (maxAcres < 100 && acres > maxAcres) continue;
      const val = Number(p.MKTTL) || 0;
      if (minValue > 0 && val < minValue) continue;
      if (maxValue < 2000000 && val > maxValue) continue;
      if (city && p.SITUSCITY !== city) continue;
      count++;
    }
    updateCount(count);
  }
}

function updateCount(n) {
  document.getElementById("parcel-count").textContent =
    `${n.toLocaleString()} parcels shown`;
}
