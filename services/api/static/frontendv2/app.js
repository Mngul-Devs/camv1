(function () {
  const toggleState = JSON.parse(localStorage.getItem("frontendv2_client_toggles") || "{}");

  const el = {
    clock: document.getElementById("clock"),
    refresh: document.getElementById("refresh-all"),
    kpiClients: document.getElementById("kpi-clients"),
    kpiActiveClients: document.getElementById("kpi-active-clients"),
    kpiCars: document.getElementById("kpi-cars"),
    kpiBandwidth: document.getElementById("kpi-bandwidth"),
    kpiCameras: document.getElementById("kpi-cameras"),
    kpiCameraHealth: document.getElementById("kpi-camera-health"),
    clientTable: document.getElementById("client-table"),
    eventFeed: document.getElementById("event-feed"),
    payloadPreview: document.getElementById("payload-preview"),
    apiKeyOut: document.getElementById("api-key-output"),
    clientSelect: document.getElementById("snap-client"),
    snapFrom: document.getElementById("snap-from"),
    snapTo: document.getElementById("snap-to"),
    snapCamera: document.getElementById("snap-camera"),
    snapSearch: document.getElementById("snap-search"),
    snapGrid: document.getElementById("snapshot-grid"),
    snapMeta: document.getElementById("snap-meta"),
    form: {
      clientName: document.getElementById("f-client-name"),
      endpoint: document.getElementById("f-endpoint"),
      authType: document.getElementById("f-auth-type"),
      authValue: document.getElementById("f-auth-value"),
      timeout: document.getElementById("f-timeout"),
      retry: document.getElementById("f-retry"),
      enabled: document.getElementById("f-enabled"),
      snapshot: document.getElementById("f-snapshot-url"),
      mapping: document.getElementById("f-mapping"),
      btnGenerateKey: document.getElementById("btn-generate-key"),
      btnPreview: document.getElementById("btn-preview"),
      btnSave: document.getElementById("btn-save-config"),
    },
  };

  function fmtNum(v) {
    return (v || 0).toLocaleString();
  }

  function fmtDate(iso) {
    if (!iso) return "-";
    const d = new Date(iso);
    return `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
  }

  function bytesToHuman(bytes) {
    if (!bytes || bytes <= 0) return "0 MB";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let i = 0;
    let n = bytes;
    while (n >= 1024 && i < units.length - 1) {
      n /= 1024;
      i += 1;
    }
    return `${n.toFixed(i < 2 ? 0 : 1)} ${units[i]}`;
  }

  function ensureIso(localValue) {
    if (!localValue) return "";
    return new Date(localValue).toISOString();
  }

  function nowClock() {
    const d = new Date();
    el.clock.textContent = `${d.toISOString().replace("T", " ").slice(0, 19)} UTC`;
  }

  function setDefaultTimeRange() {
    const now = new Date();
    const from = new Date(now.getTime() - 60 * 60 * 1000);
    el.snapTo.value = toInputDateTime(now);
    el.snapFrom.value = toInputDateTime(from);
  }

  function toInputDateTime(d) {
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  async function fetchJSON(url, options) {
    const resp = await fetch(url, options);
    if (!resp.ok) {
      throw new Error(`${resp.status} ${resp.statusText}`);
    }
    return resp.json();
  }

  function getPushState(clientId, fallback) {
    if (toggleState[clientId] === undefined) return fallback;
    return !!toggleState[clientId];
  }

  function setPushState(clientId, enabled) {
    toggleState[clientId] = enabled;
    localStorage.setItem("frontendv2_client_toggles", JSON.stringify(toggleState));
  }

  function renderPayloadPreview() {
    const mapping = parseMapping();
    const payload = {
      schema_version: "v1",
      event_id: "evt_20260222_0001",
      timestamp_utc: new Date().toISOString(),
      client_id: el.form.clientName.value || "client_example",
      project_id: mapping.project_id || "project_main",
      camera_id: mapping.camera_id || "CAM001",
      event_type: "VEHICLE_DETECTED",
      detections: [
        {
          class: "car",
          confidence: 0.92,
          bbox: [128, 220, 532, 590],
          count: 1,
        },
      ],
      metrics: {
        bandwidth_bytes: 256000,
        cpu_percent: 0,
        ram_mb: 0,
        latency_ms: 52,
      },
      media_ref: {
        snapshot_url: el.form.snapshot.checked ? "/admin/snapshots/123/image" : null,
      },
      trace: {
        pipeline_version: "phase3",
        model_version: "yolo-v8",
        source_node: "worker-01",
      },
      config: {
        endpoint: el.form.endpoint.value || "",
        auth_type: el.form.authType.value,
        timeout_sec: Number(el.form.timeout.value) || 15,
        retry_count: Number(el.form.retry.value) || 3,
        enabled: !!el.form.enabled.checked,
      },
    };
    el.payloadPreview.textContent = JSON.stringify(payload, null, 2);
  }

  function parseMapping() {
    try {
      return JSON.parse(el.form.mapping.value || "{}");
    } catch (err) {
      return {};
    }
  }

  function renderClients(clients) {
    if (!clients.length) {
      el.clientTable.innerHTML = '<tr><td colspan="8" class="muted-row">No clients yet. Use API Builder to generate a key.</td></tr>';
      return;
    }

    let totalCars = 0;
    let totalBandwidth = 0;
    let totalCameras = 0;
    let online = 0;
    let stale = 0;
    let offline = 0;

    el.clientTable.innerHTML = clients.map((client) => {
      const enabled = getPushState(client.id, client.enabled);
      totalCars += client.cars_detected_24h || 0;
      totalBandwidth += client.bandwidth_bytes_24h || 0;
      totalCameras += client.camera_totals.total || 0;
      online += client.camera_totals.online || 0;
      stale += client.camera_totals.stale || 0;
      offline += client.camera_totals.offline || 0;

      const cpu = client.cpu_percent == null ? "n/a" : `${client.cpu_percent.toFixed(1)}%`;
      const ram = client.ram_mb == null ? "n/a" : `${Math.round(client.ram_mb)} MB`;

      return `
        <tr>
          <td>
            <strong>${escapeHtml(client.name)}</strong><br>
            <span class="minor">last call: ${fmtDate(client.last_call_at || client.last_used_at)}</span>
          </td>
          <td>${(client.sites || []).map(escapeHtml).join(", ") || "-"}</td>
          <td>${fmtNum(client.cars_detected_24h)}</td>
          <td>${bytesToHuman(client.bandwidth_bytes_24h)}</td>
          <td>${cpu} / ${ram}</td>
          <td>${fmtNum(client.activity_1h)}</td>
          <td>${client.camera_totals.total} (${client.camera_totals.online}/${client.camera_totals.stale}/${client.camera_totals.offline})</td>
          <td>
            <button class="btn ${enabled ? "primary" : "danger"} btn-toggle" data-client="${client.id}" data-enabled="${enabled ? "1" : "0"}">
              ${enabled ? "ON" : "OFF"}
            </button>
          </td>
        </tr>
      `;
    }).join("");

    const active = clients.filter((x) => (x.calls_today || 0) > 0).length;
    el.kpiClients.textContent = fmtNum(clients.length);
    el.kpiActiveClients.textContent = `${fmtNum(active)} active today`;
    el.kpiCars.textContent = fmtNum(totalCars);
    el.kpiBandwidth.textContent = bytesToHuman(totalBandwidth);
    el.kpiCameras.textContent = fmtNum(totalCameras);
    el.kpiCameraHealth.textContent = `${online} online / ${stale} stale / ${offline} offline`;

    attachToggleHandlers();
  }

  function attachToggleHandlers() {
    document.querySelectorAll(".btn-toggle").forEach((btn) => {
      btn.addEventListener("click", function () {
        const id = this.getAttribute("data-client");
        const enabled = this.getAttribute("data-enabled") === "1";
        setPushState(id, !enabled);
        loadClients();
      });
    });
  }

  function renderEvents(data) {
    const events = data.events || [];
    if (!events.length) {
      el.eventFeed.innerHTML = '<p class="muted-row">No events available.</p>';
      return;
    }

    el.eventFeed.innerHTML = events.map((evt) => `
      <article class="feed-item">
        <div class="meta">${fmtDate(evt.triggered_at)} | ${escapeHtml(evt.camera_id || "-")} / ${escapeHtml(evt.zone_id || "-")}</div>
        <div><strong>${escapeHtml(evt.event_type || "EVENT")}</strong></div>
        <div>${escapeHtml(evt.old_state || "-")} -> ${escapeHtml(evt.new_state || "-")}</div>
      </article>
    `).join("");
  }

  function updateClientSelect(clients) {
    const opts = ['<option value="">All Clients</option>'].concat(
      clients.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`)
    );
    el.clientSelect.innerHTML = opts.join("");
  }

  async function loadClients() {
    try {
      const data = await fetchJSON("/admin/frontendv2/clients.json");
      const clients = data.clients || [];
      renderClients(clients);
      updateClientSelect(clients);
    } catch (err) {
      el.clientTable.innerHTML = `<tr><td colspan="8" class="muted-row">Failed to load clients: ${escapeHtml(err.message)}</td></tr>`;
    }
  }

  async function loadEvents() {
    try {
      const data = await fetchJSON("/admin/events.json?limit=12");
      renderEvents(data);
    } catch (err) {
      el.eventFeed.innerHTML = `<p class="muted-row">Failed to load events: ${escapeHtml(err.message)}</p>`;
    }
  }

  async function searchSnapshots() {
    const from = ensureIso(el.snapFrom.value);
    const to = ensureIso(el.snapTo.value);
    if (!from || !to) {
      el.snapMeta.textContent = "Please set both From and To timestamps.";
      return;
    }

    const params = new URLSearchParams({ from, to, limit: "150" });
    if (el.snapCamera.value.trim()) params.set("camera_id", el.snapCamera.value.trim());
    if (el.clientSelect.value) params.set("client_id", el.clientSelect.value);

    el.snapMeta.textContent = "Searching snapshots...";
    try {
      const data = await fetchJSON(`/admin/frontendv2/snapshots/search.json?${params.toString()}`);
      const rows = data.snapshots || [];
      el.snapMeta.textContent = `Found ${rows.length} snapshots between ${fmtDate(data.from)} and ${fmtDate(data.to)}.`;
      if (!rows.length) {
        el.snapGrid.innerHTML = '<p class="muted-row">No snapshots in the selected time range.</p>';
        return;
      }
      el.snapGrid.innerHTML = rows.map((r) => `
        <article class="shot-card">
          <a href="${r.image_url}" target="_blank" rel="noreferrer">
            <img src="${r.image_url}" alt="${escapeHtml(r.camera_id)} snapshot">
          </a>
          <div class="shot-meta">
            <span class="stamp">${fmtDate(r.received_at)}</span>
            <span>${escapeHtml(r.camera_id)} (${escapeHtml(r.camera_name || "-")})</span>
            <span class="minor">Detections: ${fmtNum(r.detections_count)} | YOLO vehicles: ${fmtNum(r.yolo_vehicle_objects)}</span>
          </div>
        </article>
      `).join("");
    } catch (err) {
      el.snapMeta.textContent = `Search failed: ${err.message}`;
      el.snapGrid.innerHTML = '<p class="muted-row">Unable to load snapshot search result.</p>';
    }
  }

  async function generateApiKey() {
    const name = el.form.clientName.value.trim();
    if (!name) {
      el.apiKeyOut.classList.remove("hidden");
      el.apiKeyOut.textContent = "Client Name is required before generating API key.";
      return;
    }

    try {
      const data = await fetchJSON("/admin/api-keys/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          rate_limit_per_minute: 60,
        }),
      });
      el.apiKeyOut.classList.remove("hidden");
      el.apiKeyOut.textContent = `API key generated for ${name}: ${data.api_key}`;
      loadClients();
    } catch (err) {
      el.apiKeyOut.classList.remove("hidden");
      el.apiKeyOut.textContent = `Failed to generate API key: ${err.message}`;
    }
  }

  function saveDraftConfig() {
    const draft = {
      client_name: el.form.clientName.value.trim(),
      endpoint: el.form.endpoint.value.trim(),
      auth_type: el.form.authType.value,
      auth_value: el.form.authValue.value.trim(),
      timeout_sec: Number(el.form.timeout.value) || 15,
      retry_count: Number(el.form.retry.value) || 3,
      enabled: !!el.form.enabled.checked,
      include_snapshot_url: !!el.form.snapshot.checked,
      mapping: parseMapping(),
      saved_at: new Date().toISOString(),
    };
    localStorage.setItem("frontendv2_api_draft", JSON.stringify(draft));
    el.apiKeyOut.classList.remove("hidden");
    el.apiKeyOut.textContent = "Integration draft saved locally (design mode).";
    renderPayloadPreview();
  }

  function restoreDraft() {
    const raw = localStorage.getItem("frontendv2_api_draft");
    if (!raw) {
      el.form.mapping.value = JSON.stringify(
        {
          project_id: "project_main",
          camera_id: "camera_id",
          event_type: "event_type",
          detections: "detections",
          metrics: "metrics",
          trace: "trace",
        },
        null,
        2
      );
      renderPayloadPreview();
      return;
    }
    try {
      const d = JSON.parse(raw);
      el.form.clientName.value = d.client_name || "";
      el.form.endpoint.value = d.endpoint || "";
      el.form.authType.value = d.auth_type || "none";
      el.form.authValue.value = d.auth_value || "";
      el.form.timeout.value = d.timeout_sec || 15;
      el.form.retry.value = d.retry_count || 3;
      el.form.enabled.checked = !!d.enabled;
      el.form.snapshot.checked = !!d.include_snapshot_url;
      el.form.mapping.value = JSON.stringify(d.mapping || {}, null, 2);
    } catch (err) {
      el.form.mapping.value = "{}";
    }
    renderPayloadPreview();
  }

  function escapeHtml(text) {
    return String(text || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  async function refreshAll() {
    await Promise.all([loadClients(), loadEvents()]);
    renderPayloadPreview();
  }

  function bind() {
    el.refresh.addEventListener("click", refreshAll);
    el.snapSearch.addEventListener("click", searchSnapshots);
    el.form.btnGenerateKey.addEventListener("click", generateApiKey);
    el.form.btnPreview.addEventListener("click", renderPayloadPreview);
    el.form.btnSave.addEventListener("click", saveDraftConfig);
    [
      el.form.clientName,
      el.form.endpoint,
      el.form.authType,
      el.form.authValue,
      el.form.timeout,
      el.form.retry,
      el.form.enabled,
      el.form.snapshot,
      el.form.mapping,
    ].forEach((node) => node.addEventListener("input", renderPayloadPreview));
  }

  function init() {
    nowClock();
    setInterval(nowClock, 1000);
    setDefaultTimeRange();
    restoreDraft();
    bind();
    refreshAll();
  }

  init();
})();
