/**
 * Curve Controller Card for Home Assistant Lovelace
 * Custom Web Component for visualizing and interactively editing piecewise linear curves.
 * Version 1.2.0
 */

class CurveControllerCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._hass = null;
    this._config = null;
    this._selectedCurve = null;
    this._editedPoints = null;
    this._statusMessage = "";
    this._statusTimeout = null;
    this._initialized = false;
  }

  static async getConfigElement() {
    return document.createElement("curve-controller-card-editor");
  }

  static getStubConfig(hass, entities) {
    const defaultEntity = entities && entities.length
      ? entities.find((e) => e.startsWith("sensor.curve_controller_")) || entities[0]
      : "sensor.curve_controller_calculated_output";
    return {
      entity: defaultEntity,
      title: "Contrôleur de Courbe",
      curve_color: "#03a9f4",
      marker_color: "#ff9800",
      show_regulation_toggle: true,
      show_points_editor: true,
      show_area: true,
      show_grid: true,
      show_axis_badges: true,
      show_marker: true,
    };
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._initialized) {
      this._buildCard();
      this._initialized = true;
    }
    this._updateState();
  }

  setConfig(config) {
    this._config = {
      title: "Contrôleur de Courbe",
      curve_color: "#03a9f4",
      marker_color: "#ff9800",
      show_regulation_toggle: true,
      show_points_editor: true,
      show_area: true,
      show_grid: true,
      show_axis_badges: true,
      show_marker: true,
      ...config,
    };
    if (this._initialized) {
      this._buildCard();
      this._updateState();
    }
  }

  getCardSize() {
    return 7;
  }

  // Find the curve controller entities
  _getControllerEntities() {
    if (!this._hass) return [];
    return Object.keys(this._hass.states)
      .filter(
        (eid) =>
          (eid.startsWith("sensor.curve_controller_") ||
            eid.startsWith("select.curve_controller_")) &&
          this._hass.states[eid].attributes &&
          this._hass.states[eid].attributes.curves
      )
      .map((eid) => ({
        id: eid,
        name:
          this._hass.states[eid].attributes.friendly_name ||
          eid.replace("sensor.curve_controller_", "").replace("select.curve_controller_", ""),
      }));
  }

  _getTargetEntity() {
    if (!this._hass) return null;
    if (this._config && this._config.entity && this._hass.states[this._config.entity]) {
      return this._hass.states[this._config.entity];
    }
    const entities = this._getControllerEntities();
    if (entities.length > 0) {
      const sensorEntity = entities.find((e) => e.id.startsWith("sensor."));
      return this._hass.states[(sensorEntity || entities[0]).id];
    }
    return null;
  }

  _getUnits(attrs) {
    let sourceUnit = attrs.source_unit || "";
    let targetUnit = attrs.target_unit || "";

    if (!sourceUnit && attrs.source_entity && this._hass && this._hass.states[attrs.source_entity]) {
      sourceUnit = this._hass.states[attrs.source_entity].attributes?.unit_of_measurement || "";
    }
    if (!targetUnit && attrs.target_entity && this._hass && this._hass.states[attrs.target_entity]) {
      const tgtState = this._hass.states[attrs.target_entity];
      targetUnit = tgtState.attributes?.unit_of_measurement || "";
      if (!targetUnit && attrs.target_entity.startsWith("climate.")) {
        targetUnit = tgtState.attributes?.temperature_unit || "°C";
      }
    }
    return { sourceUnit, targetUnit };
  }

  _interpolate(points, x) {
    if (!points || points.length === 0) return 0;
    const sorted = [...points].sort((a, b) => a[0] - b[0]);
    if (sorted.length === 1) return sorted[0][1];

    if (x <= sorted[0][0]) return sorted[0][1];
    if (x >= sorted[sorted.length - 1][0]) return sorted[sorted.length - 1][1];

    for (let i = 0; i < sorted.length - 1; i++) {
      const [x1, y1] = sorted[i];
      const [x2, y2] = sorted[i + 1];
      if (x >= x1 && x <= x2) {
        if (x2 === x1) return y1;
        const slope = (y2 - y1) / (x2 - x1);
        return y1 + (x - x1) * slope;
      }
    }
    return sorted[sorted.length - 1][1];
  }

  _showMessage(msg, isError = false) {
    if (this._statusTimeout) clearTimeout(this._statusTimeout);
    const container = this.shadowRoot.getElementById("status-container");
    if (container) {
      container.innerHTML = `<div class="status-msg ${isError ? "error" : "success"}">${msg}</div>`;
      this._statusTimeout = setTimeout(() => {
        container.innerHTML = "";
      }, 4000);
    }
  }

  async _saveCurrentCurve(entryId, curveName, points, setActive = false) {
    try {
      const cleaned = points
        .map((p) => [parseFloat(p[0]) || 0, parseFloat(p[1]) || 0])
        .sort((a, b) => a[0] - b[0]);

      // Optimistically update the entity state in local memory so UI responds immediately
      const entityState = this._getTargetEntity();
      if (entityState && entityState.attributes) {
        if (!entityState.attributes.curves) entityState.attributes.curves = {};
        entityState.attributes.curves[curveName] = cleaned;
        if (setActive) {
          entityState.attributes.active_curve = curveName;
        }
      }

      await this._hass.callService("curve_controller", "save_curve", {
        entry_id: entryId,
        curve_name: curveName,
        points: cleaned,
        set_active: setActive,
      });

      this._selectedCurve = curveName;
      this._editedPoints = null;
      this._showMessage(`Courbe "${curveName}" enregistrée avec succès !`);

      this._updateDropdownOptions();
      this._renderPointsTable();
      this._updateSvgGraph();
      this._updateToolbarState();
    } catch (err) {
      console.error(err);
      this._showMessage(`Erreur lors de la sauvegarde : ${err.message || err}`, true);
    }
  }

  async _activateCurve(entryId, curveName) {
    try {
      const entityState = this._getTargetEntity();
      if (entityState && entityState.attributes) {
        entityState.attributes.active_curve = curveName;
      }

      await this._hass.callService("curve_controller", "select_curve", {
        entry_id: entryId,
        curve_name: curveName,
      });

      this._showMessage(`Courbe "${curveName}" activée en production !`);
      this._updateDropdownOptions();
      this._updateToolbarState();
      this._updateSvgGraph();
    } catch (err) {
      console.error(err);
      this._showMessage(`Erreur lors de l'activation : ${err.message || err}`, true);
    }
  }

  async _toggleRegulation(entryId, currentState) {
    try {
      const newState = !currentState;
      const entityState = this._getTargetEntity();
      if (entityState && entityState.attributes) {
        entityState.attributes.regulation_enabled = newState;
      }

      await this._hass.callService("curve_controller", "set_regulation", {
        entry_id: entryId,
        enabled: newState,
      });

      this._showMessage(newState ? "Régulation activée !" : "Régulation suspendue (consigne figée).");
      this._updateRegulationUI(newState);
      this._updateSvgGraph();
    } catch (err) {
      console.error(err);
      this._showMessage(`Erreur régulation : ${err.message || err}`, true);
    }
  }

  async _deleteCurve(entryId, curveName) {
    if (!confirm(`Confirmer la suppression définitive de la courbe "${curveName}" ?`)) return;
    try {
      const entityState = this._getTargetEntity();
      if (entityState && entityState.attributes && entityState.attributes.curves) {
        delete entityState.attributes.curves[curveName];
        const remaining = Object.keys(entityState.attributes.curves);
        this._selectedCurve = remaining.length > 0 ? remaining[0] : "";
        if (entityState.attributes.active_curve === curveName) {
          entityState.attributes.active_curve = this._selectedCurve;
        }
      }

      await this._hass.callService("curve_controller", "delete_curve", {
        entry_id: entryId,
        curve_name: curveName,
      });

      this._editedPoints = null;
      this._showMessage(`Courbe "${curveName}" supprimée.`);

      this._updateDropdownOptions();
      this._renderPointsTable();
      this._updateSvgGraph();
      this._updateToolbarState();
    } catch (err) {
      console.error(err);
      this._showMessage(`Erreur : ${err.message || err}`, true);
    }
  }

  _buildCard() {
    const showReg = this._config.show_regulation_toggle !== false;
    const showEditor = this._config.show_points_editor !== false;
    const curveColor = this._config.curve_color || "var(--primary-color, #03a9f4)";

    this.shadowRoot.innerHTML = `
      <ha-card>
        <div class="card-header">
          <div class="header-title">
            <ha-icon icon="mdi:chart-bell-curve-cumulative" class="header-icon" style="color: ${curveColor};"></ha-icon>
            <span id="card-title-text">${this._config.title}</span>
          </div>
          <div class="header-controls">
            <!-- Regulation Toggle Switch -->
            <div class="regulation-toggle-wrapper" id="regulation-toggle-wrapper" style="${showReg ? '' : 'display: none;'}">
              <span class="reg-label" id="reg-status-label">Régulation :</span>
              <button class="toggle-switch-btn" id="reg-toggle-btn" title="Activer ou suspendre la régulation">
                <span class="toggle-thumb"></span>
              </button>
            </div>
          </div>
        </div>

        <div class="card-content">
          <div id="status-container"></div>

          <!-- Regulation Paused Warning Banner -->
          <div id="regulation-paused-banner" class="paused-banner" style="display: none;">
            <ha-icon icon="mdi:pause-circle-outline"></ha-icon>
            <span>Régulation suspendue — Les valeurs ne sont plus injectées sur la sortie.</span>
          </div>

          <!-- Curve selector toolbar -->
          <div class="toolbar">
            <div class="curve-select-wrapper">
              <label for="curve-select">Profil :</label>
              <select id="curve-select" class="dropdown"></select>
              <span id="active-badge-container"></span>
            </div>
            <div class="toolbar-actions">
              <button class="btn btn-outline" id="btn-activate-curve" style="display: none;">Définir active</button>
              <button class="btn btn-sm" id="btn-new-curve">+ Profil</button>
              <button class="btn btn-sm btn-danger" id="btn-del-curve" title="Supprimer ce profil">✕</button>
            </div>
          </div>

          <!-- SVG Visual Chart -->
          <div class="chart-container">
            <svg id="curve-svg" viewBox="0 0 520 250" class="curve-svg">
              <defs>
                <linearGradient id="areaGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stop-color="${curveColor}" stop-opacity="0.30"/>
                  <stop offset="100%" stop-color="${curveColor}" stop-opacity="0.02"/>
                </linearGradient>
              </defs>
              <g id="svg-grid"></g>
              <path id="svg-area" fill="url(#areaGrad)"></path>
              <path id="svg-line" class="curve-line" style="stroke: ${curveColor};"></path>
              <g id="svg-points"></g>
              <g id="svg-current-marker"></g>
              <g id="svg-labels"></g>
            </svg>
          </div>

          <!-- Points Editor -->
          <div class="editor-section" id="editor-section" style="${showEditor ? '' : 'display: none;'}">
            <div class="editor-header">
              <span class="editor-title" id="editor-title-text">Points de la courbe</span>
              <span id="unsaved-badge" class="unsaved-badge" style="display: none;">● Modifications non enregistrées</span>
            </div>

            <div class="table-container">
              <table class="points-table">
                <thead>
                  <tr>
                    <th class="idx-col">#</th>
                    <th id="th-x-label">X (Entrée)</th>
                    <th id="th-y-label">Y (Consigne)</th>
                    <th class="action-col"></th>
                  </tr>
                </thead>
                <tbody id="points-table-body"></tbody>
              </table>
            </div>

            <div class="editor-actions">
              <button class="btn btn-secondary" id="btn-add-point">+ Ajouter un point</button>
              <div class="right-actions">
                <button class="btn btn-outline" id="btn-reset" style="display: none;">Annuler</button>
                <button class="btn btn-primary" id="btn-save" style="background: ${curveColor};">💾 Sauvegarder</button>
              </div>
            </div>
          </div>
        </div>
      </ha-card>
      ${this._getStyles()}
    `;

    this._bindEvents();
  }

  _bindEvents() {
    const root = this.shadowRoot;

    // Regulation toggle button
    const regToggleBtn = root.getElementById("reg-toggle-btn");
    if (regToggleBtn) {
      regToggleBtn.addEventListener("click", () => {
        const entityState = this._getTargetEntity();
        if (entityState && entityState.attributes) {
          const entryId = entityState.attributes.entry_id;
          const isRegOn = entityState.attributes.regulation_enabled !== false;
          this._toggleRegulation(entryId, isRegOn);
        }
      });
    }

    // Curve select change
    const curveSelect = root.getElementById("curve-select");
    if (curveSelect) {
      curveSelect.addEventListener("change", (e) => {
        this._selectedCurve = e.target.value;
        this._editedPoints = null;
        this._renderPointsTable();
        this._updateSvgGraph();
        this._updateToolbarState();
      });
    }

    // Activate curve button
    const activateBtn = root.getElementById("btn-activate-curve");
    if (activateBtn) {
      activateBtn.addEventListener("click", () => {
        const entityState = this._getTargetEntity();
        if (entityState && entityState.attributes) {
          this._activateCurve(entityState.attributes.entry_id, this._selectedCurve);
        }
      });
    }

    // New curve button
    const newCurveBtn = root.getElementById("btn-new-curve");
    if (newCurveBtn) {
      newCurveBtn.addEventListener("click", () => {
        const entityState = this._getTargetEntity();
        if (!entityState || !entityState.attributes) return;
        const name = prompt("Nom du nouveau profil de courbe (ex. Nuit, Absent, Canicule) :");
        if (name && name.trim()) {
          const trimmed = name.trim();
          const currentPts = this._getCurrentPoints();
          const initialPts = currentPts.length ? currentPts.map((p) => [...p]) : [[0, 20], [10, 25]];
          this._saveCurrentCurve(entityState.attributes.entry_id, trimmed, initialPts, false);
          this._selectedCurve = trimmed;
        }
      });
    }

    // Delete curve button
    const delCurveBtn = root.getElementById("btn-del-curve");
    if (delCurveBtn) {
      delCurveBtn.addEventListener("click", () => {
        const entityState = this._getTargetEntity();
        if (entityState && entityState.attributes) {
          this._deleteCurve(entityState.attributes.entry_id, this._selectedCurve);
        }
      });
    }

    // Add point button
    const addPtBtn = root.getElementById("btn-add-point");
    if (addPtBtn) {
      addPtBtn.addEventListener("click", () => {
        const currentPts = this._getCurrentPoints();
        if (!this._editedPoints) {
          this._editedPoints = currentPts.map((p) => [...p]);
        }
        let newX = 20;
        let newY = 20;
        if (this._editedPoints.length > 0) {
          const last = this._editedPoints[this._editedPoints.length - 1];
          newX = (parseFloat(last[0]) || 0) + 5;
          newY = parseFloat(last[1]) || 0;
        }
        this._editedPoints.push([newX, newY]);
        this._renderPointsTable();
        this._updateSvgGraph();
        this._updateToolbarState();
      });
    }

    // Reset button
    const resetBtn = root.getElementById("btn-reset");
    if (resetBtn) {
      resetBtn.addEventListener("click", () => {
        this._editedPoints = null;
        this._renderPointsTable();
        this._updateSvgGraph();
        this._updateToolbarState();
      });
    }

    // Save button
    const saveBtn = root.getElementById("btn-save");
    if (saveBtn) {
      saveBtn.addEventListener("click", () => {
        const entityState = this._getTargetEntity();
        if (entityState && entityState.attributes) {
          const entryId = entityState.attributes.entry_id;
          const activeCurve = entityState.attributes.active_curve || "";
          const pts = this._getCurrentPoints();
          this._saveCurrentCurve(entryId, this._selectedCurve, pts, this._selectedCurve === activeCurve);
        }
      });
    }
  }

  _getCurrentPoints() {
    if (this._editedPoints !== null) {
      return this._editedPoints;
    }
    const entityState = this._getTargetEntity();
    if (!entityState || !entityState.attributes || !entityState.attributes.curves) {
      return [];
    }
    const curves = entityState.attributes.curves;
    if (this._selectedCurve && curves[this._selectedCurve]) {
      return curves[this._selectedCurve].map((p) => [p[0], p[1]]);
    }
    return [];
  }

  _updateRegulationUI(isRegOn) {
    const regToggleBtn = this.shadowRoot.getElementById("reg-toggle-btn");
    const regStatusLabel = this.shadowRoot.getElementById("reg-status-label");
    const regPausedBanner = this.shadowRoot.getElementById("regulation-paused-banner");

    if (regToggleBtn) {
      if (isRegOn) {
        regToggleBtn.classList.add("active");
        if (regStatusLabel) regStatusLabel.innerHTML = `Régulation : <strong class="text-success">ACTIVE</strong>`;
        if (regPausedBanner) regPausedBanner.style.display = "none";
      } else {
        regToggleBtn.classList.remove("active");
        if (regStatusLabel) regStatusLabel.innerHTML = `Régulation : <strong class="text-warning">EN PAUSE</strong>`;
        if (regPausedBanner) regPausedBanner.style.display = "flex";
      }
    }
  }

  _updateDropdownOptions() {
    const entityState = this._getTargetEntity();
    if (!entityState || !entityState.attributes) return;

    const attrs = entityState.attributes;
    const curves = attrs.curves || {};
    const activeCurve = attrs.active_curve || "";
    const curveNames = Object.keys(curves);

    if (!this._selectedCurve || !curves[this._selectedCurve]) {
      this._selectedCurve = activeCurve && curves[activeCurve] ? activeCurve : (curveNames[0] || "");
    }

    const curveSelect = this.shadowRoot.getElementById("curve-select");
    if (curveSelect) {
      curveSelect.innerHTML = curveNames
        .map(
          (c) => `
          <option value="${c}" ${c === this._selectedCurve ? "selected" : ""}>
            ${c} ${c === activeCurve ? "★" : ""}
          </option>
        `
        )
        .join("");
      curveSelect.value = this._selectedCurve;
    }
  }

  _updateState() {
    const entityState = this._getTargetEntity();
    if (!entityState || !entityState.attributes) return;

    const attrs = entityState.attributes;

    // Update Regulation Switch in UI
    const isRegOn = attrs.regulation_enabled !== false;
    this._updateRegulationUI(isRegOn);

    // Synchronize dropdown options with current available curves
    this._updateDropdownOptions();

    // Update table headers with entities units
    const { sourceUnit, targetUnit } = this._getUnits(attrs);
    const thX = this.shadowRoot.getElementById("th-x-label");
    const thY = this.shadowRoot.getElementById("th-y-label");
    if (thX) thX.textContent = `X (Entrée ${sourceUnit ? `[${sourceUnit}]` : ""})`;
    if (thY) thY.textContent = `Y (Consigne ${targetUnit ? `[${targetUnit}]` : ""})`;

    // Re-render table ONLY if not currently focused and no unsaved edits in progress
    const isInputFocused = !!this.shadowRoot.querySelector("input:focus");
    if (!isInputFocused && this._editedPoints === null) {
      this._renderPointsTable();
    }

    this._updateToolbarState();
    this._updateSvgGraph();
  }

  _updateToolbarState() {
    const entityState = this._getTargetEntity();
    if (!entityState || !entityState.attributes) return;

    const attrs = entityState.attributes;
    const activeCurve = attrs.active_curve || "";
    const isCurrentActive = this._selectedCurve === activeCurve;
    const hasUnsaved = this._editedPoints !== null;

    const badgeContainer = this.shadowRoot.getElementById("active-badge-container");
    const activateBtn = this.shadowRoot.getElementById("btn-activate-curve");
    const unsavedBadge = this.shadowRoot.getElementById("unsaved-badge");
    const resetBtn = this.shadowRoot.getElementById("btn-reset");
    const delCurveBtn = this.shadowRoot.getElementById("btn-del-curve");

    if (badgeContainer) {
      badgeContainer.innerHTML = isCurrentActive
        ? `<span class="badge active-badge"><ha-icon icon="mdi:check-circle"></ha-icon> ACTIVE</span>`
        : "";
    }

    if (activateBtn) {
      activateBtn.style.display = isCurrentActive ? "none" : "inline-block";
    }

    if (unsavedBadge) {
      unsavedBadge.style.display = hasUnsaved ? "inline" : "none";
    }

    if (resetBtn) {
      resetBtn.style.display = hasUnsaved ? "inline-block" : "none";
    }

    const curvesCount = Object.keys(attrs.curves || {}).length;
    if (delCurveBtn) {
      delCurveBtn.style.display = curvesCount > 1 ? "inline-block" : "none";
    }

    const editorTitle = this.shadowRoot.getElementById("editor-title-text");
    const pts = this._getCurrentPoints();
    if (editorTitle) {
      editorTitle.textContent = `Points du profil "${this._selectedCurve}" (${pts.length} points)`;
    }
  }

  _renderPointsTable() {
    const tbody = this.shadowRoot.getElementById("points-table-body");
    if (!tbody) return;

    // Do not disrupt active input
    if (this.shadowRoot.querySelector("input:focus")) return;

    const pts = this._getCurrentPoints();
    tbody.innerHTML = pts
      .map(
        (pt, idx) => `
      <tr>
        <td class="idx-col">#${idx + 1}</td>
        <td>
          <input type="text" inputmode="decimal" class="pt-input" data-idx="${idx}" data-field="0" value="${pt[0]}" />
        </td>
        <td>
          <input type="text" inputmode="decimal" class="pt-input" data-idx="${idx}" data-field="1" value="${pt[1]}" />
        </td>
        <td class="action-col">
          <button class="btn-icon delete-btn" data-idx="${idx}" title="Supprimer ce point">✕</button>
        </td>
      </tr>
    `
      )
      .join("");

    // Attach listeners on inputs
    tbody.querySelectorAll(".pt-input").forEach((input) => {
      input.addEventListener("input", (e) => {
        const idx = parseInt(e.target.dataset.idx, 10);
        const field = parseInt(e.target.dataset.field, 10);
        const rawVal = e.target.value.trim();

        if (!this._editedPoints) {
          this._editedPoints = pts.map((p) => [...p]);
        }

        this._editedPoints[idx][field] = rawVal;
        this._updateToolbarState();
        this._updateSvgGraph();
      });

      input.addEventListener("blur", (e) => {
        const idx = parseInt(e.target.dataset.idx, 10);
        const field = parseInt(e.target.dataset.field, 10);
        const parsed = parseFloat(e.target.value);
        if (!isNaN(parsed)) {
          if (!this._editedPoints) this._editedPoints = pts.map((p) => [...p]);
          this._editedPoints[idx][field] = parsed;
          e.target.value = parsed;
        }
        this._updateSvgGraph();
      });
    });

    // Delete point button listener
    tbody.querySelectorAll(".delete-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const idx = parseInt(e.target.dataset.idx, 10);
        if (pts.length <= 2) {
          alert("Une courbe doit contenir au minimum 2 points.");
          return;
        }
        if (!this._editedPoints) {
          this._editedPoints = pts.map((p) => [...p]);
        }
        this._editedPoints.splice(idx, 1);
        this._renderPointsTable();
        this._updateSvgGraph();
        this._updateToolbarState();
      });
    });
  }

  _updateSvgGraph() {
    const entityState = this._getTargetEntity();
    if (!entityState || !entityState.attributes) return;

    const attrs = entityState.attributes;
    const { sourceUnit, targetUnit } = this._getUnits(attrs);
    const isRegOn = attrs.regulation_enabled !== false;

    const curveColor = this._config.curve_color || "var(--primary-color, #03a9f4)";
    const defaultMarkerColor = this._config.marker_color || "var(--accent-color, #ff9800)";
    const markerColor = isRegOn ? defaultMarkerColor : "#9e9e9e";

    const showGrid = this._config.show_grid !== false;
    const showArea = this._config.show_area !== false;
    const showBadges = this._config.show_axis_badges !== false;
    const showMarker = this._config.show_marker !== false;

    const sourceValue = typeof attrs.source_value === "number" ? attrs.source_value : null;
    const rawPoints = this._getCurrentPoints();

    // Numeric points sorted by X
    const numericPoints = rawPoints
      .map((p) => [parseFloat(p[0]), parseFloat(p[1])])
      .filter((p) => !isNaN(p[0]) && !isNaN(p[1]))
      .sort((a, b) => a[0] - b[0]);

    if (numericPoints.length === 0) return;

    // Viewport dimensions
    const svgWidth = 520;
    const svgHeight = 250;
    const margin = { top: 25, right: 35, bottom: 45, left: 60 };
    const plotW = svgWidth - margin.left - margin.right;
    const plotH = svgHeight - margin.top - margin.bottom;

    // Bounds
    const allX = numericPoints.map((p) => p[0]);
    const allY = numericPoints.map((p) => p[1]);
    if (sourceValue !== null) allX.push(sourceValue);

    let minX = Math.min(...allX);
    let maxX = Math.max(...allX);
    let minY = Math.min(...allY);
    let maxY = Math.max(...allY);

    if (minX === maxX) {
      minX -= 5;
      maxX += 5;
    }
    if (minY === maxY) {
      minY -= 5;
      maxY += 5;
    }

    const padX = (maxX - minX) * 0.1 || 2;
    const padY = (maxY - minY) * 0.1 || 2;
    minX -= padX;
    maxX += padX;
    minY -= padY;
    maxY += padY;

    const toSvgX = (x) => margin.left + ((x - minX) / (maxX - minX)) * plotW;
    const toSvgY = (y) => margin.top + plotH - ((y - minY) / (maxY - minY)) * plotH;

    // 1. Grid ticks
    const numTicks = 5;
    let gridSvg = "";
    let labelsSvg = "";

    for (let i = 0; i <= numTicks; i++) {
      // Y ticks
      const valY = minY + (i / numTicks) * (maxY - minY);
      const sy = toSvgY(valY);
      if (showGrid) {
        gridSvg += `<line x1="${margin.left}" y1="${sy}" x2="${svgWidth - margin.right}" y2="${sy}" stroke="var(--divider-color, rgba(125,125,125,0.2))" stroke-width="1" />`;
      }
      labelsSvg += `<text x="${margin.left - 8}" y="${sy + 4}" text-anchor="end" class="axis-tick-text">${valY.toFixed(1)}</text>`;

      // X ticks
      const valX = minX + (i / numTicks) * (maxX - minX);
      const sx = toSvgX(valX);
      if (showGrid) {
        gridSvg += `<line x1="${sx}" y1="${margin.top}" x2="${sx}" y2="${margin.top + plotH}" stroke="var(--divider-color, rgba(125,125,125,0.2))" stroke-width="1" />`;
      }
      labelsSvg += `<text x="${sx}" y="${margin.top + plotH + 18}" text-anchor="middle" class="axis-tick-text">${valX.toFixed(1)}</text>`;
    }

    // Axis legend labels with units
    labelsSvg += `<text x="${svgWidth - margin.right}" y="${margin.top + plotH - 8}" text-anchor="end" class="axis-title-text">X Entrée ${sourceUnit ? `(${sourceUnit})` : ""}</text>`;
    labelsSvg += `<text x="${margin.left + 8}" y="${margin.top + 12}" text-anchor="start" class="axis-title-text">Y Consigne ${targetUnit ? `(${targetUnit})` : ""}</text>`;

    // 2. Build curve path
    const firstPt = numericPoints[0];
    const lastPt = numericPoints[numericPoints.length - 1];

    let pathD = `M ${toSvgX(minX)} ${toSvgY(firstPt[1])} L ${toSvgX(firstPt[0])} ${toSvgY(firstPt[1])}`;
    numericPoints.forEach((pt) => {
      pathD += ` L ${toSvgX(pt[0])} ${toSvgY(pt[1])}`;
    });
    pathD += ` L ${toSvgX(maxX)} ${toSvgY(lastPt[1])}`;

    const bottomY = toSvgY(minY);
    const areaD = showArea ? `${pathD} L ${toSvgX(maxX)} ${bottomY} L ${toSvgX(minX)} ${bottomY} Z` : "";

    // 3. Circles for points
    const circlesSvg = numericPoints
      .map(
        (pt, idx) => `
      <circle cx="${toSvgX(pt[0])}" cy="${toSvgY(pt[1])}" r="5" class="point-circle" style="stroke: ${curveColor};">
        <title>Point ${idx + 1} : X=${pt[0]}${sourceUnit}, Y=${pt[1]}${targetUnit}</title>
      </circle>
    `
      )
      .join("");

    // 4. Dynamic marker & Real-time Live Axis Value Badges!
    let markerSvg = "";
    if (showMarker && sourceValue !== null && numericPoints.length > 0) {
      const curY = this._interpolate(numericPoints, sourceValue);
      const mx = toSvgX(sourceValue);
      const my = toSvgY(curY);

      const xText = `${sourceValue.toFixed(1)} ${sourceUnit}`;
      const yText = `${curY.toFixed(1)} ${targetUnit}`;

      const xBadgeW = Math.max(50, xText.length * 7.5 + 14);
      const yBadgeW = Math.max(50, yText.length * 7.5 + 14);

      let badgesSvg = "";
      if (showBadges) {
        badgesSvg = `
          <!-- X-Axis dynamic badge at source position -->
          <g transform="translate(${Math.max(margin.left, Math.min(svgWidth - margin.right - xBadgeW, mx - xBadgeW / 2))}, ${margin.top + plotH + 4})">
            <rect x="0" y="0" width="${xBadgeW}" height="20" rx="4" fill="${markerColor}" class="axis-badge-bg" />
            <text x="${xBadgeW / 2}" y="14" text-anchor="middle" class="axis-badge-text">${xText}</text>
          </g>

          <!-- Y-Axis dynamic badge at target setpoint position -->
          <g transform="translate(${margin.left - yBadgeW - 4}, ${Math.max(margin.top, Math.min(margin.top + plotH - 20, my - 10))})">
            <rect x="0" y="0" width="${yBadgeW}" height="20" rx="4" fill="${markerColor}" class="axis-badge-bg" />
            <text x="${yBadgeW / 2}" y="14" text-anchor="middle" class="axis-badge-text">${yText}</text>
          </g>
        `;
      }

      markerSvg = `
        <g class="live-marker-group">
          <!-- Crosshair guides to axes -->
          <line x1="${mx}" y1="${toSvgY(minY)}" x2="${mx}" y2="${my}" stroke="${markerColor}" stroke-dasharray="3,3" stroke-width="1.5" />
          <line x1="${margin.left}" y1="${my}" x2="${mx}" y2="${my}" stroke="${markerColor}" stroke-dasharray="3,3" stroke-width="1.5" />

          ${badgesSvg}

          <!-- Pulsing dot on curve -->
          ${
            isRegOn
              ? `
            <circle cx="${mx}" cy="${my}" r="9" fill="${markerColor}" opacity="0.3">
              <animate attributeName="r" values="6;13;6" dur="2s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.4;0.05;0.4" dur="2s" repeatCount="indefinite" />
            </circle>
          `
              : `
            <circle cx="${mx}" cy="${my}" r="8" fill="none" stroke="${markerColor}" stroke-dasharray="2,2" stroke-width="2" />
          `
          }
          <circle cx="${mx}" cy="${my}" r="5" fill="${markerColor}" stroke="#ffffff" stroke-width="2">
            <title>Position actuelle : ${xText} ➔ ${yText} ${isRegOn ? "" : "(Régulation en pause)"}</title>
          </circle>
        </g>
      `;
    }

    // Apply to SVG DOM elements
    const svgGrid = this.shadowRoot.getElementById("svg-grid");
    const svgLabels = this.shadowRoot.getElementById("svg-labels");
    const svgLine = this.shadowRoot.getElementById("svg-line");
    const svgArea = this.shadowRoot.getElementById("svg-area");
    const svgPoints = this.shadowRoot.getElementById("svg-points");
    const svgMarker = this.shadowRoot.getElementById("svg-current-marker");

    if (svgGrid) svgGrid.innerHTML = gridSvg;
    if (svgLabels) svgLabels.innerHTML = labelsSvg;
    if (svgLine) {
      svgLine.setAttribute("d", pathD);
      svgLine.style.stroke = curveColor;
    }
    if (svgArea) svgArea.setAttribute("d", areaD);
    if (svgPoints) svgPoints.innerHTML = circlesSvg;
    if (svgMarker) svgMarker.innerHTML = markerSvg;
  }

  _getStyles() {
    const curveColor = this._config.curve_color || "var(--primary-color, #03a9f4)";
    return `
      <style>
        :host {
          display: block;
        }
        ha-card {
          overflow: hidden;
          background: var(--ha-card-background, var(--card-background-color, #fff));
          border-radius: var(--ha-card-border-radius, 12px);
          box-shadow: var(--ha-card-box-shadow, 0 2px 8px rgba(0,0,0,0.08));
          color: var(--primary-text-color, #212121);
          font-family: var(--paper-font-body1_-_font-family, Roboto, sans-serif);
        }
        .card-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 14px 18px 12px;
          border-bottom: 1px solid var(--divider-color, rgba(0,0,0,0.08));
        }
        .header-title {
          display: flex;
          align-items: center;
          gap: 10px;
          font-size: 1.15rem;
          font-weight: 600;
        }
        .header-icon {
          color: ${curveColor};
        }
        .header-controls {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .regulation-toggle-wrapper {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .reg-label {
          font-size: 0.85rem;
          color: var(--secondary-text-color, #757575);
        }
        .text-success {
          color: var(--success-color, #4caf50);
        }
        .text-warning {
          color: var(--accent-color, #ff9800);
        }
        .toggle-switch-btn {
          position: relative;
          width: 44px;
          height: 24px;
          border-radius: 12px;
          border: none;
          background: var(--disabled-text-color, #bbb);
          cursor: pointer;
          transition: background 0.3s ease;
          padding: 2px;
        }
        .toggle-switch-btn.active {
          background: var(--success-color, #4caf50);
        }
        .toggle-thumb {
          display: block;
          width: 20px;
          height: 20px;
          border-radius: 50%;
          background: #fff;
          transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          box-shadow: 0 1px 3px rgba(0,0,0,0.3);
        }
        .toggle-switch-btn.active .toggle-thumb {
          transform: translateX(20px);
        }
        .card-content {
          padding: 14px 18px;
        }
        .paused-banner {
          display: flex;
          align-items: center;
          gap: 8px;
          background: rgba(255, 152, 0, 0.15);
          color: #e65100;
          border: 1px solid rgba(255, 152, 0, 0.35);
          padding: 8px 12px;
          border-radius: 6px;
          font-size: 0.85rem;
          font-weight: 500;
          margin-bottom: 12px;
          animation: fadeIn 0.3s ease;
        }
        .status-msg {
          padding: 8px 12px;
          margin-bottom: 12px;
          border-radius: 6px;
          font-size: 0.85rem;
          animation: fadeIn 0.3s ease;
        }
        .status-msg.success {
          background-color: rgba(76, 175, 80, 0.15);
          color: #2e7d32;
          border: 1px solid rgba(76, 175, 80, 0.3);
        }
        .status-msg.error {
          background-color: rgba(244, 67, 54, 0.15);
          color: #c62828;
          border: 1px solid rgba(244, 67, 54, 0.3);
        }
        .toolbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          flex-wrap: wrap;
          gap: 10px;
          margin-bottom: 12px;
        }
        .curve-select-wrapper {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .curve-select-wrapper label {
          font-size: 0.85rem;
          font-weight: 500;
          color: var(--secondary-text-color, #757575);
        }
        .dropdown {
          background: var(--input-fill-color, var(--card-background-color, #fff));
          color: var(--primary-text-color, #212121);
          border: 1px solid var(--divider-color, #ccc);
          padding: 6px 10px;
          border-radius: 6px;
          font-size: 0.9rem;
          cursor: pointer;
        }
        .toolbar-actions {
          display: flex;
          gap: 6px;
        }
        .btn {
          border: none;
          padding: 6px 12px;
          border-radius: 6px;
          font-size: 0.85rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s ease;
        }
        .btn-sm {
          padding: 5px 9px;
          font-size: 0.8rem;
          background: var(--secondary-background-color, rgba(0,0,0,0.05));
          color: var(--primary-text-color);
        }
        .btn-sm:hover {
          background: rgba(0,0,0,0.1);
        }
        .btn-primary {
          background: ${curveColor};
          color: #fff;
        }
        .btn-primary:hover {
          filter: brightness(1.1);
        }
        .btn-secondary {
          background: var(--secondary-background-color, rgba(0,0,0,0.06));
          color: var(--primary-text-color);
        }
        .btn-outline {
          background: transparent;
          border: 1px solid ${curveColor};
          color: ${curveColor};
        }
        .btn-danger {
          background: rgba(244, 67, 54, 0.1);
          color: #d32f2f;
        }
        .btn-icon {
          background: transparent;
          border: none;
          cursor: pointer;
          font-size: 1rem;
          padding: 4px;
          color: var(--secondary-text-color);
        }
        .btn-icon:hover {
          color: #d32f2f;
        }
        .badge {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 3px 8px;
          border-radius: 12px;
          font-size: 0.72rem;
          font-weight: 700;
          letter-spacing: 0.5px;
        }
        .active-badge {
          background: rgba(76, 175, 80, 0.2);
          color: #2e7d32;
        }
        .unsaved-badge {
          font-size: 0.75rem;
          color: var(--accent-color, #ff9800);
          font-weight: 600;
        }
        .chart-container {
          width: 100%;
          background: var(--secondary-background-color, rgba(0,0,0,0.02));
          border-radius: 8px;
          padding: 6px;
          margin-bottom: 14px;
          border: 1px solid var(--divider-color, rgba(0,0,0,0.06));
        }
        .curve-svg {
          width: 100%;
          height: auto;
          overflow: visible;
        }
        .curve-line {
          fill: none;
          stroke-width: 2.8;
          stroke-linecap: round;
          stroke-linejoin: round;
        }
        .point-circle {
          fill: #fff;
          stroke-width: 2.5;
          cursor: pointer;
        }
        .point-circle:hover {
          r: 7;
        }
        .axis-tick-text {
          font-size: 10px;
          fill: var(--secondary-text-color, #757575);
        }
        .axis-title-text {
          font-size: 10px;
          fill: var(--secondary-text-color, #757575);
          font-weight: 600;
        }
        .axis-badge-bg {
          filter: drop-shadow(0 1px 2px rgba(0,0,0,0.25));
        }
        .axis-badge-text {
          font-size: 10.5px;
          font-weight: 700;
          fill: #ffffff;
        }
        .editor-section {
          border-top: 1px solid var(--divider-color, rgba(0,0,0,0.08));
          padding-top: 12px;
        }
        .editor-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 8px;
        }
        .editor-title {
          font-size: 0.9rem;
          font-weight: 600;
        }
        .table-container {
          max-height: 180px;
          overflow-y: auto;
          margin-bottom: 12px;
          border: 1px solid var(--divider-color, rgba(0,0,0,0.08));
          border-radius: 6px;
        }
        .points-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 0.85rem;
        }
        .points-table th {
          background: var(--secondary-background-color, rgba(0,0,0,0.04));
          padding: 6px 8px;
          text-align: left;
          font-weight: 600;
          color: var(--secondary-text-color);
        }
        .points-table td {
          padding: 4px 8px;
          border-top: 1px solid var(--divider-color, rgba(0,0,0,0.05));
        }
        .idx-col {
          width: 36px;
          color: var(--secondary-text-color);
        }
        .action-col {
          width: 36px;
          text-align: center;
        }
        .pt-input {
          width: 90%;
          padding: 5px 8px;
          border: 1px solid var(--divider-color, #ccc);
          border-radius: 4px;
          background: var(--input-fill-color, var(--card-background-color, #fff));
          color: var(--primary-text-color);
          font-size: 0.85rem;
          font-weight: 500;
        }
        .pt-input:focus {
          outline: none;
          border-color: ${curveColor};
          box-shadow: 0 0 0 2px rgba(3, 169, 244, 0.2);
        }
        .editor-actions {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .right-actions {
          display: flex;
          gap: 8px;
        }
        @keyframes fadeIn {
          from {
            opacity: 0;
            transform: translateY(-3px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      </style>
    `;
  }
}

