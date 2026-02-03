// ===== Effective categories (NO HL) =====
const LISA_LEVELS = ["HH", "LL", "LH", "NotSignificant"];
const HMM_STATES  = ["Underestimated", "Aligned", "Hyped"];

// 2-year transition matrix (provided)
const TRANSITION = {
  "Underestimated": { "Underestimated": 0.263, "Aligned": 0.354, "Hyped": 0.384 },
  "Aligned":        { "Underestimated": 0.14,  "Aligned": 0.795, "Hyped": 0.066 },
  "Hyped":          { "Underestimated": 0.074, "Aligned": 0.711, "Hyped": 0.216 }
};

// ===== UI state =====
let map, geoLayer;
let geojson = null;

let colorMode = "hmm_state";
let selectedNilId = null;

let activeLisa = null;
let activeHmm  = null;
let searchTerm = "";

// indexes
const layerByNilId = new Map();
let allFeatures = [];

// map view restore when selecting/clearing NIL (mobile UX)
let mapViewBeforeSelect = null; // { center: L.LatLng, zoom: number }

// list collapse
let listCollapsed = false;

// ===== DOM =====
const colorSelect = document.getElementById("colorSelect");
const zoomFilteredBtn = document.getElementById("zoomFilteredBtn");
const resetBtn = document.getElementById("resetBtn");
const searchInput = document.getElementById("searchInput");
const searchSuggest = document.getElementById("searchSuggest");

const introCard = document.getElementById("introCard");
const dismissIntroBtn = document.getElementById("dismissIntroBtn");
const step1Btn = document.getElementById("step1Btn");
const step2Btn = document.getElementById("step2Btn");
const step3Btn = document.getElementById("step3Btn");

const howToBtn = document.getElementById("howToBtn");
const howToPanel = document.getElementById("howToPanel");

const matrixCard = document.getElementById("matrixCard");
const matrixWrap = document.getElementById("matrixWrap");
const filterInterpretation = document.getElementById("filterInterpretation");

const nilDetailsCard = document.getElementById("nilDetailsCard");
const clearSelectionBtn = document.getElementById("clearSelectionBtn");
const nilTitle = document.getElementById("nilTitle");
const nilMeta = document.getElementById("nilMeta");
const nilInterpretation = document.getElementById("nilInterpretation");
const regimeWrap = document.getElementById("regimeWrap");

const nilList = document.getElementById("nilList");
const listSummary = document.getElementById("listSummary");
const toggleListBtn = document.getElementById("toggleListBtn");

const legendHMM = document.getElementById("legendHMM");
const legendLISA = document.getElementById("legendLISA");

const activeStateLine = document.getElementById("activeStateLine");

// mobile sheet
const sidebar = document.getElementById("sidebar");
const sheetHandle = document.getElementById("sheetHandle");
const sheetChevron = document.getElementById("sheetChevron");
const openPanelFab = document.getElementById("openPanelFab");

// ===== Interpretations =====
const CELL_INTERP = {
  "HH|Underestimated": "High-value spatial context with a discounted regime. Investigate factors temporarily depressing the regime relative to local context.",
  "HH|Aligned":        "High-value spatial context with an aligned regime. Pricing is broadly consistent with strong local context (stable core pattern).",
  "HH|Hyped":          "High-value spatial context with a hyped regime. Elevated regime on top of a strong context; may reflect overheating or sentiment-driven premia.",

  "LL|Underestimated": "Low-value spatial context with a discounted regime. Concentrated low-price area with additional discounting; compounding negatives may be present.",
  "LL|Aligned":        "Low-value spatial context with an aligned regime. Pricing appears coherent with the local context.",
  "LL|Hyped":          "Low-value spatial context with a hyped regime. Potential re-rating dynamics or local change—validate carefully.",

  "LH|Underestimated": "Near high-value areas but currently discounted. Often interpreted as potential re-rating candidates if perception/fundamentals catch up with nearby context.",
  "LH|Aligned":        "Near high-value areas with an aligned regime. Pricing is broadly consistent with favorable nearby context.",
  "LH|Hyped":          "Near high-value areas with a hyped regime. Could reflect spillover enthusiasm from adjacent high-value clusters.",

  "NotSignificant|Underestimated": "No strong local autocorrelation but discounted regime. More idiosyncratic patterns; investigate micro-drivers and heterogeneity.",
  "NotSignificant|Aligned":        "No strong local autocorrelation and aligned regime. Pricing behaves more independently, without strong local clustering effects.",
  "NotSignificant|Hyped":          "No strong local autocorrelation but hyped regime. Regime elevation without spatial reinforcement—possible isolated drivers."
};

