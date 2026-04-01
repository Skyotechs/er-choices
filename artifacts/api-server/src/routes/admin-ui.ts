import { Router } from "express";

const router = Router();

router.get("/admin-ui", (_req, res) => {
  res.setHeader("Content-Type", "text/html");
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>ER Chooser Admin</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f172a; color: #e2e8f0; min-height: 100vh; }
    .header { background: #1e293b; border-bottom: 1px solid #334155; padding: 16px 24px; display: flex; align-items: center; gap: 12px; }
    .header h1 { font-size: 18px; font-weight: 700; color: #f1f5f9; }
    .badge { background: #c0392b; color: #fff; font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 99px; }
    .login { max-width: 380px; margin: 80px auto; padding: 32px; background: #1e293b; border-radius: 12px; border: 1px solid #334155; }
    .login h2 { font-size: 20px; font-weight: 700; margin-bottom: 6px; }
    .login p { font-size: 13px; color: #94a3b8; margin-bottom: 24px; }
    input[type="password"] { width: 100%; padding: 10px 14px; background: #0f172a; border: 1px solid #475569; border-radius: 8px; color: #f1f5f9; font-size: 14px; margin-bottom: 12px; outline: none; }
    input[type="password"]:focus { border-color: #c0392b; }
    button { width: 100%; padding: 10px; background: #c0392b; color: #fff; border: none; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; }
    button:hover { background: #a93226; }
    .error { color: #f87171; font-size: 13px; margin-top: 8px; }
    .main { max-width: 960px; margin: 0 auto; padding: 24px; }
    .toolbar { display: flex; gap: 8px; margin-bottom: 20px; }
    .filter-btn { padding: 6px 14px; border-radius: 6px; border: 1px solid #334155; background: transparent; color: #94a3b8; font-size: 13px; cursor: pointer; }
    .filter-btn.active { background: #c0392b; border-color: #c0392b; color: #fff; }
    .count { color: #64748b; font-size: 13px; margin-left: auto; align-self: center; }
    .card { background: #1e293b; border: 1px solid #334155; border-radius: 10px; padding: 16px 20px; margin-bottom: 12px; }
    .card-header { display: flex; align-items: flex-start; gap: 12px; }
    .hospital-name { font-size: 15px; font-weight: 600; color: #f1f5f9; flex: 1; }
    .status-pill { font-size: 11px; font-weight: 600; padding: 3px 10px; border-radius: 99px; white-space: nowrap; }
    .status-pending { background: #f59e0b22; color: #fbbf24; border: 1px solid #f59e0b44; }
    .status-resolved { background: #10b98122; color: #34d399; border: 1px solid #10b98144; }
    .status-dismissed { background: #64748b22; color: #94a3b8; border: 1px solid #64748b44; }
    .issue-type { display: inline-block; background: #1e40af22; color: #93c5fd; border: 1px solid #1e40af44; font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 6px; margin-top: 8px; text-transform: uppercase; letter-spacing: 0.5px; }
    .notes { font-size: 13px; color: #94a3b8; margin-top: 8px; line-height: 1.5; }
    .meta { font-size: 12px; color: #475569; margin-top: 8px; }
    .actions { display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap; }
    .btn-resolve { padding: 6px 14px; background: #10b98122; color: #34d399; border: 1px solid #10b98144; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer; width: auto; }
    .btn-resolve:hover { background: #10b98133; }
    .btn-dismiss { padding: 6px 14px; background: transparent; color: #64748b; border: 1px solid #334155; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer; width: auto; }
    .btn-dismiss:hover { background: #1e293b; color: #94a3b8; }
    .btn-osm { padding: 6px 14px; background: transparent; color: #60a5fa; border: 1px solid #1e40af44; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer; text-decoration: none; display: inline-flex; align-items: center; gap: 4px; width: auto; }
    .btn-osm:hover { background: #1e40af22; }
    .empty { text-align: center; padding: 60px 20px; color: #475569; }
    #login-view, #dashboard-view { display: none; }

    /* Specialty editor */
    .specialty-editor { margin-top: 14px; padding: 14px 16px; background: #0f172a; border: 1px solid #334155; border-radius: 8px; }
    .specialty-editor h4 { font-size: 12px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 10px; }
    .specialty-grid { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
    .specialty-check { display: flex; align-items: center; gap: 6px; cursor: pointer; }
    .specialty-check input[type="checkbox"] { width: 15px; height: 15px; accent-color: #c0392b; cursor: pointer; margin: 0; }
    .specialty-check span { font-size: 13px; color: #cbd5e1; }
    .specialty-actions { display: flex; gap: 8px; align-items: center; }
    .btn-save-spec { padding: 6px 16px; background: #c0392b; color: #fff; border: none; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer; width: auto; }
    .btn-save-spec:hover { background: #a93226; }
    .btn-save-spec:disabled { background: #475569; cursor: not-allowed; }
    .spec-status { font-size: 12px; color: #94a3b8; }
    .spec-status.ok { color: #34d399; }
    .spec-status.err { color: #f87171; }
  </style>
</head>
<body>

<div id="login-view">
  <div class="login">
    <h2>ER Chooser Admin</h2>
    <p>Enter your admin secret to view hospital reports.</p>
    <input type="password" id="secret-input" placeholder="Admin secret" />
    <button onclick="login()">Sign In</button>
    <div class="error" id="login-error"></div>
  </div>
</div>

<div id="dashboard-view">
  <div class="header">
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#c0392b" stroke-width="2.2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
    <h1>ER Chooser Admin</h1>
    <span class="badge" id="pending-count">...</span>
    <button onclick="logout()" style="width:auto;padding:6px 14px;margin-left:auto;background:#334155;font-size:13px;border-radius:6px;">Sign Out</button>
  </div>
  <div class="main">
    <div class="toolbar">
      <button class="filter-btn active" onclick="setFilter('all', this)">All</button>
      <button class="filter-btn" onclick="setFilter('pending', this)">Pending</button>
      <button class="filter-btn" onclick="setFilter('resolved', this)">Resolved</button>
      <button class="filter-btn" onclick="setFilter('dismissed', this)">Dismissed</button>
      <span class="count" id="report-count"></span>
    </div>
    <div id="reports-list"></div>
  </div>
</div>

<script>
let secret = '';
let allReports = [];
let currentFilter = 'all';
let specialtyMap = {}; // osmId → string[]

const ALL_SPECIALTIES = ['Trauma', 'Cardiac', 'Stroke', 'Pediatric', 'Burn', 'Obstetrics', 'Psychiatric', 'Cancer'];

function osmEditUrl(osmId) {
  const match = osmId.match(/^osm-(node|way|relation)-(\d+)$/);
  if (!match) return null;
  const [, type, id] = match;
  return \`https://www.openstreetmap.org/edit?\${type}=\${id}\`;
}

function osmViewUrl(osmId) {
  const match = osmId.match(/^osm-(node|way|relation)-(\d+)$/);
  if (!match) return null;
  const [, type, id] = match;
  return \`https://www.openstreetmap.org/\${type}/\${id}\`;
}

const ISSUE_LABELS = {
  wrong_name: 'Wrong Name',
  wrong_address: 'Wrong Address',
  wrong_phone: 'Wrong Phone',
  permanently_closed: 'Permanently Closed',
  not_a_hospital: 'Not a Hospital',
  wrong_specialty: 'Wrong Specialty',
  other: 'Other',
};

async function loadSpecialtyMap() {
  try {
    const res = await fetch('/api/specialties');
    if (res.ok) specialtyMap = await res.json();
  } catch {}
}

function init() {
  const saved = sessionStorage.getItem('admin_secret');
  if (saved) { secret = saved; showDashboard(); }
  else { document.getElementById('login-view').style.display = 'block'; }
  document.getElementById('secret-input').addEventListener('keydown', e => { if (e.key === 'Enter') login(); });
}

async function login() {
  const s = document.getElementById('secret-input').value.trim();
  if (!s) return;
  const res = await fetch('/api/admin/reports', { headers: { Authorization: 'Bearer ' + s } });
  if (res.status === 401) { document.getElementById('login-error').textContent = 'Invalid secret. Check your ADMIN_SECRET environment variable.'; return; }
  secret = s;
  sessionStorage.setItem('admin_secret', s);
  allReports = await res.json();
  showDashboard();
}

function logout() {
  sessionStorage.removeItem('admin_secret');
  secret = '';
  document.getElementById('dashboard-view').style.display = 'none';
  document.getElementById('login-view').style.display = 'block';
  document.getElementById('secret-input').value = '';
  document.getElementById('login-error').textContent = '';
}

async function showDashboard() {
  document.getElementById('login-view').style.display = 'none';
  document.getElementById('dashboard-view').style.display = 'block';
  // Fetch specialties first so checkboxes are pre-populated when reports render.
  await loadSpecialtyMap();
  await loadReports();
}

async function loadReports() {
  const res = await fetch('/api/admin/reports', { headers: { Authorization: 'Bearer ' + secret } });
  if (!res.ok) { logout(); return; }
  allReports = await res.json();
  render();
}

function setFilter(f, btn) {
  currentFilter = f;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  render();
}

function specialtyEditorHtml(reportId, osmId) {
  const current = specialtyMap[osmId] || [];
  const checkboxes = ALL_SPECIALTIES.map(s => {
    const checked = current.includes(s) ? 'checked' : '';
    return \`<label class="specialty-check">
      <input type="checkbox" id="spec-\${reportId}-\${s}" value="\${s}" \${checked} />
      <span>\${s}</span>
    </label>\`;
  }).join('');

  return \`<div class="specialty-editor" id="spec-editor-\${reportId}">
    <h4>Verified Specialties</h4>
    <div class="specialty-grid">\${checkboxes}</div>
    <div class="specialty-actions">
      <button class="btn-save-spec" id="spec-save-\${reportId}" onclick="saveSpecialties('\${osmId}', \${reportId})">Save &amp; Resolve</button>
      <span class="spec-status" id="spec-status-\${reportId}"></span>
    </div>
  </div>\`;
}

function render() {
  const pending = allReports.filter(r => r.status === 'pending').length;
  document.getElementById('pending-count').textContent = pending + ' pending';
  const filtered = currentFilter === 'all' ? allReports : allReports.filter(r => r.status === currentFilter);
  document.getElementById('report-count').textContent = filtered.length + ' reports';
  const list = document.getElementById('reports-list');
  if (filtered.length === 0) {
    list.innerHTML = '<div class="empty">No reports found</div>';
    return;
  }
  list.innerHTML = filtered.map(r => {
    const date = new Date(r.submittedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const editUrl = osmEditUrl(r.osmId);
    const viewUrl = osmViewUrl(r.osmId);
    const osmLink = viewUrl ? \`<a href="\${viewUrl}" target="_blank" rel="noopener" style="color:#60a5fa;text-decoration:none;">\${r.osmId}</a>\` : r.osmId;
    const isPending = r.status === 'pending';
    const isWrongSpecialty = r.issueType === 'wrong_specialty';
    const actions = \`
      \${isPending ? \`
        <button class="btn-resolve" onclick="resolve(\${r.id})">Mark Resolved</button>
        <button class="btn-dismiss" onclick="dismiss(\${r.id})">Dismiss</button>
      \` : ''}
      \${editUrl ? \`<a class="btn-osm" href="\${editUrl}" target="_blank" rel="noopener">✏️ Fix on OpenStreetMap</a>\` : ''}
    \`;
    const editor = (isPending && isWrongSpecialty) ? specialtyEditorHtml(r.id, r.osmId) : '';
    return \`<div class="card" id="report-\${r.id}">
      <div class="card-header">
        <div class="hospital-name">\${r.hospitalName}</div>
        <span class="status-pill status-\${r.status}">\${r.status}</span>
      </div>
      <div class="issue-type">\${ISSUE_LABELS[r.issueType] || r.issueType}</div>
      \${r.notes ? \`<div class="notes">"\${r.notes}"</div>\` : ''}
      <div class="meta">OSM: \${osmLink} &nbsp;·&nbsp; Submitted \${date}</div>
      \${editor}
      <div class="actions">\${actions}</div>
    </div>\`;
  }).join('');
}

async function saveSpecialties(osmId, reportId) {
  const btn = document.getElementById(\`spec-save-\${reportId}\`);
  const status = document.getElementById(\`spec-status-\${reportId}\`);
  btn.disabled = true;
  status.textContent = 'Saving…';
  status.className = 'spec-status';

  const selected = ALL_SPECIALTIES.filter(s => {
    const el = document.getElementById(\`spec-\${reportId}-\${s}\`);
    return el && el.checked;
  });

  try {
    const res = await fetch(\`/api/admin/specialties/\${encodeURIComponent(osmId)}\`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + secret },
      body: JSON.stringify({ specialties: selected }),
    });
    if (!res.ok) throw new Error('Server error ' + res.status);
    const data = await res.json();
    specialtyMap[osmId] = data.specialties ?? selected;
    status.textContent = '✓ Saved';
    status.className = 'spec-status ok';
    await fetch(\`/api/admin/reports/\${reportId}/resolve\`, { method: 'PATCH', headers: { Authorization: 'Bearer ' + secret } });
    await loadReports();
  } catch (err) {
    status.textContent = 'Error saving. Try again.';
    status.className = 'spec-status err';
    btn.disabled = false;
  }
}

async function resolve(id) {
  await fetch(\`/api/admin/reports/\${id}/resolve\`, { method: 'PATCH', headers: { Authorization: 'Bearer ' + secret } });
  await loadReports();
}

async function dismiss(id) {
  await fetch(\`/api/admin/reports/\${id}/dismiss\`, { method: 'PATCH', headers: { Authorization: 'Bearer ' + secret } });
  await loadReports();
}

init();
</script>
</body>
</html>`);
});

export default router;
