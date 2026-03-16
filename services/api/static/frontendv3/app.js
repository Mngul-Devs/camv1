(function () {
  const el = {
    refresh: document.getElementById("refresh"),
    updatedAt: document.getElementById("updated-at"),
    projectTable: document.getElementById("project-table"),
    projectForm: document.getElementById("project-form"),
    projectName: document.getElementById("project-name"),
    siteName: document.getElementById("site-name"),
    clientName: document.getElementById("client-name"),
    rateLimit: document.getElementById("rate-limit"),
    createClient: document.getElementById("create-client"),
    projectOutput: document.getElementById("project-output"),
    cameraForm: document.getElementById("camera-form"),
    cameraSiteId: document.getElementById("camera-site-id"),
    cameraId: document.getElementById("camera-id"),
    cameraName: document.getElementById("camera-name"),
    ftpUsername: document.getElementById("ftp-username"),
    ftpPassword: document.getElementById("ftp-password"),
    cameraOutput: document.getElementById("camera-output"),
    kpiTotal: document.getElementById("kpi-total"),
    kpiHealthy: document.getElementById("kpi-healthy"),
    kpiFailed: document.getElementById("kpi-failed"),
    kpiClients: document.getElementById("kpi-clients"),
    healthApi: document.getElementById("health-api"),
    healthDb: document.getElementById("health-db"),
    endpointTable: document.getElementById("endpoint-table"),
    clientEndpointTable: document.getElementById("client-endpoint-table"),
    flowList: document.getElementById("flow-list"),
    logTable: document.getElementById("log-table"),
  };

  function fmtNum(v) {
    return Number(v || 0).toLocaleString();
  }

  function fmtPct(v) {
    const n = Number(v || 0);
    return `${n.toFixed(2)}%`;
  }

  function fmtDate(iso) {
    if (!iso) return "-";
    const d = new Date(iso);
    return `${d.toISOString().replace("T", " ").slice(0, 19)}Z`;
  }

  function escapeHtml(text) {
    return String(text || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  async function fetchJSON(url) {
    const resp = await fetch(url);
    if (!resp.ok) {
      throw new Error(`${resp.status} ${resp.statusText}`);
    }
    return resp.json();
  }

  async function postJSON(url, payload) {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      throw new Error(data.error || `${resp.status} ${resp.statusText}`);
    }
    return data;
  }

  function setHealthPill(node, label, status) {
    const ok = status === "up";
    node.className = `pill ${ok ? "ok" : "bad"}`;
    node.textContent = `${label}: ${status}`;
  }

  function renderEndpoints(rows) {
    if (!rows.length) {
      el.endpointTable.innerHTML = '<tr><td colspan="7" class="muted">No endpoint traffic in the selected window.</td></tr>';
      return;
    }
    el.endpointTable.innerHTML = rows.map((row) => `
      <tr>
        <td>${escapeHtml(row.method)}</td>
        <td class="mono">${escapeHtml(row.endpoint)}</td>
        <td>${fmtNum(row.total)}</td>
        <td>${fmtPct(row.status_200_rate_pct)}</td>
        <td>${fmtNum(row.failed)}</td>
        <td>${row.avg_response_time_ms == null ? "-" : `${row.avg_response_time_ms} ms`}</td>
        <td>${fmtDate(row.last_seen_at)}</td>
      </tr>
    `).join("");
  }

  function renderClientEndpoints(rows) {
    if (!rows.length) {
      el.clientEndpointTable.innerHTML = '<tr><td colspan="8" class="muted">No client endpoint traffic in the selected window.</td></tr>';
      return;
    }
    el.clientEndpointTable.innerHTML = rows.map((row) => `
      <tr>
        <td>${escapeHtml(row.client_name)}</td>
        <td>${escapeHtml(row.method)}</td>
        <td class="mono">${escapeHtml(row.endpoint)}</td>
        <td>${fmtNum(row.total)}</td>
        <td>${fmtPct(row.success_rate_pct)}</td>
        <td>${fmtNum(row.failed)}</td>
        <td>${row.calls_per_minute}</td>
        <td>${fmtPct(row.rateflow_pct)}</td>
      </tr>
    `).join("");
  }

  function renderFlow(rows) {
    if (!rows.length) {
      el.flowList.innerHTML = '<p class="muted">No flow data in the last hour.</p>';
      return;
    }
    const max = Math.max(1, ...rows.map((r) => r.requests || 0));
    const tail = rows.slice(-20).reverse();
    el.flowList.innerHTML = tail.map((row) => {
      const pct = Math.max(3, Math.round(((row.requests || 0) / max) * 100));
      return `
        <div class="flow-item">
          <div class="flow-meta">
            <span>${fmtDate(row.minute)}</span>
            <span>${fmtNum(row.requests)} rpm</span>
          </div>
          <div class="flow-bar"><span style="width:${pct}%"></span></div>
        </div>
      `;
    }).join("");
  }

  function renderLogs(rows) {
    if (!rows.length) {
      el.logTable.innerHTML = '<tr><td colspan="7" class="muted">No logs in the selected window.</td></tr>';
      return;
    }
    el.logTable.innerHTML = rows.slice(0, 120).map((row) => {
      const code = Number(row.status_code || 0);
      let cls = "";
      if (code >= 200 && code < 300) cls = "status-2xx";
      if (code >= 400 && code < 500) cls = "status-4xx";
      if (code >= 500) cls = "status-5xx";
      return `
        <tr>
          <td class="mono">${fmtDate(row.at)}</td>
          <td>${escapeHtml(row.client_name)}</td>
          <td>${escapeHtml(row.method)}</td>
          <td class="mono">${escapeHtml(row.endpoint)}</td>
          <td class="${cls}">${fmtNum(row.status_code)}</td>
          <td>${row.response_time_ms == null ? "-" : `${row.response_time_ms} ms`}</td>
          <td>${fmtNum(row.tokens_used)}</td>
        </tr>
      `;
    }).join("");
  }

  function renderProjects(rows) {
    if (!rows.length) {
      el.projectTable.innerHTML = '<tr><td colspan="5" class="muted">No projects available.</td></tr>';
      return;
    }
    el.projectTable.innerHTML = rows.map((p) => `
      <tr>
        <td><strong>${escapeHtml(p.name)}</strong><br><span class="mono">#${p.id}</span></td>
        <td>${fmtNum((p.sites || []).length)}</td>
        <td>${fmtNum((p.clients || []).length)}</td>
        <td>${fmtNum(p.camera_count)}</td>
        <td>${fmtNum(p.zone_count)}</td>
      </tr>
    `).join("");
  }

  async function loadProjects() {
    try {
      const data = await fetchJSON("/admin/projects.json");
      renderProjects(data.projects || []);
    } catch (err) {
      el.projectTable.innerHTML = `<tr><td colspan="5" class="muted">Error: ${escapeHtml(err.message)}</td></tr>`;
    }
  }

  function render(data) {
    const kpi = data.kpis || {};
    el.kpiTotal.textContent = fmtNum(kpi.total_requests_24h);
    el.kpiHealthy.textContent = fmtPct(kpi.status_200_rate_pct);
    el.kpiFailed.textContent = fmtNum(kpi.failed_requests_24h);
    el.kpiClients.textContent = fmtNum(kpi.active_clients_24h);

    setHealthPill(el.healthApi, "API", (data.health || {}).api_status || "down");
    setHealthPill(el.healthDb, "DB", (data.health || {}).db_status || "down");

    renderEndpoints(data.endpoints || []);
    renderClientEndpoints(data.client_endpoints || []);
    renderFlow(data.flow_last_hour || []);
    renderLogs(data.recent_logs || []);
    el.updatedAt.textContent = `Updated: ${fmtDate(new Date().toISOString())}`;
  }

  async function load() {
    try {
      const data = await fetchJSON("/admin/frontendv3/observability.json");
      render(data);
    } catch (err) {
      el.updatedAt.textContent = `Failed: ${err.message}`;
      el.endpointTable.innerHTML = `<tr><td colspan="7" class="muted">Error: ${escapeHtml(err.message)}</td></tr>`;
      el.clientEndpointTable.innerHTML = `<tr><td colspan="8" class="muted">Error: ${escapeHtml(err.message)}</td></tr>`;
      el.logTable.innerHTML = `<tr><td colspan="7" class="muted">Error: ${escapeHtml(err.message)}</td></tr>`;
      el.flowList.innerHTML = `<p class="muted">Error: ${escapeHtml(err.message)}</p>`;
    }
  }

  async function createProject(evt) {
    evt.preventDefault();
    try {
      const data = await postJSON("/admin/projects", {
        project_name: el.projectName.value.trim(),
        site_name: el.siteName.value.trim(),
        create_client: !!el.createClient.checked,
        client_name: el.clientName.value.trim(),
        rate_limit_per_minute: Number(el.rateLimit.value) || 60,
      });
      const project = data.project || {};
      const site = data.site || {};
      const client = data.client || null;
      const key = client ? client.api_key : null;
      el.projectOutput.classList.remove("muted");
      el.projectOutput.textContent = client
        ? `Created project ${project.name} (#${project.id}), site ${site.name} (#${site.id}), client ${client.name}. API key: ${key}`
        : `Created project ${project.name} (#${project.id}) and site ${site.name} (#${site.id}).`;
      await loadProjects();
    } catch (err) {
      el.projectOutput.classList.remove("muted");
      el.projectOutput.textContent = `Create project failed: ${err.message}`;
    }
  }

  async function createCamera(evt) {
    evt.preventDefault();
    try {
      const data = await postJSON("/admin/cameras", {
        site_id: Number(el.cameraSiteId.value),
        camera_id: el.cameraId.value.trim(),
        name: el.cameraName.value.trim(),
        ingest_protocol: "ftp",
        ftp_username: el.ftpUsername.value.trim(),
        ftp_password: el.ftpPassword.value.trim(),
      });
      el.cameraOutput.classList.remove("muted");
      el.cameraOutput.textContent = `Created camera ${data.camera_id} for site ${el.cameraSiteId.value}. Ingest path: ${data.ingest_path}`;
      await loadProjects();
    } catch (err) {
      el.cameraOutput.classList.remove("muted");
      el.cameraOutput.textContent = `Create camera failed: ${err.message}`;
    }
  }

  el.refresh.addEventListener("click", async function () {
    await Promise.all([load(), loadProjects()]);
  });
  el.projectForm.addEventListener("submit", createProject);
  el.cameraForm.addEventListener("submit", createCamera);
  Promise.all([load(), loadProjects()]);
})();