const DEFAULT_INTERP = "Tap a matrix cell to get an interpretation.";

// ===== URL state (deep links) =====
function readUrlState() {
  const q = new URLSearchParams(location.search);
  const c = q.get("color");
  const lisa = q.get("lisa");
  const hmm = q.get("hmm");
  const nil = q.get("nil");
  const s = q.get("s");

  if (c === "hmm_state" || c === "lisa_class") colorMode = c;
  if (LISA_LEVELS.includes(lisa)) activeLisa = lisa;
  if (HMM_STATES.includes(hmm)) activeHmm = hmm;
  if (nil) selectedNilId = nil;
  if (s) searchTerm = s.toLowerCase();
}
function writeUrlState() {
  const q = new URLSearchParams();
  q.set("color", colorMode);
  if (activeLisa) q.set("lisa", activeLisa);
  if (activeHmm) q.set("hmm", activeHmm);
  if (selectedNilId) q.set("nil", selectedNilId);
  if (searchTerm) q.set("s", searchTerm);

  history.replaceState(null, "", `${location.pathname}?${q.toString()}`);
}

// ===== Mobile sheet (3 states) =====
function isMobile() {
  return window.matchMedia && window.matchMedia("(max-width: 980px)").matches;
}
function getSheetState() {
  if (sidebar.classList.contains("sheet--hidden")) return "hidden";
  if (sidebar.classList.contains("sheet--expanded")) return "expanded";
  return "peek";
}
function setSheetState(state) {
  sidebar.classList.remove("sheet--hidden", "sheet--peek", "sheet--expanded");
  sidebar.classList.add(`sheet--${state}`);
  syncSheetChevron();
  syncFab();
}
function syncSheetChevron() {
  if (!isMobile()) return;
  const st = getSheetState();
  sheetChevron.textContent = (st === "expanded") ? "▼" : "▲";
}
function syncFab() {
  if (!isMobile()) {
    openPanelFab.classList.add("hidden");
    return;
  }
  const st = getSheetState();
  openPanelFab.classList.toggle("hidden", st !== "hidden");
}
function toggleSheet() {
  const st = getSheetState();
  if (st === "hidden") setSheetState("peek");
  else if (st === "peek") setSheetState("expanded");
  else setSheetState("peek");
}

// ===== Autocomplete helpers =====
function hideSuggestions() {
  if (!searchSuggest) return;
  searchSuggest.classList.add("hidden");
  searchSuggest.innerHTML = "";
}

// filters ONLY by active LISA/HMM (not by searchTerm)
function matchesNonSearchFilters(feature) {
  const p = feature.properties || {};
  const lisa = p.lisa_class;
  const hmm  = p.hmm_state;

  if (activeLisa && lisa !== activeLisa) return false;
  if (activeHmm  && hmm !== activeHmm) return false;
  return true;
}

