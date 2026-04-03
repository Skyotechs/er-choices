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
    .badge-warning { background: #d97706; color: #fff; font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 99px; }
    .login { max-width: 380px; margin: 80px auto; padding: 32px; background: #1e293b; border-radius: 12px; border: 1px solid #334155; }
    .login h2 { font-size: 20px; font-weight: 700; margin-bottom: 6px; }
    .login p { font-size: 13px; color: #94a3b8; margin-bottom: 24px; }
    input[type="password"] { width: 100%; padding: 10px 14px; background: #0f172a; border: 1px solid #475569; border-radius: 8px; color: #f1f5f9; font-size: 14px; margin-bottom: 12px; outline: none; }
    input[type="password"]:focus { border-color: #c0392b; }
    button { width: 100%; padding: 10px; background: #c0392b; color: #fff; border: none; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; }
    button:hover { background: #a93226; }
    .error { color: #f87171; font-size: 13px; margin-top: 8px; }
    .main { max-width: 1080px; margin: 0 auto; padding: 24px; }
    /* Nav tabs */
    .nav-tabs { display: flex; gap: 4px; margin-bottom: 24px; border-bottom: 1px solid #334155; }
    .nav-tab { padding: 10px 18px; background: transparent; color: #94a3b8; border: none; border-bottom: 2px solid transparent; font-size: 14px; font-weight: 600; cursor: pointer; border-radius: 0; transition: color 0.15s; display: flex; align-items: center; gap: 8px; }
    .nav-tab:hover { color: #e2e8f0; background: transparent; }
    .nav-tab.active { color: #f1f5f9; border-bottom-color: #c0392b; background: transparent; }
    /* Reports view */
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
    /* Specialty Gaps view */
    .gaps-summary { display: flex; gap: 16px; margin-bottom: 24px; flex-wrap: wrap; }
    .gap-stat { background: #1e293b; border: 1px solid #334155; border-radius: 8px; padding: 14px 20px; flex: 1; min-width: 140px; }
    .gap-stat-value { font-size: 28px; font-weight: 700; color: #f1f5f9; }
    .gap-stat-label { font-size: 12px; color: #64748b; margin-top: 2px; }
    .designation-section { margin-bottom: 24px; }
    .designation-header { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; cursor: pointer; user-select: none; }
    .designation-title { font-size: 14px; font-weight: 700; color: #f1f5f9; flex: 1; }
    .designation-count { font-size: 12px; color: #64748b; background: #1e293b; border: 1px solid #334155; border-radius: 99px; padding: 2px 10px; }
    .designation-chevron { color: #64748b; font-size: 12px; transition: transform 0.2s; }
    .designation-chevron.open { transform: rotate(90deg); }
    .designation-body { display: none; }
    .designation-body.open { display: block; }
    .gap-row { background: #1e293b; border: 1px solid #334155; border-radius: 8px; padding: 12px 16px; margin-bottom: 8px; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    .gap-hospital-name { font-size: 14px; font-weight: 600; color: #f1f5f9; flex: 1; min-width: 160px; }
    .gap-state { font-size: 12px; color: #64748b; background: #0f172a; padding: 2px 8px; border-radius: 4px; }
    .gap-actions { display: flex; gap: 8px; flex-wrap: wrap; }
    .btn-present { padding: 5px 12px; background: #10b98122; color: #34d399; border: 1px solid #10b98144; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer; width: auto; }
    .btn-present:hover { background: #10b98133; }
    .btn-absent { padding: 5px 12px; background: #ef444422; color: #fca5a5; border: 1px solid #ef444444; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer; width: auto; }
    .btn-absent:hover { background: #ef444433; }
    .btn-edit { padding: 5px 12px; background: transparent; color: #60a5fa; border: 1px solid #1e40af44; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer; text-decoration: none; display: inline-flex; align-items: center; gap: 4px; width: auto; }
    .btn-edit:hover { background: #1e40af22; }
    .gap-row-saving { opacity: 0.6; pointer-events: none; }
    .gaps-loading { text-align: center; padding: 40px; color: #64748b; }
    .gaps-filter { display: flex; gap: 8px; margin-bottom: 16px; align-items: center; flex-wrap: wrap; }
    .gaps-search { flex: 1; min-width: 200px; padding: 8px 12px; background: #0f172a; border: 1px solid #334155; border-radius: 6px; color: #f1f5f9; font-size: 13px; outline: none; }
    .gaps-search:focus { border-color: #c0392b; }
    .gaps-search::placeholder { color: #475569; }
    .source-tag { font-size: 10px; font-weight: 600; padding: 2px 6px; border-radius: 4px; text-transform: uppercase; }
    .source-cms { background: #1e40af22; color: #93c5fd; border: 1px solid #1e40af44; }
    .source-admin { background: #7c3aed22; color: #c4b5fd; border: 1px solid #7c3aed44; }
    /* Full edit modal */
    .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.7); display: none; align-items: center; justify-content: center; z-index: 1000; }
    .modal-overlay.open { display: flex; }
    .modal { background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 24px; max-width: 560px; width: 90%; max-height: 80vh; overflow-y: auto; }
    .modal h3 { font-size: 16px; font-weight: 700; color: #f1f5f9; margin-bottom: 4px; }
    .modal .modal-subtitle { font-size: 12px; color: #64748b; margin-bottom: 16px; }
    .modal-specialty-grid { display: flex; flex-direction: column; gap: 6px; margin-bottom: 16px; }
    .modal-specialty-grid .specialty-check span { font-size: 13px; }
    .modal-actions { display: flex; gap: 8px; align-items: center; }
    .btn-modal-save { padding: 8px 20px; background: #c0392b; color: #fff; border: none; border-radius: 6px; font-size: 13px; font-weight: 600; cursor: pointer; width: auto; }
    .btn-modal-save:hover { background: #a93226; }
    .btn-modal-save:disabled { background: #475569; cursor: not-allowed; }
    .btn-modal-cancel { padding: 8px 16px; background: transparent; color: #94a3b8; border: 1px solid #334155; border-radius: 6px; font-size: 13px; cursor: pointer; width: auto; }
    .btn-modal-cancel:hover { background: #0f172a; }
    /* Hospital editor tab */
    .hosp-search-row { display: flex; gap: 8px; margin-bottom: 16px; }
    .hosp-search-row input[type="text"] { flex: 1; padding: 10px 14px; background: #0f172a; border: 1px solid #475569; border-radius: 8px; color: #f1f5f9; font-size: 14px; outline: none; }
    .hosp-search-row input[type="text"]:focus { border-color: #c0392b; }
    .btn-search { padding: 10px 18px; background: #334155; color: #f1f5f9; border: none; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; width: auto; }
    .btn-search:hover { background: #475569; }
    .hosp-results { margin-bottom: 16px; }
    .hosp-result-item { display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; background: #0f172a; border: 1px solid #334155; border-radius: 8px; margin-bottom: 6px; cursor: pointer; transition: border-color 0.15s; }
    .hosp-result-item:hover { border-color: #c0392b; }
    .hosp-result-item.selected { border-color: #c0392b; background: #1a0a0a; }
    .hosp-result-name { font-size: 14px; font-weight: 600; color: #f1f5f9; }
    .hosp-result-meta { font-size: 12px; color: #475569; margin-top: 2px; }
    .hosp-override-badge { font-size: 10px; font-weight: 700; color: #fbbf24; background: #f59e0b22; border: 1px solid #f59e0b44; padding: 2px 6px; border-radius: 99px; white-space: nowrap; }
    .hosp-edit-form { background: #0f172a; border: 1px solid #334155; border-radius: 10px; padding: 20px; margin-top: 4px; }
    .hosp-edit-form h4 { font-size: 13px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 16px; }
    .form-row { margin-bottom: 14px; }
    .form-row label { display: block; font-size: 12px; font-weight: 600; color: #94a3b8; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px; }
    .form-row input[type="text"], .form-row input[type="number"] { width: 100%; padding: 10px 14px; background: #1e293b; border: 1px solid #475569; border-radius: 8px; color: #f1f5f9; font-size: 14px; outline: none; }
    .form-row input[type="text"]:focus, .form-row input[type="number"]:focus { border-color: #c0392b; }
    .form-hint { font-size: 11px; color: #475569; margin-top: 4px; }
    .form-actions { display: flex; gap: 10px; align-items: center; margin-top: 20px; }
    .btn-save-hosp { padding: 8px 20px; background: #c0392b; color: #fff; border: none; border-radius: 8px; font-size: 13px; font-weight: 700; cursor: pointer; width: auto; }
    .btn-save-hosp:hover { background: #a93226; }
    .btn-save-hosp:disabled { background: #475569; cursor: not-allowed; }
    .hosp-save-status { font-size: 13px; color: #94a3b8; }
    .hosp-save-status.ok { color: #34d399; }
    .hosp-save-status.err { color: #f87171; }
    .no-results { font-size: 14px; color: #475569; padding: 20px 0; text-align: center; }
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
    <span class="badge-warning" id="gaps-badge" style="display:none">...</span>
    <button onclick="logout()" style="width:auto;padding:6px 14px;margin-left:auto;background:#334155;font-size:13px;border-radius:6px;">Sign Out</button>
  </div>

  <!-- DB Seed Banner — always visible so admins can re-import at any time -->
  <div id="seed-banner" style="display:none;background:#1e293b;border-bottom:1px solid #334155;padding:12px 24px;display:flex;align-items:center;gap:16px;flex-wrap:wrap;">
    <span style="font-size:13px;color:#cbd5e1;flex:1;min-width:200px;" id="seed-banner-text">
      🏥 CMS hospital data import
    </span>
    <div style="display:flex;gap:8px;align-items:center;">
      <button id="seed-btn" onclick="startSeed()" style="width:auto;padding:6px 16px;background:#c2410c;font-size:13px;border-radius:6px;border:1px solid #ea580c;">
        Import CMS Data (~15 min)
      </button>
      <button onclick="checkSeedStatus()" style="width:auto;padding:6px 12px;background:#334155;font-size:13px;border-radius:6px;">
        Refresh Status
      </button>
      <span id="seed-status-text" style="font-size:12px;color:#fdba74;"></span>
    </div>
  </div>
  <div id="seed-log-box" style="display:none;background:#0f172a;border-bottom:1px solid #334155;padding:12px 24px;font-family:monospace;font-size:11px;color:#94a3b8;max-height:120px;overflow-y:auto;white-space:pre-wrap;"></div>

  <div class="main">
    <div class="nav-tabs">
      <button class="nav-tab active" id="tab-reports" onclick="switchTab('reports')">Hospital Reports</button>
      <button class="nav-tab" id="tab-gaps" onclick="switchTab('gaps')">Specialty Gaps</button>
      <button class="nav-tab" id="tab-hospitals" onclick="switchTab('hospitals')">Edit Hospital Data</button>
    </div>

    <!-- Reports tab -->
    <div id="view-reports">
      <div class="toolbar">
        <button class="filter-btn active" onclick="setFilter('all', this)">All</button>
        <button class="filter-btn" onclick="setFilter('pending', this)">Pending</button>
        <button class="filter-btn" onclick="setFilter('resolved', this)">Resolved</button>
        <button class="filter-btn" onclick="setFilter('dismissed', this)">Dismissed</button>
        <span class="count" id="report-count"></span>
      </div>
      <div id="reports-list"></div>
    </div>

    <!-- Specialty Gaps tab -->
    <div id="view-gaps" style="display:none">
      <div class="gaps-summary" id="gaps-summary"></div>
      <div class="gaps-filter">
        <input class="gaps-search" id="gaps-search" type="text" placeholder="Search hospitals or designations…" oninput="renderGaps()" />
      </div>
      <div id="gaps-list"><div class="gaps-loading">Loading specialty gaps…</div></div>
    </div>

    <!-- Edit Hospital Data tab -->
    <div id="view-hospitals" style="display:none">
      <div class="hosp-search-row">
        <input type="text" id="hosp-search-input" placeholder="Search by hospital name…" onkeydown="if(event.key==='Enter')searchHospitals()" />
        <button class="btn-search" onclick="searchHospitals()">Search</button>
      </div>
      <div id="hosp-search-status" style="font-size:13px;color:#475569;margin-bottom:8px;"></div>
      <div class="hosp-results" id="hosp-results"></div>
      <div id="hosp-edit-panel"></div>
    </div>
  </div>
</div>

<!-- Full specialty edit modal (opened from gap rows) -->
<div class="modal-overlay" id="gap-edit-modal">
  <div class="modal">
    <h3 id="gap-edit-title">Edit Specialties</h3>
    <div class="modal-subtitle">Check all designations confirmed present for this hospital. Unchecked items will be marked absent and removed from the review queue.</div>
    <div class="modal-specialty-grid" id="gap-edit-checks"></div>
    <div class="modal-actions">
      <button class="btn-modal-save" id="gap-edit-save" onclick="saveGapEditForm()">Save All Designations</button>
      <button class="btn-modal-cancel" onclick="closeGapEditForm()">Cancel</button>
      <span class="spec-status" id="gap-edit-status"></span>
    </div>
  </div>
</div>

<script>
let secret = '';
let allReports = [];
let currentFilter = 'all';
let specialtyMap = {};
let gapsData = null;

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
  await Promise.all([loadSpecialtyMap(), loadCanonicalDesignations(), checkSeedStatus()]);
  await loadReports();
  loadGaps();
}

async function checkSeedStatus() {
  try {
    const res = await fetch('/api/admin/seed/status', { headers: { Authorization: 'Bearer ' + secret } });
    if (!res.ok) return;
    const data = await res.json();
    const banner = document.getElementById('seed-banner');
    const statusText = document.getElementById('seed-status-text');
    const logBox = document.getElementById('seed-log-box');
    const seedBtn = document.getElementById('seed-btn');

    // Always show the banner so re-import is accessible at any time
    banner.style.display = 'flex';
    const bannerText = document.getElementById('seed-banner-text');

    if (data.status === 'running') {
      bannerText.textContent = '⏳ Import running…' + (data.startedAt ? ' started ' + new Date(data.startedAt).toLocaleTimeString() : '');
      statusText.textContent = '';
      seedBtn.disabled = true;
      seedBtn.textContent = 'Running…';
      if (data.recentLog) {
        logBox.style.display = 'block';
        logBox.textContent = data.recentLog;
        logBox.scrollTop = logBox.scrollHeight;
      }
      setTimeout(checkSeedStatus, 10000);
    } else if (data.status === 'done') {
      bannerText.textContent = '🏥 ' + data.hospitalCount + ' hospitals in database';
      statusText.textContent = '';
      seedBtn.disabled = false;
      seedBtn.textContent = 'Re-run Import';
      if (data.recentLog) {
        logBox.style.display = 'block';
        logBox.textContent = data.recentLog;
      }
    } else if (data.status === 'error') {
      bannerText.textContent = '✗ Last import failed — check log below';
      statusText.textContent = '';
      seedBtn.disabled = false;
      seedBtn.textContent = 'Retry Import';
      if (data.recentLog) {
        logBox.style.display = 'block';
        logBox.textContent = data.recentLog;
      }
    } else {
      bannerText.textContent = data.hospitalCount > 0
        ? '🏥 ' + data.hospitalCount + ' hospitals in database'
        : '⚠️ Database empty — import CMS data to get started';
      statusText.textContent = '';
      seedBtn.disabled = false;
      seedBtn.textContent = data.hospitalCount > 0 ? 'Re-run Import' : 'Import CMS Data (~15 min)';
      if (data.recentLog) {
        logBox.style.display = 'block';
        logBox.textContent = data.recentLog;
      }
    }
  } catch (err) {
    console.warn('Seed status check failed:', err);
  }
}

async function startSeed() {
  const btn = document.getElementById('seed-btn');
  const statusText = document.getElementById('seed-status-text');
  btn.disabled = true;
  statusText.textContent = 'Starting import…';
  try {
    const res = await fetch('/api/admin/seed', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + secret },
    });
    const data = await res.json();
    statusText.textContent = data.message || 'Started.';
    if (data.status === 'started' || data.status === 'running') {
      setTimeout(checkSeedStatus, 3000);
    } else {
      btn.disabled = false;
    }
  } catch {
    statusText.textContent = 'Failed to start import.';
    btn.disabled = false;
  }
}

async function loadReports() {
  const res = await fetch('/api/admin/reports', { headers: { Authorization: 'Bearer ' + secret } });
  if (!res.ok) { logout(); return; }
  allReports = await res.json();
  render();
}

function switchTab(tab) {
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  document.getElementById('tab-' + tab).classList.add('active');
  document.getElementById('view-reports').style.display = tab === 'reports' ? '' : 'none';
  document.getElementById('view-gaps').style.display = tab === 'gaps' ? '' : 'none';
  document.getElementById('view-hospitals').style.display = tab === 'hospitals' ? '' : 'none';
  if (tab === 'gaps' && !gapsData) loadGaps();
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

/* ============================================================
   SPECIALTY GAPS VIEW
   ============================================================ */

async function loadGaps() {
  const listEl = document.getElementById('gaps-list');
  listEl.innerHTML = '<div class="gaps-loading">Loading specialty gaps…</div>';
  try {
    const res = await fetch('/api/admin/specialty-gaps', { headers: { Authorization: 'Bearer ' + secret } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    gapsData = await res.json();
    updateGapsBadge();
    renderGaps();
  } catch (err) {
    listEl.innerHTML = '<div class="empty">Failed to load specialty gaps. Make sure you are logged in.</div>';
  }
}

function updateGapsBadge() {
  const badge = document.getElementById('gaps-badge');
  if (!gapsData) { badge.style.display = 'none'; return; }
  const total = gapsData.totalGaps || 0;
  if (total > 0) {
    badge.textContent = total + ' gaps';
    badge.style.display = '';
  } else {
    badge.style.display = 'none';
  }
}

function renderGaps() {
  if (!gapsData) return;

  const summaryEl = document.getElementById('gaps-summary');
  summaryEl.innerHTML = \`
    <div class="gap-stat"><div class="gap-stat-value">\${gapsData.totalHospitals}</div><div class="gap-stat-label">Hospitals with gaps</div></div>
    <div class="gap-stat"><div class="gap-stat-value">\${gapsData.totalGaps}</div><div class="gap-stat-label">Total unverified gaps</div></div>
    <div class="gap-stat"><div class="gap-stat-value">\${Object.keys(gapsData.byDesignation).length}</div><div class="gap-stat-label">Designations affected</div></div>
  \`;

  const searchQuery = (document.getElementById('gaps-search').value || '').toLowerCase();
  const byDesig = gapsData.byDesignation;

  const listEl = document.getElementById('gaps-list');

  if (Object.keys(byDesig).length === 0) {
    listEl.innerHTML = '<div class="empty">No specialty gaps found. All designations are verified!</div>';
    return;
  }

  const html = Object.entries(byDesig)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([designation, hospitals]) => {
      const filteredHospitals = hospitals.filter(h => {
        if (!searchQuery) return true;
        return h.hospitalName.toLowerCase().includes(searchQuery)
          || designation.toLowerCase().includes(searchQuery)
          || (h.state || '').toLowerCase().includes(searchQuery);
      });
      if (filteredHospitals.length === 0) return '';

      const desigId = 'desig-' + designation.replace(/[^a-zA-Z0-9]/g, '_');

      const rows = filteredHospitals.map(h => {
        const osmAppId = h.osmId
          ? (h.osmId.startsWith('osm-') ? h.osmId : 'osm-' + h.osmId.replace('/', '-'))
          : null;
        const editOsmUrl = osmAppId ? osmEditUrl(osmAppId) : null;
        const editOsmBtn = editOsmUrl
          ? \`<a class="btn-edit" href="\${editOsmUrl}" target="_blank" rel="noopener">✏️ OSM</a>\`
          : '';
        return \`<div class="gap-row" id="gap-\${h.id}-\${desigId}"
            data-record-id="\${h.id}"
            data-designation="\${escAttr(designation)}"
            data-desig-id="\${desigId}"
            data-hospital-name="\${escAttr(h.hospitalName)}"
            data-specialties="\${escAttr(JSON.stringify(h.specialties))}">
          <div class="gap-hospital-name">\${escHtml(h.hospitalName)}</div>
          <span class="gap-state">\${escHtml(h.state || '—')}</span>
          <div class="gap-actions">
            <button class="btn-present gap-btn" data-action="present">✓ Present</button>
            <button class="btn-absent gap-btn" data-action="absent">✗ Absent</button>
            <button class="btn-edit gap-btn" data-action="edit">⚙ Edit Specialties</button>
            \${editOsmBtn}
          </div>
        </div>\`;
      }).join('');

      return \`<div class="designation-section">
        <div class="designation-header" data-desig-id="\${desigId}">
          <span class="designation-chevron open" id="chevron-\${desigId}">▶</span>
          <span class="designation-title">\${escHtml(designation)}</span>
          <span class="designation-count">\${filteredHospitals.length} hospital\${filteredHospitals.length !== 1 ? 's' : ''}</span>
        </div>
        <div class="designation-body open" id="body-\${desigId}">
          \${rows}
        </div>
      </div>\`;
    }).join('');

  listEl.innerHTML = html || '<div class="empty">No gaps match your search.</div>';
}

function toggleDesig(id) {
  const body = document.getElementById('body-' + id);
  const chevron = document.getElementById('chevron-' + id);
  if (!body) return;
  body.classList.toggle('open');
  chevron.classList.toggle('open');
}

async function resolveGap(recordId, designation, present, desigId) {
  const rowEl = document.getElementById(\`gap-\${recordId}-\${desigId}\`);
  if (rowEl) rowEl.classList.add('gap-row-saving');
  try {
    const res = await fetch(\`/api/admin/specialty-gaps/\${recordId}/resolve\`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + secret },
      body: JSON.stringify({ designation, present }),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    await loadGaps();
  } catch (err) {
    if (rowEl) rowEl.classList.remove('gap-row-saving');
    alert('Failed to resolve gap. Try again.');
  }
}

/* Full specialty edit form from gap view */
let editFormRecordId = null;
let editFormCurrentSpecialties = [];

/**
 * Canonical designation list — populated at runtime from /api/specialty-definitions.
 * Falls back to a hardcoded list only if the API is unavailable so the admin UI
 * always has the authoritative values from the single source of truth.
 */
let ALL_16_DESIGNATIONS = [
  'Behavioral Health',
  'Burn Center - Adult',
  'Burn Center - Pediatric',
  'Cardiac - PCI Capable',
  'HazMat/Decontamination',
  'Obstetrics',
  'Pediatric Care',
  'Stroke - Comprehensive Center',
  'Stroke - Thrombectomy Capable Center',
  'Stroke - Primary Center',
  'Stroke - Acute Ready Center',
  'Trauma - Adult Level 1 & 2',
  'Trauma - Adult Level 3',
  'Trauma - Adult Level 4',
  'Trauma - Pediatric Level 1',
  'Trauma - Pediatric Level 2',
];

async function loadCanonicalDesignations() {
  try {
    const res = await fetch('/api/specialty-definitions');
    if (!res.ok) return;
    const defs = await res.json();
    if (Array.isArray(defs) && defs.length > 0) {
      ALL_16_DESIGNATIONS = defs.map(d => d.key);
    }
  } catch {}
}

function openGapEditForm(recordId, hospitalName, currentSpecialties) {
  editFormRecordId = recordId;
  editFormCurrentSpecialties = currentSpecialties || [];

  const checkboxes = ALL_16_DESIGNATIONS.map(d => {
    const checked = editFormCurrentSpecialties.includes(d) ? 'checked' : '';
    return \`<label class="specialty-check">
      <input type="checkbox" id="gapedit-\${d.replace(/[^a-zA-Z0-9]/g,'_')}" value="\${d}" \${checked} />
      <span style="font-size:12px">\${d}</span>
    </label>\`;
  }).join('');

  document.getElementById('gap-edit-title').textContent = hospitalName;
  document.getElementById('gap-edit-checks').innerHTML = checkboxes;
  document.getElementById('gap-edit-status').textContent = '';
  document.getElementById('gap-edit-save').disabled = false;
  document.getElementById('gap-edit-modal').style.display = 'flex';
}

function closeGapEditForm() {
  document.getElementById('gap-edit-modal').style.display = 'none';
  editFormRecordId = null;
}

async function saveGapEditForm() {
  if (!editFormRecordId) return;
  const btn = document.getElementById('gap-edit-save');
  const status = document.getElementById('gap-edit-status');
  btn.disabled = true;
  status.textContent = 'Saving…';

  const selected = ALL_16_DESIGNATIONS.filter(d => {
    const el = document.getElementById('gapedit-' + d.replace(/[^a-zA-Z0-9]/g,'_'));
    return el && el.checked;
  });

  try {
    const res = await fetch(\`/api/admin/specialty-gaps/\${editFormRecordId}/resolve-all\`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + secret },
      body: JSON.stringify({ specialties: selected }),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    status.textContent = '✓ Saved';
    closeGapEditForm();
    await loadGaps();
  } catch (err) {
    status.textContent = 'Error saving. Try again.';
    btn.disabled = false;
  }
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escAttr(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/* Event delegation for gap row actions — avoids inline onclick with untrusted data */
document.addEventListener('click', function(e) {
  const btn = e.target.closest('.gap-btn');
  if (!btn) return;
  const row = btn.closest('.gap-row');
  if (!row) return;

  const recordId = Number(row.dataset.recordId);
  const designation = row.dataset.designation;
  const desigId = row.dataset.desigId;
  const hospitalName = row.dataset.hospitalName;
  let specialties = [];
  try { specialties = JSON.parse(row.dataset.specialties || '[]'); } catch {}

  const action = btn.dataset.action;
  if (action === 'present') {
    resolveGap(recordId, designation, true, desigId);
  } else if (action === 'absent') {
    resolveGap(recordId, designation, false, desigId);
  } else if (action === 'edit') {
    openGapEditForm(recordId, hospitalName, specialties);
  }
});

/* Event delegation for designation header toggle */
document.addEventListener('click', function(e) {
  const header = e.target.closest('.designation-header');
  if (!header) return;
  const desigId = header.dataset.desigId;
  if (desigId) toggleDesig(desigId);
});

/* ============================================================
   HOSPITAL EDITOR TAB
   ============================================================ */
let hospSearchResults = [];
let selectedHosp = null;

async function searchHospitals() {
  const q = document.getElementById('hosp-search-input').value.trim();
  if (!q || q.length < 2) { return; }
  const status = document.getElementById('hosp-search-status');
  const results = document.getElementById('hosp-results');
  const panel = document.getElementById('hosp-edit-panel');
  status.textContent = 'Searching…';
  results.innerHTML = '';
  panel.innerHTML = '';
  selectedHosp = null;
  try {
    const res = await fetch(\`/api/admin/hospitals/search?q=\${encodeURIComponent(q)}\`, {
      headers: { Authorization: 'Bearer ' + secret },
    });
    if (!res.ok) { status.textContent = 'Error: ' + res.status; return; }
    hospSearchResults = await res.json();
    status.textContent = hospSearchResults.length === 0 ? '' : hospSearchResults.length + ' hospital(s) found';
    renderHospResults();
  } catch (err) {
    status.textContent = 'Search failed. Try again.';
  }
}

function renderHospResults() {
  const results = document.getElementById('hosp-results');
  if (hospSearchResults.length === 0) {
    results.innerHTML = '<div class="no-results">No hospitals found. Try a different search.</div>';
    return;
  }
  results.innerHTML = hospSearchResults.map((h, i) => {
    const badge = h.hasAdminOverride ? '<span class="hosp-override-badge">Admin Override</span>' : '';
    const idLabel = h.osmId || ('CMS: ' + h.cmsId);
    const coordStr = (h.latitude != null && h.longitude != null)
      ? \`\${Number(h.latitude).toFixed(5)}, \${Number(h.longitude).toFixed(5)}\`
      : 'No coordinates';
    const phoneStr = h.phone || 'No phone';
    return \`<div class="hosp-result-item" id="hosp-item-\${i}" onclick="selectHospital(\${i})">
      <div>
        <div class="hosp-result-name">\${escHtml(h.name)}</div>
        <div class="hosp-result-meta">\${escHtml(idLabel)} &nbsp;·&nbsp; \${escHtml(phoneStr)} &nbsp;·&nbsp; \${escHtml(coordStr)}</div>
      </div>
      \${badge}
    </div>\`;
  }).join('');
}

function selectHospital(idx) {
  document.querySelectorAll('.hosp-result-item').forEach(el => el.classList.remove('selected'));
  const item = document.getElementById(\`hosp-item-\${idx}\`);
  if (item) item.classList.add('selected');
  selectedHosp = hospSearchResults[idx];
  renderHospEditForm();
}

function renderHospEditForm() {
  const panel = document.getElementById('hosp-edit-panel');
  if (!selectedHosp) { panel.innerHTML = ''; return; }
  const h = selectedHosp;
  const isCmsOnly = !h.osmId;
  const phoneHint = isCmsOnly
    ? 'Saved directly to CMS record. Leave blank to clear.'
    : 'Leave blank to clear the override and fall back to CMS data.';
  const coordHint = isCmsOnly
    ? 'Saved directly to CMS record. Leave blank to clear.'
    : 'Leave blank to clear the coordinate override.';
  panel.innerHTML = \`<div class="hosp-edit-form">
    <h4>Editing: \${escHtml(h.name)}</h4>
    <div class="form-row">
      <label>Phone Number</label>
      <input type="text" id="edit-phone" value="\${escAttr(h.phone || '')}" placeholder="+1 (555) 000-0000" />
      <div class="form-hint">\${phoneHint}</div>
    </div>
    <div class="form-row">
      <label>Latitude</label>
      <input type="number" id="edit-lat" step="any" value="\${h.latitude != null ? h.latitude : ''}" placeholder="e.g. 37.77493" />
    </div>
    <div class="form-row">
      <label>Longitude</label>
      <input type="number" id="edit-lon" step="any" value="\${h.longitude != null ? h.longitude : ''}" placeholder="e.g. -122.41942" />
      <div class="form-hint">\${coordHint}</div>
    </div>
    <div class="form-actions">
      <button class="btn-save-hosp" id="hosp-save-btn" onclick="saveHospitalOverride()">Save Changes</button>
      <span class="hosp-save-status" id="hosp-save-status"></span>
    </div>
  </div>\`;
}

async function saveHospitalOverride() {
  if (!selectedHosp) return;
  const btn = document.getElementById('hosp-save-btn');
  const status = document.getElementById('hosp-save-status');
  btn.disabled = true;
  status.textContent = 'Saving…';
  status.className = 'hosp-save-status';

  const phoneVal = document.getElementById('edit-phone').value.trim();
  const latVal = document.getElementById('edit-lat').value.trim();
  const lonVal = document.getElementById('edit-lon').value.trim();

  const body = {
    phone: phoneVal || null,
    latitude: latVal !== '' ? parseFloat(latVal) : null,
    longitude: lonVal !== '' ? parseFloat(lonVal) : null,
  };

  try {
    const url = selectedHosp.osmId
      ? \`/api/admin/hospitals/\${encodeURIComponent(selectedHosp.osmId)}\`
      : \`/api/admin/hospitals/cms/\${encodeURIComponent(selectedHosp.cmsId)}\`;
    const res = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + secret },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Server error ' + res.status);
    }
    const data = await res.json();
    selectedHosp.phone = data.phone;
    selectedHosp.latitude = data.latitude;
    selectedHosp.longitude = data.longitude;
    selectedHosp.hasAdminOverride = !!selectedHosp.osmId;
    const key = selectedHosp.osmId || selectedHosp.cmsId;
    const idx = hospSearchResults.findIndex(h => (h.osmId || h.cmsId) === key);
    if (idx !== -1) hospSearchResults[idx] = { ...selectedHosp };
    renderHospResults();
    selectHospital(idx !== -1 ? idx : 0);
    const newStatus = document.getElementById('hosp-save-status');
    if (newStatus) { newStatus.textContent = '✓ Saved successfully'; newStatus.className = 'hosp-save-status ok'; }
  } catch (err) {
    status.textContent = 'Error: ' + err.message;
    status.className = 'hosp-save-status err';
  } finally {
    const saveBtn = document.getElementById('hosp-save-btn');
    if (saveBtn) saveBtn.disabled = false;
  }
}

init();
</script>
</body>
</html>`);
});

export default router;
