/**
 * Curve Controller Card for Home Assistant Lovelace
 * Custom Web Component for visualizing and interactively editing piecewise linear curves.
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
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  setConfig(config) {
    this._config = {
      title: "Contrôleur de Courbe",
      ...config,
    };
  }

  getCardSize() {
    return 7;
  }

  static getStubConfig() {
    return {
      entity: "sensor.curve_controller_calculated_output",
      title: "Courbe de Chauffe / Ventilation",
    };
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
      return this._hass.states[entities[0].id];
    }
    return null;
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
    this._statusMessage = `<div class="status-msg ${isError ? "error" : "success"}">${msg}</div>`;
    this._render();
    this._statusTimeout = setTimeout(() => {
      this._statusMessage = "";
      this._render();
    }, 4000);
  }

  async _saveCurrentCurve(entryId, curveName, points, setActive = false) {
    try {
      await this._hass.callService("curve_controller", "save_curve", {
        entry_id: entryId,
        curve_name: curveName,
        points: points,
        set_active: setActive,
      });
      this._showMessage(`Courbe "${curveName}" enregistrée avec succès !`);
      this._editedPoints = null;
    } catch (err) {
      console.error(err);
      this._showMessage(`Erreur lors de la sauvegarde : ${err.message || err}`, true);
    }
  }

  async _activateCurve(entryId, curveName) {
    try {
      await this._hass.callService("curve_controller", "select_curve", {
        entry_id: entryId,
        curve_name: curveName,
      });
      this._showMessage(`Courbe "${curveName}" activée en production !`);
    } catch (err) {
      console.error(err);
      this._showMessage(`Erreur lors de l'activation : ${err.message || err}`, true);
    }
  }

  async _deleteCurve(entryId, curveName) {
    if (!confirm(`Confirmer la suppression définitive de la courbe "${curveName}" ?`)) return;
    try {
      await this._hass.callService("curve_controller", "delete_curve", {
        entry_id: entryId,
        curve_name: curveName,
      });
      this._selectedCurve = null;
      this._editedPoints = null;
      this._showMessage(`Courbe "${curveName}" supprimée.`);
    } catch (err) {
      console.error(err);
      this._showMessage(`Erreur : ${err.message || err}`, true);
    }
  }

  _render() {
    if (!this.shadowRoot) return;

    const entityState = this._getTargetEntity();
    if (!entityState) {
      this.shadowRoot.innerHTML = `
        <ha-card>
          <div class="card-content warning">
            <h3>Curve Controller</h3>
            <p>Aucune entité Curve Controller détectée ou configurée.</p>
            <small>Veuillez spécifier <code>entity: sensor.curve_controller_...</code> dans la configuration de la carte.</small>
          </div>
        </ha-card>
        ${this._getStyles()}
      `;
      return;
    }

    const attrs = entityState.attributes || {};
    const entryId = attrs.entry_id;
    const curves = attrs.curves || {};
    const activeCurve = attrs.active_curve || "";
    const sourceValue = typeof attrs.source_value === "number" ? attrs.source_value : null;
    const calculatedValue = typeof attrs.calculated_value === "number" ? attrs.calculated_value : null;
    const sourceEntityId = attrs.source_entity || "Source";
    const targetEntityId = attrs.target_entity || "Cible";

    const curveNames = Object.keys(curves);
    if (!this._selectedCurve || !curves[this._selectedCurve]) {
      this._selectedCurve = activeCurve && curves[activeCurve] ? activeCurve : curveNames[0] || "";
    }

    const currentPoints = this._editedPoints !== null
      ? this._editedPoints
      : (curves[this._selectedCurve] ? curves[this._selectedCurve].map(pt => [...pt]) : []);

    const isCurrentActive = (this._selectedCurve === activeCurve);
    const hasUnsavedChanges = this._editedPoints !== null;

    // SVG graph bounds calculation
    const allX = currentPoints.map(p => p[0]);
    const allY = currentPoints.map(p => p[1]);
    if (sourceValue !== null) allX.push(sourceValue);
    if (calculatedValue !== null) allY.push(calculatedValue);

    let minX = allX.length ? Math.min(...allX) : 0;
    let maxX = allX.length ? Math.max(...allX) : 20;
    let minY = allY.length ? Math.min(...allY) : 0;
    let maxY = allY.length ? Math.max(...allY) : 50;

    if (minX === maxX) { minX -= 5; maxX += 5; }
    if (minY === maxY) { minY -= 5; maxY += 5; }

    // Add 10% margins for aesthetic breathing room
    const paddingX = (maxX - minX) * 0.1 || 2;
    const paddingY = (maxY - minY) * 0.1 || 2;
    minX -= paddingX;
    maxX += paddingX;
    minY -= paddingY;
    maxY += paddingY;

    // SVG viewport metrics
    const svgWidth = 500;
    const svgHeight = 240;
    const margin = { top: 20, right: 30, bottom: 40, left: 50 };
    const plotW = svgWidth - margin.left - margin.right;
    const plotH = svgHeight - margin.top - margin.bottom;

    const toSvgX = (x) => margin.left + ((x - minX) / (maxX - minX)) * plotW;
    const toSvgY = (y) => margin.top + plotH - ((y - minY) / (maxY - minY)) * plotH;

    // Build SVG Path for sorted points
    const sorted = [...currentPoints].sort((a, b) => a[0] - b[0]);
    let pathD = "";
    let areaD = "";
    if (sorted.length > 0) {
      // Clamping left & right extensions in plot
      const firstPt = sorted[0];
      const lastPt = sorted[sorted.length - 1];

      const p0x = toSvgX(minX);
      const p0y = toSvgY(firstPt[1]);
      pathD = `M ${p0x} ${p0y} L ${toSvgX(firstPt[0])} ${toSvgY(firstPt[1])}`;

      sorted.forEach(pt => {
        pathD += ` L ${toSvgX(pt[0])} ${toSvgY(pt[1])}`;
      });

      const pEndx = toSvgX(maxX);
      const pEndy = toSvgY(lastPt[1]);
      pathD += ` L ${pEndx} ${pEndy}`;

      const bottomY = toSvgY(minY);
      areaD = `${pathD} L ${pEndx} ${bottomY} L ${p0x} ${bottomY} Z`;
    }

    // Dynamic marker coordinates
    let markerSvg = "";
    if (sourceValue !== null && sorted.length > 0) {
      const curY = this._interpolate(sorted, sourceValue);
      const mx = toSvgX(sourceValue);
      const my = toSvgY(curY);

      markerSvg = `
        <g class="current-marker">
          <!-- Crosshair guides -->
          <line x1="${mx}" y1="${toSvgY(minY)}" x2="${mx}" y2="${my}" stroke="var(--accent-color, #ff9800)" stroke-dasharray="4,4" stroke-width="1.5" opacity="0.8" />
          <line x1="${margin.left}" y1="${my}" x2="${mx}" y2="${my}" stroke="var(--accent-color, #ff9800)" stroke-dasharray="4,4" stroke-width="1.5" opacity="0.8" />
          
          <!-- Pulsing effect -->
          <circle cx="${mx}" cy="${my}" r="9" fill="var(--accent-color, #ff9800)" opacity="0.25">
            <animate attributeName="r" values="6;13;6" dur="2s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.4;0.05;0.4" dur="2s" repeatCount="indefinite" />
          </circle>
          <circle cx="${mx}" cy="${my}" r="5.5" fill="var(--accent-color, #ff9800)" stroke="#ffffff" stroke-width="2" />
        </g>
      `;
    }

    // Grid ticks
    const numTicks = 5;
    let gridLinesSvg = "";
    let labelsSvg = "";

    for (let i = 0; i <= numTicks; i++) {
      // Y ticks
      const valY = minY + (i / numTicks) * (maxY - minY);
      const sy = toSvgY(valY);
      gridLinesSvg += `<line x1="${margin.left}" y1="${sy}" x2="${svgWidth - margin.right}" y2="${sy}" stroke="var(--divider-color, rgba(125,125,125,0.2))" stroke-width="1" />`;
      labelsSvg += `<text x="${margin.left - 8}" y="${sy + 4}" text-anchor="end" class="axis-label">${valY.toFixed(1)}</text>`;

      // X ticks
      const valX = minX + (i / numTicks) * (maxX - minX);
      const sx = toSvgX(valX);
      gridLinesSvg += `<line x1="${sx}" y1="${margin.top}" x2="${sx}" y2="${margin.top + plotH}" stroke="var(--divider-color, rgba(125,125,125,0.2))" stroke-width="1" />`;
      labelsSvg += `<text x="${sx}" y="${margin.top + plotH + 18}" text-anchor="middle" class="axis-label">${valX.toFixed(1)}</text>`;
    }

    // SVG Points circles
    const circlesSvg = sorted.map((pt, idx) => {
      const cx = toSvgX(pt[0]);
      const cy = toSvgY(pt[1]);
      return `
        <circle cx="${cx}" cy="${cy}" r="5" class="point-circle" data-idx="${idx}">
          <title>Point ${idx + 1}: X=${pt[0]}, Y=${pt[1]}</title>
        </circle>
      `;
    }).join("");

    // Points table rows
    const tableRows = currentPoints.map((pt, idx) => `
      <tr>
        <td class="idx-col">#${idx + 1}</td>
        <td>
          <input type="number" step="any" class="pt-input" data-idx="${idx}" data-field="0" value="${pt[0]}" />
        </td>
        <td>
          <input type="number" step="any" class="pt-input" data-idx="${idx}" data-field="1" value="${pt[1]}" />
        </td>
        <td class="action-col">
          <button class="btn-icon delete-btn" data-idx="${idx}" title="Supprimer ce point">✕</button>
        </td>
      </tr>
    `).join("");

    this.shadowRoot.innerHTML = `
      <ha-card>
        <div class="card-header">
          <div class="header-title">
            <ha-icon icon="mdi:chart-bell-curve-cumulative" class="header-icon"></ha-icon>
            <span>${this._config.title}</span>
          </div>
          <div class="header-status">
            ${isCurrentActive
              ? '<span class="badge active-badge"><ha-icon icon="mdi:check-circle"></ha-icon> ACTIVE</span>'
              : `<button class="btn btn-outline activate-btn">Définir active</button>`}
          </div>
        </div>

        <div class="card-content">
          ${this._statusMessage}

          <!-- Live stats bar -->
          <div class="stats-bar">
            <div class="stat-item">
              <span class="stat-label">Entrée (${sourceEntityId})</span>
              <span class="stat-val primary">${sourceValue !== null ? sourceValue + "°" : "N/A"}</span>
            </div>
            <div class="stat-arrow">➔</div>
            <div class="stat-item">
              <span class="stat-label">Consigne Cible (${targetEntityId})</span>
              <span class="stat-val highlight">${calculatedValue !== null ? calculatedValue : "N/A"}</span>
            </div>
          </div>

          <!-- Curve selector and actions -->
          <div class="toolbar">
            <div class="curve-select-wrapper">
              <label for="curve-select">Profil de Courbe :</label>
              <select id="curve-select" class="dropdown">
                ${curveNames.map(c => `
                  <option value="${c}" ${c === this._selectedCurve ? "selected" : ""}>
                    ${c} ${c === activeCurve ? "★ (Active)" : ""}
                  </option>
                `).join("")}
              </select>
            </div>
            <div class="toolbar-actions">
              <button class="btn btn-sm" id="btn-new-curve">+ Nouveau</button>
              ${curveNames.length > 1 ? `<button class="btn btn-sm btn-danger" id="btn-del-curve">Supprimer</button>` : ""}
            </div>
          </div>

          <!-- SVG Visual Chart -->
          <div class="chart-container">
            <svg viewBox="0 0 ${svgWidth} ${svgHeight}" class="curve-svg">
              <defs>
                <linearGradient id="areaGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stop-color="var(--primary-color, #03a9f4)" stop-opacity="0.35"/>
                  <stop offset="100%" stop-color="var(--primary-color, #03a9f4)" stop-opacity="0.02"/>
                </linearGradient>
              </defs>
              
              <!-- Axes & Grid -->
              ${gridLinesSvg}
              
              <!-- Shaded curve area -->
              ${areaD ? `<path d="${areaD}" fill="url(#areaGrad)"/>` : ""}
              
              <!-- Curve stroke -->
              ${pathD ? `<path d="${pathD}" class="curve-line"/>` : ""}
              
              <!-- Configured Points -->
              ${circlesSvg}
              
              <!-- Dynamic live position marker -->
              ${markerSvg}
              
              <!-- Axis labels -->
              ${labelsSvg}

              <!-- Axis title legends -->
              <text x="${svgWidth - margin.right}" y="${margin.top + plotH - 8}" text-anchor="end" class="axis-legend">X (Entrée)</text>
              <text x="${margin.left + 8}" y="${margin.top + 14}" text-anchor="start" class="axis-legend">Y (Cible)</text>
            </svg>
          </div>

          <!-- Points Editor Accordion / Table -->
          <div class="editor-section">
            <div class="editor-header">
              <span class="editor-title">Points de la courbe (${currentPoints.length} points)</span>
              ${hasUnsavedChanges ? `<span class="unsaved-badge">Modifications non enregistrées</span>` : ""}
            </div>

            <div class="table-container">
              <table class="points-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>X (Entrée)</th>
                    <th>Y (Consigne)</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  ${tableRows}
                </tbody>
              </table>
            </div>

            <div class="editor-actions">
              <button class="btn btn-secondary" id="btn-add-point">+ Ajouter un point</button>
              <div class="right-actions">
                ${hasUnsavedChanges ? `<button class="btn btn-outline" id="btn-reset">Annuler</button>` : ""}
                <button class="btn btn-primary" id="btn-save">💾 Sauvegarder</button>
              </div>
            </div>
          </div>
        </div>
      </ha-card>
      ${this._getStyles()}
    `;

    this._attachEventListeners(entryId, activeCurve, currentPoints);
  }

  _attachEventListeners(entryId, activeCurve, currentPoints) {
    const root = this.shadowRoot;

    // Curve selector change
    const selectElem = root.getElementById("curve-select");
    if (selectElem) {
      selectElem.addEventListener("change", (e) => {
        this._selectedCurve = e.target.value;
        this._editedPoints = null;
        this._render();
      });
    }

    // Activate curve button
    const activateBtn = root.querySelector(".activate-btn");
    if (activateBtn) {
      activateBtn.addEventListener("click", () => {
        this._activateCurve(entryId, this._selectedCurve);
      });
    }

    // New curve button
    const newCurveBtn = root.getElementById("btn-new-curve");
    if (newCurveBtn) {
      newCurveBtn.addEventListener("click", () => {
        const name = prompt("Nom de la nouvelle courbe (ex. Nuit, Absent, Confort) :");
        if (name && name.trim()) {
          const trimmed = name.trim();
          // Duplicate current points or default standard curve
          const initialPts = currentPoints.length ? [...currentPoints] : [[0, 20], [10, 25]];
          this._saveCurrentCurve(entryId, trimmed, initialPts, false);
          this._selectedCurve = trimmed;
        }
      });
    }

    // Delete curve button
    const delCurveBtn = root.getElementById("btn-del-curve");
    if (delCurveBtn) {
      delCurveBtn.addEventListener("click", () => {
        this._deleteCurve(entryId, this._selectedCurve);
      });
    }

    // Input points change
    root.querySelectorAll(".pt-input").forEach((inp) => {
      inp.addEventListener("input", (e) => {
        const idx = parseInt(e.target.dataset.idx, 10);
        const field = parseInt(e.target.dataset.field, 10);
        const val = parseFloat(e.target.value);
        if (!isNaN(val)) {
          if (!this._editedPoints) {
            this._editedPoints = currentPoints.map(p => [...p]);
          }
          this._editedPoints[idx][field] = val;
          // Soft update without re-rendering input elements on every keypress
          this._updateSvgOnly();
        }
      });
      inp.addEventListener("change", () => {
        this._render();
      });
    });

    // Delete point button
    root.querySelectorAll(".delete-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const idx = parseInt(e.target.dataset.idx, 10);
        if (currentPoints.length <= 2) {
          alert("Une courbe doit contenir au minimum 2 points.");
          return;
        }
        if (!this._editedPoints) {
          this._editedPoints = currentPoints.map(p => [...p]);
        }
        this._editedPoints.splice(idx, 1);
        this._render();
      });
    });

    // Add point button
    const addPtBtn = root.getElementById("btn-add-point");
    if (addPtBtn) {
      addPtBtn.addEventListener("click", () => {
        if (!this._editedPoints) {
          this._editedPoints = currentPoints.map(p => [...p]);
        }
        // Suggest point halfway between last two points or last + 5
        let newX = 20;
        let newY = 20;
        if (this._editedPoints.length > 0) {
          const last = this._editedPoints[this._editedPoints.length - 1];
          newX = last[0] + 5;
          newY = last[1];
        }
        this._editedPoints.push([newX, newY]);
        this._render();
      });
    }

    // Reset button
    const resetBtn = root.getElementById("btn-reset");
    if (resetBtn) {
      resetBtn.addEventListener("click", () => {
        this._editedPoints = null;
        this._render();
      });
    }

    // Save button
    const saveBtn = root.getElementById("btn-save");
    if (saveBtn) {
      saveBtn.addEventListener("click", () => {
        const pts = this._editedPoints || currentPoints;
        this._saveCurrentCurve(entryId, this._selectedCurve, pts, this._selectedCurve === activeCurve);
      });
    }
  }

  _updateSvgOnly() {
    // Quick re-render to update the chart in real time while typing
    const root = this.shadowRoot;
    const saveBtn = root.getElementById("btn-save");
    if (saveBtn) saveBtn.classList.add("pulse");
  }

  _getStyles() {
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
          padding: 16px 20px 12px;
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
          color: var(--primary-color, #03a9f4);
        }
        .card-content {
          padding: 16px 20px;
        }
        .status-msg {
          padding: 8px 12px;
          margin-bottom: 12px;
          border-radius: 6px;
          font-size: 0.9rem;
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
        .stats-bar {
          display: flex;
          align-items: center;
          justify-content: space-around;
          background: var(--secondary-background-color, rgba(0,0,0,0.03));
          padding: 12px;
          border-radius: 8px;
          margin-bottom: 14px;
        }
        .stat-item {
          display: flex;
          flex-direction: column;
          align-items: center;
        }
        .stat-label {
          font-size: 0.75rem;
          color: var(--secondary-text-color, #757575);
          margin-bottom: 2px;
        }
        .stat-val {
          font-size: 1.25rem;
          font-weight: 700;
        }
        .stat-val.primary {
          color: var(--primary-color, #03a9f4);
        }
        .stat-val.highlight {
          color: var(--accent-color, #ff9800);
        }
        .stat-arrow {
          font-size: 1.2rem;
          color: var(--secondary-text-color, #9e9e9e);
        }
        .toolbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          flex-wrap: wrap;
          gap: 10px;
          margin-bottom: 14px;
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
          padding: 4px 8px;
          font-size: 0.8rem;
          background: var(--secondary-background-color, rgba(0,0,0,0.05));
          color: var(--primary-text-color);
        }
        .btn-sm:hover {
          background: rgba(0,0,0,0.1);
        }
        .btn-primary {
          background: var(--primary-color, #03a9f4);
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
          border: 1px solid var(--primary-color, #03a9f4);
          color: var(--primary-color, #03a9f4);
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
          padding: 4px 8px;
          border-radius: 12px;
          font-size: 0.75rem;
          font-weight: 700;
          letter-spacing: 0.5px;
        }
        .active-badge {
          background: rgba(76, 175, 80, 0.2);
          color: #2e7d32;
        }
        .unsaved-badge {
          font-size: 0.75rem;
          color: #ff9800;
          font-weight: 600;
        }
        .chart-container {
          width: 100%;
          background: var(--secondary-background-color, rgba(0,0,0,0.02));
          border-radius: 8px;
          padding: 8px;
          margin-bottom: 16px;
        }
        .curve-svg {
          width: 100%;
          height: auto;
          overflow: visible;
        }
        .curve-line {
          fill: none;
          stroke: var(--primary-color, #03a9f4);
          stroke-width: 3;
          stroke-linecap: round;
          stroke-linejoin: round;
        }
        .point-circle {
          fill: #fff;
          stroke: var(--primary-color, #03a9f4);
          stroke-width: 2.5;
          cursor: pointer;
          transition: r 0.2s;
        }
        .point-circle:hover {
          r: 7;
          fill: var(--primary-color, #03a9f4);
        }
        .axis-label {
          font-size: 10px;
          fill: var(--secondary-text-color, #757575);
        }
        .axis-legend {
          font-size: 10px;
          fill: var(--secondary-text-color, #757575);
          font-weight: 600;
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
          width: 40px;
          color: var(--secondary-text-color);
        }
        .action-col {
          width: 40px;
          text-align: center;
        }
        .pt-input {
          width: 90%;
          padding: 4px 6px;
          border: 1px solid var(--divider-color, #ccc);
          border-radius: 4px;
          background: var(--input-fill-color, var(--card-background-color, #fff));
          color: var(--primary-text-color);
          font-size: 0.85rem;
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
          from { opacity: 0; transform: translateY(-4px); }
          to { opacity: 1; transform: translateY(0); }
        }
      </style>
    `;
  }
}

// Register custom card to Home Assistant Custom Elements
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
    `%c CURVE-CONTROLLER-CARD %c Version 1.0.0 `,
    "color: white; background: #03a9f4; font-weight: 700; border-radius: 3px 0 0 3px;",
    "color: #03a9f4; background: #e1f5fe; font-weight: 700; border-radius: 0 3px 3px 0;"
  );
}