function renderSuggestions() {
  if (!searchSuggest) return;

  const q = (searchTerm || "").trim();
  if (!q) {
    hideSuggestions();
    return;
  }

  const qLower = q.toLowerCase();

  // Candidate set: respects LISA/HMM filters, then matches query on id/name
  let candidates = allFeatures
    .filter(matchesNonSearchFilters)
    .map(f => {
      const p = f.properties || {};
      const id = String(p.nil_id ?? "");
      const name = String(p.nil_name ?? "");
      const hay = (id + " " + name).toLowerCase();
      const starts = name.toLowerCase().startsWith(qLower) || id.startsWith(qLower);
      const idx = hay.indexOf(qLower);
      return { f, id, name, starts, idx };
    })
    .filter(x => x.idx !== -1);

  // Sort: starts-with first, then earlier match, then alphabetical
  candidates.sort((a, b) => {
    if (a.starts !== b.starts) return a.starts ? -1 : 1;
    if (a.idx !== b.idx) return a.idx - b.idx;
    return a.name.localeCompare(b.name);
  });

  candidates = candidates.slice(0, 10);

  if (!candidates.length) {
    hideSuggestions();
    return;
  }

  searchSuggest.innerHTML = "";
  searchSuggest.classList.remove("hidden");

  for (const item of candidates) {
    const p = item.f.properties || {};
    const lisa = shortLisa(p.lisa_class ?? "-");
    const hmm  = shortHmm(p.hmm_state ?? "-");

    const row = document.createElement("div");
    row.className = "suggestItem";

    const title = document.createElement("div");
    title.className = "suggestTitle";
    title.textContent = `${item.name} (${item.id})`;

    const sub = document.createElement("div");
    sub.className = "suggestSub";
    sub.textContent = `LISA: ${lisa} • HMM: ${hmm}`;

    row.appendChild(title);
    row.appendChild(sub);

    // pointerdown prevents the input blur from killing the click on mobile
    row.addEventListener("pointerdown", (e) => {
      e.preventDefault();

      // Select NIL (opens sheet & scrolls to NIL card inside onSelectNil)
      onSelectNil(item.f, { zoom: true });

      // Clear search after selection (better UX: don't keep map dimmed/filtered)
      searchInput.value = "";
      searchTerm = "";

      hideSuggestions();

      // Update UI
      geoLayer.setStyle(featureStyle);
      renderList();
      updateActiveStateLine();
      updateZoomButtonState();
      writeUrlState();

      // Close keyboard
      searchInput.blur();
    });

    searchSuggest.appendChild(row);
  }
}

// ===== Init =====
window.addEventListener("DOMContentLoaded", init);

