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
const clearSearchBtn = document.getElementById("clearSearchBtn");

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
const sheetInner = document.querySelector(".sheetInner");
const searchCard = document.getElementById("searchCard");

// ===== Interpretations =====
const CELL_INTERP = {
  "HH|Underestimated": "High-value spatial context with a discounted market state. Investigate factors temporarily depressing the state relative to local context.",
  "HH|Aligned":        "High-value spatial context with an aligned market state. Pricing is broadly consistent with strong local context (stable core pattern).",
  "HH|Hyped":          "High-value spatial context with a hyped market state. Elevated state on top of a strong context; may reflect overheating or sentiment-driven premia.",

  "LL|Underestimated": "Low-value spatial context with a discounted market state. Concentrated low-price area with additional discounting; compounding negatives may be present.",
  "LL|Aligned":        "Low-value spatial context with an aligned market state. Pricing appears coherent with the local context.",
  "LL|Hyped":          "Low-value spatial context with a hyped market state. Potential re-rating dynamics or local change—validate carefully.",

  "LH|Underestimated": "Near high-value areas but currently discounted. Often interpreted as potential re-rating candidates if perception/fundamentals catch up with nearby context.",
  "LH|Aligned":        "Near high-value areas with an aligned market state. Pricing is broadly consistent with favorable nearby context.",
  "LH|Hyped":          "Near high-value areas with a hyped market state. Could reflect spillover enthusiasm from adjacent high-value clusters.",

  "NotSignificant|Underestimated": "No strong local autocorrelation but discounted market state. More idiosyncratic patterns; investigate micro-drivers and heterogeneity.",
  "NotSignificant|Aligned":        "No strong local autocorrelation and aligned market state. Pricing behaves more independently, without strong local clustering effects.",
  "NotSignificant|Hyped":          "No strong local autocorrelation but hyped market state. State elevation without spatial reinforcement—possible isolated drivers."
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

// ===== Mobile helpers =====
function isMobile() {
  return window.matchMedia && window.matchMedia("(max-width: 980px)").matches;
}

function viewportHeightPx() {
  return window.visualViewport ? Math.round(window.visualViewport.height) : window.innerHeight;
}

function keyboardOffsetPx() {
  if (!window.visualViewport) return 0;
  const vv = window.visualViewport;
  const kb = window.innerHeight - vv.height - (vv.offsetTop || 0);
  return Math.max(0, Math.round(kb));
}

function applyKeyboardOffset() {
  if (!isMobile()) return;
  sidebar.style.bottom = `${keyboardOffsetPx()}px`;
}

// ===== Panel mode + height control =====
function setPanelMode(mode) {
  if (!isMobile()) return;
  sidebar.dataset.mode = mode; // intro | search | full | handle
  syncChevron();
}

function syncChevron() {
  if (!isMobile()) return;
  const mode = sidebar.dataset.mode || "full";
  // down when tall/full, up otherwise
  sheetChevron.classList.toggle("isDown", mode === "full");
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function handleHeightPx() {
  return sheetHandle ? sheetHandle.getBoundingClientRect().height : 38;
}

function calcSearchHeightPx() {
  const base = handleHeightPx();
  if (!searchCard) return base + 180;
  const rect = searchCard.getBoundingClientRect();
  // inner padding + some breathing room for suggestions
  return base + rect.height + 16;
}

function calcIntroHeightPx() {
  const base = handleHeightPx();
  if (!introCard) return base + 220;
  const rect = introCard.getBoundingClientRect();
  return base + rect.height + 16;
}

function maxPanelHeightPx() {
  return Math.round(viewportHeightPx() * 0.92);
}

function minPanelHeightPx() {
  // handle-only visible: keep exactly the handle area
  return Math.round(handleHeightPx());
}

function setPanelHeight(px) {
  if (!isMobile()) return;
  const h = clamp(px, minPanelHeightPx(), maxPanelHeightPx());
  sidebar.style.height = `${h}px`;
  setTimeout(() => map?.invalidateSize?.(), 60);
}

function setPanelToSearchOnly() {
  if (!isMobile()) return;
  setPanelMode("search");
  setPanelHeight(calcSearchHeightPx());
}

function setPanelToIntroOnly() {
  if (!isMobile()) return;
  setPanelMode("intro");
  setPanelHeight(calcIntroHeightPx());
}

function setPanelToFull() {
  if (!isMobile()) return;
  setPanelMode("full");
  setPanelHeight(maxPanelHeightPx());
}

function setPanelToHandleOnly() {
  if (!isMobile()) return;
  setPanelMode("handle");
  setPanelHeight(minPanelHeightPx());
}

// ===== Drag handle (free drag, no forced snap) =====
function enableSheetDrag() {
  if (!isMobile() || !sheetHandle) return;

  let dragging = false;
  let startY = 0;
  let startHeight = 0;

  function currentHeight() {
    const h = parseFloat(getComputedStyle(sidebar).height || "0");
    return isFinite(h) ? h : 0;
  }

  function decideModeFromHeight(h) {
    const minH = minPanelHeightPx();
    const searchH = calcSearchHeightPx();
    // small deadzone so it doesn't flicker
    if (h <= minH + 6) return "handle";
    if (h <= searchH + 10) return "search";
    return "full";
  }

  function onDown(e) {
    if (!isMobile()) return;
    dragging = true;
    startY = e.clientY;
    startHeight = currentHeight();
    sheetHandle.style.cursor = "grabbing";
    sheetHandle.setPointerCapture(e.pointerId);
  }

  function onMove(e) {
    if (!dragging) return;
    const dy = startY - e.clientY; // up = positive
    const rawH = startHeight + dy;
    const h = clamp(rawH, minPanelHeightPx(), maxPanelHeightPx());

    sidebar.style.transition = "none";
    sidebar.style.height = `${h}px`;

    const mode = decideModeFromHeight(h);
    setPanelMode(mode);
  }

  function onUp(e) {
    if (!dragging) return;
    dragging = false;
    sheetHandle.releasePointerCapture(e.pointerId);
    sheetHandle.style.cursor = "";
    sidebar.style.transition = "";

    // keep the chosen height as-is (free drag),
    // but ensure mode is consistent with final height
    const h = currentHeight();
    setPanelMode(decideModeFromHeight(h));

    setTimeout(() => map.invalidateSize(), 80);
  }

  sheetHandle.addEventListener("pointerdown", onDown);
  sheetHandle.addEventListener("pointermove", onMove);
  sheetHandle.addEventListener("pointerup", onUp);
  sheetHandle.addEventListener("pointercancel", onUp);

  window.addEventListener("resize", () => {
    if (!isMobile()) return;
    // keep current mode but clamp height
    const h = currentHeight();
    setPanelHeight(h);
    syncChevron();
  });
}

// ===== Tap behavior (handle tap toggles search/full/handle in a UX-friendly loop) =====
function enableHandleTapToggle() {
  if (!isMobile() || !sheetHandle) return;

  sheetHandle.addEventListener("click", () => {
    const mode = sidebar.dataset.mode || "full";
    if (mode === "full") {
      // tap -> focus mode: only search
      setPanelToSearchOnly();
    } else if (mode === "search") {
      // tap -> expand
      setPanelToFull();
    } else if (mode === "intro") {
      // tap while intro visible -> keep intro (don't expand to full)
      setPanelToIntroOnly();
    } else {
      // handle-only -> bring back search
      setPanelToSearchOnly();
    }
  });
}

// ===== Autocomplete helpers =====
function hideSuggestions() {
  if (!searchSuggest) return;
  searchSuggest.classList.add("hidden");
  searchSuggest.innerHTML = "";
}

function syncClearSearchBtn() {
  if (!clearSearchBtn) return;
  const hasText = (searchInput.value || "").trim().length > 0;
  clearSearchBtn.classList.toggle("hidden", !hasText);
}

function clearSearch() {
  searchInput.value = "";
  searchTerm = "";

  hideSuggestions();
  syncClearSearchBtn();

  // update filtering + UI
  geoLayer.setStyle(featureStyle);
  renderList();
  updateActiveStateLine();
  updateZoomButtonState();
  writeUrlState();
}

// filters ONLY by active LISA/HMM (not by searchTerm)
function matchesNonSearchFilters(feature) {
  const p = feature.properties || {};
  if (activeLisa && p.lisa_class !== activeLisa) return false;
  if (activeHmm  && p.hmm_state !== activeHmm) return false;
  return true;
}

function renderSuggestions() {
  if (!searchSuggest) return;

  const q = (searchTerm || "").trim();
  if (!q) { hideSuggestions(); return; }

  const qLower = q.toLowerCase();

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

  candidates.sort((a, b) => {
    if (a.starts !== b.starts) return a.starts ? -1 : 1;
    if (a.idx !== b.idx) return a.idx - b.idx;
    return a.name.localeCompare(b.name);
  });

  candidates = candidates.slice(0, 10);

  if (!candidates.length) { hideSuggestions(); return; }

  searchSuggest.innerHTML = "";
  searchSuggest.classList.remove("hidden");
  updateSuggestMaxHeight();

  for (const item of candidates) {
    const p = item.f.properties || {};
    const lisa = lisaFullName(p.lisa_class ?? "-");
    const hmm  = hmmFullName(p.hmm_state ?? "-");

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

    row.addEventListener("pointerdown", (e) => {
      e.preventDefault();

      onSelectNil(item.f, { zoom: true });

      // Clear search after selection
      searchInput.value = "";
      searchTerm = "";
      hideSuggestions();

      geoLayer.setStyle(featureStyle);
      renderList();
      updateActiveStateLine();
      updateZoomButtonState();
      writeUrlState();

      searchInput.blur();
    });

    searchSuggest.appendChild(row);
  }
}

function updateSuggestMaxHeight() {
  if (!isMobile() || !searchSuggest || searchSuggest.classList.contains("hidden")) return;

  const sidebarRect = sidebar.getBoundingClientRect();
  const inputRect = searchInput.getBoundingClientRect();

  // dove inizia il dropdown (top: calc(100% + 6px))
  const dropdownTop = inputRect.bottom + 6;
  const paddingBottom = 16;

  const available = Math.max(120, Math.floor(sidebarRect.bottom - dropdownTop - paddingBottom));
  searchSuggest.style.maxHeight = `${available}px`;
}

// ===== Init =====
window.addEventListener("DOMContentLoaded", init);

async function init() {
  readUrlState();

  // intro persistence
  const introDismissed = localStorage.getItem("nil_intro_dismissed") === "1";

  if (introDismissed) {
    introCard.classList.add("hidden"); // non farla riapparire mai
  }

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

  // mobile initial panel behavior:
  // show ONLY the intro (not full panel)
  if (isMobile()) {
    if (introDismissed) {
      // show search-only by default
      setPanelToSearchOnly();
      setPanelMode("search");
    } else {
      setPanelToIntroOnly();
      setPanelMode("intro");
    }
  } else {
    // desktop sidebar always full
    sidebar.dataset.mode = "full";
    sidebar.style.height = "";
  }
  syncChevron();

  // enable drag & tap
  enableSheetDrag();
  enableHandleTapToggle();

  // events
  colorSelect.addEventListener("change", () => {
    colorMode = colorSelect.value;
    geoLayer.setStyle(featureStyle);
    writeUrlState();
  });

  // SEARCH
  searchInput.addEventListener("focus", () => {
    if (isMobile()) {
      applyKeyboardOffset();
      // durante la ricerca: apri il più possibile (anche per vedere suggerimenti)
      setPanelMode("search");
      setPanelHeight(maxPanelHeightPx());

      // assicura che l’input sia davvero visibile sopra la tastiera
      setTimeout(() => {
        searchInput.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 50);
    }
    renderSuggestions();
    setTimeout(() => updateSuggestMaxHeight(), 0);
  });

  searchInput.addEventListener("blur", () => {
    setTimeout(() => hideSuggestions(), 120);
    if (isMobile()) {
      setTimeout(() => {
        applyKeyboardOffset(); // torna giù quando la tastiera sparisce
      }, 50);
    }
    setTimeout(() => map.invalidateSize(), 80);
  });

  searchInput.addEventListener("input", () => {
    searchTerm = (searchInput.value || "").trim().toLowerCase();
    geoLayer.setStyle(featureStyle);
    renderList();
    updateActiveStateLine();
    updateZoomButtonState();
    writeUrlState();
    renderSuggestions();
    updateSuggestMaxHeight();
  });
  
  // --- Clear (X) button: show/hide + action ---
  syncClearSearchBtn(); // initial

  searchInput.addEventListener("input", () => {
    syncClearSearchBtn();
  });

  clearSearchBtn.addEventListener("click", (e) => {
    e.preventDefault();
    clearSearch();
    searchInput.focus(); // keeps keyboard open on mobile
  });

  zoomFilteredBtn.addEventListener("click", () => zoomToFiltered());

  resetBtn.addEventListener("click", () => resetAll());

  dismissIntroBtn.addEventListener("click", () => {
    localStorage.setItem("nil_intro_dismissed", "1");
    introCard.classList.add("hidden");
    if (isMobile()) setPanelToSearchOnly();
  });

  step1Btn.addEventListener("click", () => focusPulse(colorSelect));
  step2Btn.addEventListener("click", () => {
    focusPulse(matrixCard);
    matrixCard.scrollIntoView({ behavior: "smooth", block: "start" });
    if (isMobile()) setPanelToFull();
  });
  step3Btn.addEventListener("click", () => {
    if (isMobile()) setPanelToSearchOnly();
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

  clearSelectionBtn.addEventListener("click", () => {
    // Do NOT hide panel. Return to search-only and restore full page context.
    clearSelection({ restoreMap: true });
    if (isMobile()) setPanelToSearchOnly();
  });

  // viewport resize fix for keyboard
  if (window.visualViewport) {
    const onVV = () => {
      applyKeyboardOffset();
      // se il pannello è aperto, clampalo alla nuova viewport
      const h = parseFloat(getComputedStyle(sidebar).height || "0");
      if (isFinite(h) && h > 0) setPanelHeight(h);
      setTimeout(() => map.invalidateSize(), 50);
      updateSuggestMaxHeight?.();
    };

    window.visualViewport.addEventListener("resize", onVV);
    window.visualViewport.addEventListener("scroll", onVV);
  }
  window.addEventListener("orientationchange", () => setTimeout(() => map.invalidateSize(), 200));

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
function hmmMatrixLabel(h) {
  return (h === "Underestimated") ? "Under" : h;
}
function lisaShort(l) { return l === "NotSignificant" ? "NS" : l; }

function renderMatrix() {
  const counts = makeContingency(allFeatures);
  const grandTotal = allFeatures.length;

  let html = `<table class="matrix"><thead><tr><th>LISA \\ HMM</th>`;
  for (const h of HMM_STATES) html += `<th>${hmmMatrixLabel(h)}</th>`;
  html += `</tr></thead><tbody>`;

  for (const l of LISA_LEVELS) {
    html += `<tr><th>${lisaShort(l)}</th>`;
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

      // if current NIL is filtered out, clear selection (but keep panel search-only)
      if (selectedNilId) {
        const selectedFeat = allFeatures.find(f => String(f.properties?.nil_id ?? "") === String(selectedNilId));
        if (selectedFeat && !matchesFilters(selectedFeat)) {
          clearSelection({ restoreMap: false });
          if (isMobile()) setPanelToSearchOnly();
        }
      }

      geoLayer.setStyle(featureStyle);
      renderMatrix();
      renderList();
      updateActiveStateLine();
      updateZoomButtonState();
      updateInterpretationBox();
      writeUrlState();

      // UX: matrix interaction should not fully cover the map
      if (isMobile()) setPanelToSearchOnly();
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
    const lisa = lisaShort(p.lisa_class ?? "-");
    const hmm  = hmmFullName(p.hmm_state ?? "-");
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

  if (!selectedNilId && map) {
    mapViewBeforeSelect = { center: map.getCenter(), zoom: map.getZoom() };
  }

  selectedNilId = id;
  renderSelectedNil(feature);

  geoLayer.setStyle(featureStyle);
  renderList();
  updateZoomButtonState();
  writeUrlState();

  // For selection we do want full info, but still allow user to drag down.
  if (isMobile()) {
    setPanelToFull();
    setTimeout(() => nilDetailsCard.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
  }

  if (opts.zoom) {
    const layer = layerByNilId.get(id);
    if (layer && layer.getBounds) map.fitBounds(layer.getBounds(), { padding: [20, 20] });
  }
}

function renderSelectedNilById(id) {
  if (!id) { renderSelectedNil(null); return; }
  const feat = allFeatures.find(f => String(f.properties?.nil_id ?? "") === String(id));
  if (feat) renderSelectedNil(feat);
  else renderSelectedNil(null);
}

function clearSelection({ restoreMap }) {
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

  // Return to full page context (header/legends)
  window.scrollTo({ top: 0, behavior: "smooth" });
  const mapCol = document.querySelector(".mapCol");
  if (mapCol) mapCol.scrollIntoView({ behavior: "smooth", block: "start" });
  setTimeout(() => map.invalidateSize(), 160);
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

  const lisaFull = lisaFullName(p.lisa_class ?? "-");
  const hmmFull  = hmmFullName(p.hmm_state ?? "-");

  nilTitle.textContent = `${name} (${id})`;
  nilMeta.innerHTML = `<b>LISA cluster:</b> ${lisaFull}<br><b>HMM state:</b> ${hmmFull}`;

  const key = `${p.lisa_class}|${p.hmm_state}`;
  nilInterpretation.textContent = CELL_INTERP[key] || "No interpretation available for this combination.";

  renderStateEvolution(p.hmm_state);
}

// ===== 2-year state evolution =====
function renderStateEvolution(currentHmmState) {
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
        <div class="barLabel">${s}</div>
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

  // UX: do NOT hide the panel; just reduce to search-only
  if (isMobile()) setPanelToSearchOnly();
}

// ===== Active state line =====
function updateActiveStateLine() {
  const parts = [];
  if (activeLisa) parts.push(`LISA=${lisaShort(activeLisa)}`);
  if (activeHmm) parts.push(`HMM=${hmmMatrixLabel(activeHmm)}`);
  if (searchTerm) parts.push(`search="${searchTerm}"`);
  activeStateLine.textContent = parts.length ? `Active filters: ${parts.join(" · ")}` : "";
}

// ===== Reset =====
function resetAll() {
  activeLisa = null;
  activeHmm = null;
  searchTerm = "";
  searchInput.value = "";
  syncClearSearchBtn();

  hideSuggestions();

  clearSelection({ restoreMap: false });

  geoLayer.setStyle(featureStyle);
  renderMatrix();
  renderList();
  updateActiveStateLine();
  updateZoomButtonState();
  updateInterpretationBox();

  if (isMobile()) setPanelToSearchOnly();
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
    ["NotSignificant", colorForLISA("NotSignificant"), "Not significant"]
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

function lisaFullName(l) {
  if (l === "HH") return "High-High";
  if (l === "LL") return "Low-Low";
  if (l === "LH") return "Low-High";
  if (l === "NotSignificant") return "Not significant";
  return String(l);
}
function hmmFullName(h) {
  if (HMM_STATES.includes(h)) return h;
  return String(h);
}

/*
  WHERE TO CHANGE MAP COLORS:
  - HMM colors: colorForHMM()
  - LISA colors: colorForLISA()
*/
function colorForHMM(s) {
  if (s === "Underestimated") return "#4c78a8";
  if (s === "Aligned")        return "#72b7b2";
  if (s === "Hyped")          return "#f58518";
  return "#cccccc";
}
function colorForLISA(cls) {
  if (cls === "HH")             return "#E63946";
  if (cls === "LL")             return "#1D3557";
  if (cls === "LH")             return "#A8DADC";
  if (cls === "NotSignificant") return "#c3c3c3";
  return "#d9d9d9";
}