/**
 * Visual Card Editor for Lovelace UI Configuration
 */
class CurveControllerCardEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config = null;
    this._hass = null;
    this._form = null;
  }

  setConfig(config) {
    this._config = { ...config };
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  _render() {
    if (!this._hass || !this._config) return;

    if (!this._form) {
      this.shadowRoot.innerHTML = `
        <style>
          ha-form {
            display: block;
            margin-bottom: 8px;
          }
        </style>
        <ha-form id="form"></ha-form>
      `;
      this._form = this.shadowRoot.getElementById("form");
      this._form.addEventListener("value-changed", (ev) => {
        this._valueChanged(ev);
      });
    }

    const schema = [
      {
        name: "entity",
        selector: {
          entity: {
            domain: ["sensor", "select"],
          },
        },
      },
      {
        name: "title",
        selector: {
          text: {},
        },
      },
      {
        type: "grid",
        name: "",
        schema: [
          {
            name: "curve_color",
            selector: {
              text: {},
            },
          },
          {
            name: "marker_color",
            selector: {
              text: {},
            },
          },
        ],
      },
      {
        type: "grid",
        name: "",
        schema: [
          {
            name: "show_regulation_toggle",
            selector: {
              boolean: {},
            },
          },
          {
            name: "show_points_editor",
            selector: {
              boolean: {},
            },
          },
        ],
      },
      {
        type: "grid",
        name: "",
        schema: [
          {
            name: "show_area",
            selector: {
              boolean: {},
            },
          },
          {
            name: "show_grid",
            selector: {
              boolean: {},
            },
          },
        ],
      },
      {
        type: "grid",
        name: "",
        schema: [
          {
            name: "show_axis_badges",
            selector: {
              boolean: {},
            },
          },
          {
            name: "show_marker",
            selector: {
              boolean: {},
            },
          },
        ],
      },
    ];

    this._form.hass = this._hass;
    this._form.data = this._config;
    this._form.schema = schema;
    this._form.computeLabel = (s) => this._computeLabel(s);
  }

  _computeLabel(schema) {
    const labels = {
      entity: "Entité Curve Controller (sensor.*)",
      title: "Titre de la carte",
      curve_color: "Couleur de la courbe (ex: #03a9f4)",
      marker_color: "Couleur du marqueur dynamique (ex: #ff9800)",
      show_regulation_toggle: "Afficher le bouton On/Off de régulation",
      show_points_editor: "Afficher l'éditeur et le tableau des points",
      show_area: "Afficher la surface sous la courbe",
      show_grid: "Afficher la grille cartésienne",
      show_axis_badges: "Afficher les étiquettes en direct sur les axes",
      show_marker: "Afficher le point en temps réel sur le tracé",
    };
    return labels[schema.name] || schema.name;
  }

  _valueChanged(ev) {
    const newConfig = ev.detail.value;
    this._config = { ...newConfig };
    this.dispatchEvent(
      new CustomEvent("config-changed", {
        bubbles: true,
        composed: true,
        detail: { config: this._config },
      })
    );
  }
}

// Register custom card and editor to Custom Elements
if (!customElements.get("curve-controller-card-editor")) {
  customElements.define("curve-controller-card-editor", CurveControllerCardEditor);
}

if (!customElements.get("curve-controller-card")) {
  customElements.define("curve-controller-card", CurveControllerCard);

  window.customCards = window.customCards || [];
  window.customCards.push({
    type: "curve-controller-card",
    name: "Curve Controller Card",
    description: "Visualiseur et éditeur interactif de courbes par morceaux (chauffage, ventilation, etc.).",
    preview: true,
  });

  console.info(
    `%c CURVE-CONTROLLER-CARD %c Version 1.2.0 `,
    "color: white; background: #03a9f4; font-weight: 700; border-radius: 3px 0 0 3px;",
    "color: #03a9f4; background: #e1f5fe; font-weight: 700; border-radius: 0 3px 3px 0;"
  );
}