async function init() {
  readUrlState();

  // intro persistence
  const introDismissed = localStorage.getItem("nil_intro_dismissed") === "1";
  if (introDismissed) introCard.classList.add("hidden");

  // load data
  geojson = await fetchJSON("data/nil.geojson");
  allFeatures = geojson.features || [];

  // map
  map = L.map("map", { preferCanvas: true });
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OpenStreetMap" }).addTo(map);

  geoLayer = L.geoJSON(geojson, {
    style: featureStyle,
    onEachFeature: (feature, layer) => {
      const id = String(feature.properties?.nil_id ?? "");
      if (id) layerByNilId.set(id, layer);
      layer.on("click", () => onSelectNil(feature, { zoom: true }));
    }
  }).addTo(map);

  map.fitBounds(geoLayer.getBounds(), { padding: [10, 10] });
  setTimeout(() => map.invalidateSize(), 150);

  // keyboard/viewport resize fix
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", () => {
      setTimeout(() => map.invalidateSize(), 50);
    });
  }
  window.addEventListener("orientationchange", () => setTimeout(() => map.invalidateSize(), 200));

  // legends
  renderLegends();

  // apply initial UI state
  colorSelect.value = colorMode;
  searchInput.value = searchTerm;

  // render
  renderMatrix();
  renderList();
  renderSelectedNilById(selectedNilId);
  updateActiveStateLine();
  updateZoomButtonState();
  updateInterpretationBox();

  // sheet initial state
  if (isMobile()) {
    setSheetState("peek");
  } else {
    sidebar.classList.remove("sheet--hidden", "sheet--peek", "sheet--expanded");
  }
  syncFab();

  // events
  colorSelect.addEventListener("change", () => {
    colorMode = colorSelect.value;
    geoLayer.setStyle(featureStyle);
    writeUrlState();
  });

  // SEARCH: focus/blur/input + suggestions
  searchInput.addEventListener("focus", () => {
    if (isMobile()) setSheetState("expanded");
    renderSuggestions();
  });

  searchInput.addEventListener("blur", () => {
    // allow pointerdown on suggestion first
    setTimeout(() => hideSuggestions(), 120);

    setTimeout(() => map.invalidateSize(), 80);
    if (isMobile() && !selectedNilId) setSheetState("peek");
  });

  searchInput.addEventListener("input", () => {
    searchTerm = (searchInput.value || "").trim().toLowerCase();

    geoLayer.setStyle(featureStyle);
    renderList();
    updateActiveStateLine();
    updateZoomButtonState();
    writeUrlState();

    renderSuggestions();
  });

  zoomFilteredBtn.addEventListener("click", () => zoomToFiltered());
  resetBtn.addEventListener("click", () => resetAll());

  dismissIntroBtn.addEventListener("click", () => {
    localStorage.setItem("nil_intro_dismissed", "1");
    introCard.classList.add("hidden");
  });

  step1Btn.addEventListener("click", () => focusPulse(colorSelect));
  step2Btn.addEventListener("click", () => {
    focusPulse(matrixCard);
    matrixCard.scrollIntoView({ behavior: "smooth", block: "start" });
    if (isMobile()) setSheetState("expanded");
  });
  step3Btn.addEventListener("click", () => {
    if (isMobile()) setSheetState("expanded");
    focusPulse(searchInput);
    searchInput.focus();
  });

  howToBtn.addEventListener("click", () => {
    howToPanel.classList.toggle("hidden");
    howToBtn.textContent = howToPanel.classList.contains("hidden") ? "How to read" : "Hide";
  });

  toggleListBtn.addEventListener("click", () => {
    listCollapsed = !listCollapsed;
    nilList.classList.toggle("hidden", listCollapsed);
    listSummary.classList.toggle("hidden", listCollapsed);
    toggleListBtn.textContent = listCollapsed ? "Expand" : "Collapse";
  });

  clearSelectionBtn.addEventListener("click", () => clearSelection({ restoreMap: true, hideSheet: true }));

  sheetHandle.addEventListener("click", () => {
    if (isMobile()) toggleSheet();
  });

  openPanelFab.addEventListener("click", () => {
    if (isMobile()) setSheetState("peek");
  });

  writeUrlState();
}

// ===== Filtering =====
function matchesFilters(feature) {
  const p = feature.properties || {};
  const lisa = p.lisa_class;
  const hmm  = p.hmm_state;
  const id   = String(p.nil_id ?? "");
  const name = String(p.nil_name ?? "");

  if (activeLisa && lisa !== activeLisa) return false;
  if (activeHmm  && hmm !== activeHmm) return false;

  if (searchTerm) {
    const hay = (id + " " + name).toLowerCase();
    if (!hay.includes(searchTerm)) return false;
  }
  return true;
}

// ===== Styling =====
function featureStyle(feature) {
  const p = feature.properties || {};
  const id = String(p.nil_id ?? "");
  const isOn = matchesFilters(feature);

  let fill = "#cccccc";
  if (colorMode === "hmm_state") fill = colorForHMM(p.hmm_state);
  if (colorMode === "lisa_class") fill = colorForLISA(p.lisa_class);

  const isSelected = (selectedNilId && id === selectedNilId);

  return {
    color: isSelected ? "#000" : "#333",
    weight: isSelected ? 3 : 1,
    fillColor: fill,
    fillOpacity: isOn ? 0.78 : 0.10,
    opacity: isOn ? 1 : 0.25
  };
}

// ===== Matrix =====
function renderMatrix() {
  const counts = makeContingency(allFeatures);
  const grandTotal = allFeatures.length;

  let html = `<table class="matrix"><thead><tr><th>LISA \\ HMM</th>`;
  for (const h of HMM_STATES) html += `<th>${shortHmm(h)}</th>`;
  html += `</tr></thead><tbody>`;

  for (const l of LISA_LEVELS) {
    html += `<tr><th>${shortLisa(l)}</th>`;
    for (const h of HMM_STATES) {
      const c = counts[l][h];
      const isActive = (activeLisa === l && activeHmm === h);
      const pct = grandTotal ? Math.round((100 * c) / grandTotal) : 0;

      html += `<td class="${isActive ? "active" : ""}" data-lisa="${l}" data-hmm="${h}">
                <div><b>${c}</b></div>
                <div class="small">${pct}%</div>
              </td>`;
    }
    html += `</tr>`;
  }

  html += `</tbody></table>`;
  matrixWrap.innerHTML = html;

  matrixWrap.querySelectorAll("td[data-lisa][data-hmm]").forEach(td => {
    td.addEventListener("click", () => {
      const l = td.getAttribute("data-lisa");
      const h = td.getAttribute("data-hmm");

      if (activeLisa === l && activeHmm === h) {
        activeLisa = null; activeHmm = null;
      } else {
        activeLisa = l; activeHmm = h;
      }

      // if current NIL is filtered out, clear selection
      if (selectedNilId) {
        const selectedFeat = allFeatures.find(f => String(f.properties?.nil_id ?? "") === String(selectedNilId));
        if (selectedFeat && !matchesFilters(selectedFeat)) clearSelection({ restoreMap: false, hideSheet: false });
      }

      geoLayer.setStyle(featureStyle);
      renderMatrix();
      renderList();
      updateActiveStateLine();
      updateZoomButtonState();
      updateInterpretationBox();
      writeUrlState();

      if (isMobile()) setSheetState("expanded");
    });
  });
}

function makeContingency(features) {
  const counts = {};
  for (const l of LISA_LEVELS) {
    counts[l] = {};
    for (const h of HMM_STATES) counts[l][h] = 0;
  }

  for (const f of features) {
    const p = f.properties || {};
    const l = p.lisa_class;
    const h = p.hmm_state;
    if (counts[l] && counts[l][h] !== undefined) counts[l][h] += 1;
  }
  return counts;
}

function updateInterpretationBox() {
  if (!activeLisa || !activeHmm) {
    filterInterpretation.textContent = DEFAULT_INTERP;
    return;
  }
  const key = `${activeLisa}|${activeHmm}`;
  filterInterpretation.textContent = CELL_INTERP[key] || "No interpretation available for this cell.";
}

// ===== List =====
function renderList() {
  const filtered = allFeatures
    .filter(matchesFilters)
    .sort((a, b) => {
      const an = String(a.properties?.nil_name ?? "");
      const bn = String(b.properties?.nil_name ?? "");
      return an.localeCompare(bn);
    });

  listSummary.textContent = `Showing: ${filtered.length} / ${allFeatures.length}`;

  nilList.innerHTML = filtered.slice(0, 250).map(f => {
    const p = f.properties || {};
    const id = String(p.nil_id ?? "");
    const name = String(p.nil_name ?? "");
    const lisa = shortLisa(p.lisa_class ?? "-");
    const hmm  = shortHmm(p.hmm_state ?? "-");
    const active = (selectedNilId && id === selectedNilId) ? "active" : "";
    return `
      <div class="listItem ${active}" data-id="${id}">
        <div class="listTitle">${name} <span class="small">(${id})</span></div>
        <div class="listSub">LISA: ${lisa} • HMM: ${hmm}</div>
      </div>
    `;
  }).join("");

  nilList.querySelectorAll(".listItem[data-id]").forEach(el => {
    el.addEventListener("click", () => {
      const id = el.getAttribute("data-id");
      const feat = allFeatures.find(ff => String(ff.properties?.nil_id ?? "") === id);
      if (feat) onSelectNil(feat, { zoom: true });
    });
  });
}

// ===== NIL selection =====
function onSelectNil(feature, opts = { zoom: true }) {
  const p = feature.properties || {};
  const id = String(p.nil_id ?? "");
  if (!id) return;

  // save current map view only when selecting from "nothing selected"
  if (!selectedNilId && map) {
    mapViewBeforeSelect = { center: map.getCenter(), zoom: map.getZoom() };
  }

  selectedNilId = id;
  renderSelectedNil(feature);

  geoLayer.setStyle(featureStyle);
  renderList();
  updateZoomButtonState();
  writeUrlState();

  // mobile: open sheet AND bring NIL interpretation to the top
  if (isMobile()) {
    setSheetState("expanded");
    setTimeout(() => {
      nilDetailsCard.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
  }

  if (opts.zoom) {
    const layer = layerByNilId.get(id);
    if (layer && layer.getBounds) map.fitBounds(layer.getBounds(), { padding: [20, 20] });
  }
}

function renderSelectedNilById(id) {
  if (!id) {
    renderSelectedNil(null);
    return;
  }
  const feat = allFeatures.find(f => String(f.properties?.nil_id ?? "") === String(id));
  if (feat) renderSelectedNil(feat);
  else renderSelectedNil(null);
}

function clearSelection({ restoreMap, hideSheet }) {
  selectedNilId = null;
  renderSelectedNil(null);
  geoLayer.setStyle(featureStyle);
  renderList();
  updateZoomButtonState();
  writeUrlState();

  hideSuggestions();

  if (restoreMap && mapViewBeforeSelect) {
    map.setView(mapViewBeforeSelect.center, mapViewBeforeSelect.zoom, { animate: true });
    mapViewBeforeSelect = null;
  }

  if (isMobile()) {
    if (hideSheet) setSheetState("hidden");
    else setSheetState("peek");
    setTimeout(() => map.invalidateSize(), 80);
  }

  // Go back to top so user can easily access color mode / legends / reset
  window.scrollTo({ top: 0, behavior: "smooth" });

  // Extra-robust: ensure the map area is visible
  const mapCol = document.querySelector(".mapCol");
  if (mapCol) mapCol.scrollIntoView({ behavior: "smooth", block: "start" });

  // Make sure Leaflet re-renders after the sheet animation
  setTimeout(() => map.invalidateSize(), 180);
}

function renderSelectedNil(feature) {
  if (!feature) {
    nilDetailsCard.classList.add("hidden");
    nilTitle.textContent = "";
    nilMeta.innerHTML = "";
    nilInterpretation.textContent = "";
    regimeWrap.innerHTML = "";
    return;
  }

  nilDetailsCard.classList.remove("hidden");

  const p = feature.properties || {};
  const id = String(p.nil_id ?? "");
  const name = String(p.nil_name ?? "NIL");
  const lisa = shortLisa(p.lisa_class ?? "-");
  const hmm  = shortHmm(p.hmm_state ?? "-");

  nilTitle.textContent = `${name} (${id})`;
  nilMeta.innerHTML = `<b>LISA:</b> ${lisa}<br><b>HMM:</b> ${hmm}`;

  const key = `${p.lisa_class}|${p.hmm_state}`;
  nilInterpretation.textContent = CELL_INTERP[key] || "No interpretation available for this combination.";

  renderRegimeEvolution(p.hmm_state);
}

// ===== 2-year regime evolution =====
function renderRegimeEvolution(currentHmmState) {
  const state = currentHmmState;
  if (!state || !TRANSITION[state]) {
    regimeWrap.innerHTML = `<div class="small">Unavailable (missing HMM state).</div>`;
    return;
  }

  const probs = TRANSITION[state];
  const rows = HMM_STATES.map(s => {
    const p = probs[s] ?? 0;
    const pct = Math.round(p * 100);
    return `
      <div class="barRow">
        <div class="barLabel">${shortHmm(s)}</div>
        <div class="barTrack"><div class="barFill" style="width:${pct}%"></div></div>
        <div class="barPct">${pct}%</div>
      </div>
    `;
  }).join("");

  regimeWrap.innerHTML = rows;
}

// ===== Zoom to filtered NILs =====
function getFilteredFeatures() {
  return allFeatures.filter(matchesFilters);
}
function updateZoomButtonState() {
  const n = getFilteredFeatures().length;
  zoomFilteredBtn.disabled = (n === 0);
  zoomFilteredBtn.textContent = n > 0 ? `Zoom to filtered NILs (${n})` : "Zoom to filtered NILs";
}
function zoomToFiltered() {
  const feats = getFilteredFeatures();
  if (!feats.length) return;

  let bounds = null;
  for (const f of feats) {
    const id = String(f.properties?.nil_id ?? "");
    const layer = layerByNilId.get(id);
    if (!layer || !layer.getBounds) continue;
    const b = layer.getBounds();
    bounds = bounds ? bounds.extend(b) : b;
  }

  if (bounds) map.fitBounds(bounds, { padding: [20, 20] });

  if (isMobile()) {
    setSheetState("hidden");
    setTimeout(() => map.invalidateSize(), 80);
  }
}

// ===== Active state line =====
function updateActiveStateLine() {
  const parts = [];
  if (activeLisa) parts.push(`LISA=${shortLisa(activeLisa)}`);
  if (activeHmm) parts.push(`HMM=${shortHmm(activeHmm)}`);
  if (searchTerm) parts.push(`search="${searchTerm}"`);
  activeStateLine.textContent = parts.length ? `Active filters: ${parts.join(" · ")}` : "";
}

// ===== Reset =====
function resetAll() {
  activeLisa = null;
  activeHmm = null;
  searchTerm = "";
  searchInput.value = "";

  hideSuggestions();

  clearSelection({ restoreMap: false, hideSheet: false });

  geoLayer.setStyle(featureStyle);
  renderMatrix();
  renderList();
  updateActiveStateLine();
  updateZoomButtonState();
  updateInterpretationBox();

  if (isMobile()) setSheetState("peek");
  writeUrlState();
}

// ===== Legends =====
function renderLegends() {
  legendHMM.innerHTML = [
    ["Underestimated", colorForHMM("Underestimated"), "Underestimated"],
    ["Aligned",        colorForHMM("Aligned"),        "Aligned"],
    ["Hyped",          colorForHMM("Hyped"),          "Hyped"]
  ].map(([_, color, label]) => legendItem(label, color)).join("");

  legendLISA.innerHTML = [
    ["HH",             colorForLISA("HH"),             "High-High"],
    ["LL",             colorForLISA("LL"),             "Low-Low"],
    ["LH",             colorForLISA("LH"),             "Low-High"],
    ["NotSignificant", colorForLISA("NotSignificant"), "Not Significant"]
  ].map(([_, color, label]) => legendItem(label, color)).join("");
}
function legendItem(label, color) {
  return `<span class="legendItem"><span class="swatch" style="background:${color}"></span>${label}</span>`;
}

// ===== Guided pulse =====
function focusPulse(el) {
  if (!el) return;
  el.classList.add("pulse");
  setTimeout(() => el.classList.remove("pulse"), 2500);
}

// ===== Helpers =====
async function fetchJSON(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Fetch error ${path}: ${res.status}`);
  return await res.json();
}
function shortLisa(l) { return l === "NotSignificant" ? "NS" : l; }
function shortHmm(h)  { return h === "Underestimated" ? "Underestimated" : h; }

/*
  WHERE TO CHANGE MAP COLORS:
  - HMM colors: colorForHMM()
  - LISA colors: colorForLISA()
*/
function colorForHMM(s) {
  if (s === "Underestimated") return "#264653";
  if (s === "Aligned")        return "#2A9D8F";
  if (s === "Hyped")          return "#F4A261";
  return "#cccccc";
}
function colorForLISA(cls) {
  if (cls === "HH")             return "#E63946";
  if (cls === "LL")             return "#1D3557";
  if (cls === "LH")             return "#A8DADC";
  if (cls === "NotSignificant") return "#c3c3c3";
  return "#d9d9d9";
}
