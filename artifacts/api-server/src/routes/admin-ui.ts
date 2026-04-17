import { Router } from "express";

const router = Router();

const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY","DC","PR","GU","VI","AS","MP",
];

const STATE_OPTIONS = US_STATES.map(
  (s) => `<option value="${s}">${s}</option>`,
).join("");

const SERVICE_LINES = [
  "General Acute Care",
  "Critical Access",
  "Psychiatric",
  "Long-Term Care",
  "Rehabilitation",
  "Children's",
  "Cancer",
  "Women's",
];

const SERVICE_LINE_OPTIONS = [
  `<option value="">— none —</option>`,
  ...SERVICE_LINES.map((s) => `<option value="${s}">${s}</option>`),
].join("");


function buildPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ER Choices — Admin</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#0d1b2e;color:#e2e8f0;min-height:100vh}
  a{color:#c0392b}
  button{cursor:pointer;font:inherit}
  input,select,textarea{font:inherit;background:#0a1524;border:1px solid #1e3352;color:#e2e8f0;border-radius:6px;padding:7px 10px;width:100%}
  input:focus,select:focus,textarea:focus{outline:none;border-color:#c0392b;box-shadow:0 0 0 2px #c0392b33}
  textarea{resize:vertical;min-height:60px}
  select option{background:#0a1524}

  /* ── Layout ── */
  #login-screen{display:flex;align-items:center;justify-content:center;min-height:100vh}
  #app{display:none;flex-direction:column;height:100vh}

  /* ── Header ── */
  .header{background:#09121f;border-bottom:1px solid #1e3352;padding:12px 20px;display:flex;align-items:center;gap:12px;flex-shrink:0}
  .logo{width:34px;height:34px;background:#c0392b;border-radius:8px;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:12px;color:#fff;flex-shrink:0}
  .header-title{font-size:17px;font-weight:700;color:#f1f5f9}
  .header-sub{font-size:11px;color:#475569;margin-top:1px}
  .header-right{margin-left:auto;display:flex;gap:8px}
  .btn{padding:7px 14px;border-radius:6px;border:none;font-size:13px;font-weight:600;transition:opacity .15s}
  .btn-primary{background:#c0392b;color:#fff}
  .btn-primary:hover{opacity:.85}
  .btn-outline{background:transparent;border:1px solid #1e3352;color:#94a3b8}
  .btn-outline:hover{border-color:#c0392b;color:#e2e8f0}
  .btn-sm{padding:5px 10px;font-size:12px}
  .btn-danger{background:#7f1d1d;color:#fca5a5;border:1px solid #991b1b}
  .btn-danger:hover{background:#991b1b}

  /* ── Main area (3 cols) ── */
  .main{display:flex;flex:1;overflow:hidden}

  /* ── Search panel (left) ── */
  .search-panel{width:300px;flex-shrink:0;border-right:1px solid #1e3352;display:flex;flex-direction:column;overflow:hidden}
  .panel-head{padding:14px 16px;border-bottom:1px solid #1e3352;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#475569}
  .search-box-wrap{padding:10px 12px;border-bottom:1px solid #1e3352}
  #search-input{width:100%}
  .results-list{flex:1;overflow-y:auto}
  .result-item{padding:10px 14px;border-bottom:1px solid #0d1b2e;cursor:pointer;transition:background .12s}
  .result-item:hover{background:#152236}
  .result-item.active{background:#1a2c40;border-left:3px solid #c0392b}
  .result-name{font-size:13px;font-weight:600;color:#f1f5f9}
  .result-sub{font-size:11px;color:#64748b;margin-top:2px}
  .result-badge{display:inline-block;font-size:10px;padding:1px 5px;border-radius:3px;margin-top:4px;background:#1e3352;color:#94a3b8}
  .result-badge.admin{background:#c0392b22;color:#c0392b}

  /* ── Edit + Add panels (right) ── */
  .edit-area{flex:1;overflow-y:auto;display:flex;flex-direction:column}
  .tabs{display:flex;border-bottom:1px solid #1e3352;flex-shrink:0}
  .tab{padding:10px 20px;font-size:13px;font-weight:600;color:#64748b;cursor:pointer;border-bottom:2px solid transparent;transition:color .15s}
  .tab.active{color:#c0392b;border-bottom-color:#c0392b}
  .tab-content{display:none;padding:20px;flex:1}
  .tab-content.active{display:block}

  /* ── Form ── */
  .form-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  .form-grid.one{grid-template-columns:1fr}
  .form-grid.three{grid-template-columns:1fr 1fr 1fr}
  .field{display:flex;flex-direction:column;gap:5px}
  .field.full{grid-column:1/-1}
  label.field-label{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#475569}
  .section-title{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#c0392b;margin:20px 0 10px;padding-bottom:6px;border-bottom:1px solid #1e3352;grid-column:1/-1}
  .spec-row{display:flex;flex-wrap:wrap;gap:10px;padding:8px 0;grid-column:1/-1}
  .spec-cb{display:flex;align-items:center;gap:5px;font-size:13px;color:#cbd5e1;cursor:pointer;white-space:nowrap}
  .spec-cb input{width:auto;padding:0}
  .form-actions{display:flex;gap:10px;margin-top:20px;grid-column:1/-1}
  .status-msg{font-size:13px;padding:8px 12px;border-radius:6px;margin-top:10px;display:none;grid-column:1/-1}
  .status-msg.ok{background:#14532d22;border:1px solid #16a34a55;color:#4ade80}
  .status-msg.err{background:#7f1d1d22;border:1px solid #991b1b55;color:#fca5a5}

  /* ── Empty state ── */
  .empty-state{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#334155;text-align:center;padding:40px}
  .empty-state svg{margin-bottom:16px;opacity:.3}
  .empty-state p{font-size:14px}

  /* ── Login ── */
  .login-card{background:#152236;border:1px solid #1e3352;border-radius:14px;padding:32px;width:360px}
  .login-logo{width:48px;height:48px;background:#c0392b;border-radius:12px;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:16px;color:#fff;margin:0 auto 16px}
  .login-title{text-align:center;font-size:20px;font-weight:700;margin-bottom:4px}
  .login-sub{text-align:center;font-size:12px;color:#475569;margin-bottom:24px}
  .login-field{margin-bottom:16px}
  .login-label{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#475569;display:block;margin-bottom:6px}
  .login-err{color:#fca5a5;font-size:12px;margin-top:8px;display:none}

  /* ── Scrollbar ── */
  ::-webkit-scrollbar{width:6px}
  ::-webkit-scrollbar-track{background:#09121f}
  ::-webkit-scrollbar-thumb{background:#1e3352;border-radius:3px}
</style>
</head>
<body>

<!-- LOGIN -->
<div id="login-screen">
  <div class="login-card">
    <div class="login-logo">ER</div>
    <div class="login-title">Admin Dashboard</div>
    <div class="login-sub">ER Choices — Hospital Database</div>
    <div class="login-field">
      <label class="login-label" for="token-input">Admin Token</label>
      <input type="password" id="token-input" placeholder="Bearer token" autocomplete="current-password">
    </div>
    <button class="btn btn-primary" style="width:100%;padding:10px" onclick="doLogin()">Sign In</button>
    <div class="login-err" id="login-err">Incorrect token — please try again.</div>
  </div>
</div>

<!-- APP -->
<div id="app">
  <div class="header">
    <div class="logo">ER</div>
    <div>
      <div class="header-title">ER Choices Admin</div>
      <div class="header-sub">Hospital Database Manager</div>
    </div>
    <div class="header-right">
      <button class="btn btn-outline btn-sm" onclick="switchTab('add')">+ Add Hospital</button>
      <button class="btn btn-outline btn-sm" onclick="doLogout()">Sign Out</button>
    </div>
  </div>

  <div class="main">
    <!-- Search sidebar -->
    <div class="search-panel">
      <div class="panel-head">Search Hospitals</div>
      <div class="search-box-wrap">
        <input type="text" id="search-input" placeholder="Type hospital name…" oninput="onSearch(this.value)">
      </div>
      <div class="results-list" id="results-list">
        <div class="empty-state" style="padding:30px 16px">
          <p>Type at least 2 characters to search</p>
        </div>
      </div>
    </div>

    <!-- Edit / Add area -->
    <div class="edit-area">
      <div class="tabs">
        <div class="tab active" id="tab-edit" onclick="switchTab('edit')">Edit Hospital</div>
        <div class="tab" id="tab-add" onclick="switchTab('add')">Add Hospital</div>
      </div>

      <!-- EDIT TAB -->
      <div class="tab-content active" id="content-edit">
        <div class="empty-state" id="edit-empty">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
            <polyline points="17 21 17 13 7 13 7 21"/>
            <polyline points="7 3 7 8 15 8"/>
          </svg>
          <p>Select a hospital from the search results to edit it</p>
        </div>
        <form id="edit-form" style="display:none" onsubmit="submitEdit(event)">
          <div class="form-grid">
            <div class="section-title">Identity</div>
            <div class="field full">
              <label class="field-label">Hospital Name *</label>
              <input type="text" name="hospitalName" required>
            </div>
            <div class="field">
              <label class="field-label">Address</label>
              <input type="text" name="address">
            </div>
            <div class="field">
              <label class="field-label">City</label>
              <input type="text" name="city">
            </div>
            <div class="field">
              <label class="field-label">State *</label>
              <select name="state" required>
                <option value="">— select —</option>
                ${STATE_OPTIONS}
              </select>
            </div>
            <div class="field">
              <label class="field-label">ZIP</label>
              <input type="text" name="zip">
            </div>
            <div class="field">
              <label class="field-label">Phone</label>
              <input type="text" name="phone" placeholder="(555) 555-5555">
            </div>

            <div class="section-title">Coordinates</div>
            <div class="field">
              <label class="field-label">Latitude</label>
              <input type="number" name="latitude" step="any" placeholder="e.g. 40.7128">
            </div>
            <div class="field">
              <label class="field-label">Longitude</label>
              <input type="number" name="longitude" step="any" placeholder="e.g. -74.0060">
            </div>

            <div class="section-title">Designations</div>
            <div class="field full">
              <label class="field-label">Actual Designation</label>
              <input type="text" name="actualDesignation" placeholder="e.g. Level II Trauma Center; Acute Care Hospital">
            </div>
            <div class="field">
              <label class="field-label">Service Line</label>
              <select name="serviceLine">
                ${SERVICE_LINE_OPTIONS}
              </select>
            </div>
            <div class="field">
              <label class="field-label">Stroke Designation</label>
              <input type="text" name="strokeDesignation" placeholder="e.g. Comprehensive Stroke Center">
            </div>
            <div class="field">
              <label class="field-label">Burn Designation</label>
              <input type="text" name="burnDesignation" placeholder="e.g. Verified Burn Center">
            </div>
            <div class="field">
              <label class="field-label">PCI / STEMI Capability</label>
              <input type="text" name="pciCapability" placeholder="e.g. PCI-capable 24/7">
            </div>
            <div class="field">
              <label class="field-label">Staffed Beds</label>
              <input type="number" name="beds" min="0" step="1" placeholder="e.g. 250">
            </div>
            <div class="field" style="align-self:end">
              <label class="spec-cb" style="font-size:13px;color:#cbd5e1">
                <input type="checkbox" name="helipad"> Helipad on site
              </label>
            </div>

            <div class="section-title">Specialties</div>
            <div class="field full">
              <label class="field-label">Specialties (comma-separated — preserves all existing values)</label>
              <textarea name="specialties" rows="3" placeholder="e.g. Trauma, Stroke, Burn"></textarea>
            </div>

            <div class="status-msg" id="edit-status"></div>
            <div class="form-actions">
              <button type="submit" class="btn btn-primary">Save Changes</button>
              <button type="button" class="btn btn-outline" onclick="clearEdit()">Clear</button>
            </div>
          </div>
        </form>
      </div>

      <!-- ADD TAB -->
      <div class="tab-content" id="content-add">
        <form id="add-form" onsubmit="submitAdd(event)">
          <div class="form-grid">
            <div class="section-title">Identity</div>
            <div class="field full">
              <label class="field-label">Hospital Name *</label>
              <input type="text" name="hospitalName" required placeholder="Official hospital name">
            </div>
            <div class="field">
              <label class="field-label">Address</label>
              <input type="text" name="address">
            </div>
            <div class="field">
              <label class="field-label">City</label>
              <input type="text" name="city">
            </div>
            <div class="field">
              <label class="field-label">State *</label>
              <select name="state" required>
                <option value="">— select —</option>
                ${STATE_OPTIONS}
              </select>
            </div>
            <div class="field">
              <label class="field-label">ZIP</label>
              <input type="text" name="zip">
            </div>
            <div class="field">
              <label class="field-label">Phone</label>
              <input type="text" name="phone" placeholder="(555) 555-5555">
            </div>

            <div class="section-title">Coordinates</div>
            <div class="field">
              <label class="field-label">Latitude</label>
              <input type="number" name="latitude" step="any" placeholder="e.g. 40.7128">
            </div>
            <div class="field">
              <label class="field-label">Longitude</label>
              <input type="number" name="longitude" step="any" placeholder="e.g. -74.0060">
            </div>

            <div class="section-title">Designations</div>
            <div class="field full">
              <label class="field-label">Actual Designation</label>
              <input type="text" name="actualDesignation" placeholder="e.g. Level II Trauma Center; Acute Care Hospital">
            </div>
            <div class="field">
              <label class="field-label">Service Line</label>
              <select name="serviceLine">
                ${SERVICE_LINE_OPTIONS}
              </select>
            </div>
            <div class="field">
              <label class="field-label">Stroke Designation</label>
              <input type="text" name="strokeDesignation">
            </div>
            <div class="field">
              <label class="field-label">Burn Designation</label>
              <input type="text" name="burnDesignation">
            </div>
            <div class="field">
              <label class="field-label">PCI / STEMI Capability</label>
              <input type="text" name="pciCapability">
            </div>
            <div class="field">
              <label class="field-label">Staffed Beds</label>
              <input type="number" name="beds" min="0" step="1">
            </div>
            <div class="field" style="align-self:end">
              <label class="spec-cb" style="font-size:13px;color:#cbd5e1">
                <input type="checkbox" name="helipad"> Helipad on site
              </label>
            </div>

            <div class="section-title">Specialties</div>
            <div class="field full">
              <label class="field-label">Specialties (comma-separated)</label>
              <textarea name="specialties" rows="3" placeholder="e.g. Trauma, Stroke, Burn"></textarea>
            </div>

            <div class="status-msg" id="add-status"></div>
            <div class="form-actions">
              <button type="submit" class="btn btn-primary">Create Hospital</button>
              <button type="button" class="btn btn-outline" onclick="document.getElementById('add-form').reset()">Clear</button>
            </div>
          </div>
        </form>
      </div>
    </div>
  </div>
</div>

<script>
let TOKEN = '';
let selectedHospitalId = null;
let searchTimer = null;

// ── Auth ──────────────────────────────────────────────────────────────────────
function doLogin() {
  const t = document.getElementById('token-input').value.trim();
  if (!t) return;
  TOKEN = t;
  // Verify token with a search call
  apiFetch('/api/admin/hospitals/search?q=test')
    .then(() => {
      document.getElementById('login-screen').style.display = 'none';
      document.getElementById('app').style.display = 'flex';
      document.getElementById('login-err').style.display = 'none';
    })
    .catch(() => {
      TOKEN = '';
      document.getElementById('login-err').style.display = 'block';
    });
}
function doLogout() {
  TOKEN = '';
  document.getElementById('app').style.display = 'none';
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('token-input').value = '';
}
document.getElementById('token-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') doLogin();
});

// ── API ───────────────────────────────────────────────────────────────────────
async function apiFetch(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: { 'Authorization': 'Bearer ' + TOKEN, 'Content-Type': 'application/json', ...(opts.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || ('HTTP ' + res.status));
  }
  return res.json();
}

// ── Search ────────────────────────────────────────────────────────────────────
function onSearch(val) {
  clearTimeout(searchTimer);
  if (val.length < 2) {
    document.getElementById('results-list').innerHTML =
      '<div class="empty-state" style="padding:30px 16px"><p>Type at least 2 characters to search</p></div>';
    return;
  }
  searchTimer = setTimeout(() => runSearch(val), 300);
}

async function runSearch(q) {
  const list = document.getElementById('results-list');
  list.innerHTML = '<div class="empty-state" style="padding:30px 16px"><p>Searching…</p></div>';
  try {
    const results = await apiFetch('/api/admin/hospitals/search?q=' + encodeURIComponent(q));
    if (!results.length) {
      list.innerHTML = '<div class="empty-state" style="padding:30px 16px"><p>No hospitals found</p></div>';
      return;
    }
    list.innerHTML = results.map(r => \`
      <div class="result-item" data-id="\${r.id}" onclick="selectHospital(\${r.id}, this)" data-hospital='\${JSON.stringify(r).replace(/'/g,"&apos;")}'>
        <div class="result-name">\${esc(r.name)}</div>
        <div class="result-sub">\${esc([r.city, r.state].filter(Boolean).join(', ') || r.state)}</div>
        <span class="result-badge \${r.source === 'admin' ? 'admin' : ''}">\${r.source === 'admin' ? 'Admin-created' : 'CMS'}</span>
      </div>
    \`).join('');
  } catch (e) {
    list.innerHTML = '<div class="empty-state" style="padding:30px 16px"><p style="color:#fca5a5">Error: ' + esc(e.message) + '</p></div>';
  }
}

function esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Select & populate edit form ───────────────────────────────────────────────
function selectHospital(id, el) {
  document.querySelectorAll('.result-item').forEach(i => i.classList.remove('active'));
  el.classList.add('active');
  selectedHospitalId = id;
  const h = JSON.parse(el.dataset.hospital);
  populateEditForm(h);
  switchTab('edit');
}

function populateEditForm(h) {
  const form = document.getElementById('edit-form');
  document.getElementById('edit-empty').style.display = 'none';
  form.style.display = 'block';

  const set = (name, val) => {
    const el = form.elements[name];
    if (!el) return;
    if (el.type === 'checkbox') { el.checked = !!val; }
    else { el.value = val ?? ''; }
  };

  set('hospitalName', h.name);
  set('address', h.address);
  set('city', h.city);
  set('state', h.state);
  set('zip', h.zip);
  set('phone', h.phone);
  set('latitude', h.latitude);
  set('longitude', h.longitude);
  set('actualDesignation', h.actualDesignation);
  set('serviceLine', h.serviceLine);
  set('strokeDesignation', h.strokeDesignation);
  set('burnDesignation', h.burnDesignation);
  set('pciCapability', h.pciCapability);
  set('helipad', h.helipad);
  set('beds', h.beds);

  // Specialties textarea — pre-fill with all existing values preserved
  const specs = h.specialties ?? [];
  const specEl = form.elements['specialties'];
  if (specEl) specEl.value = specs.join(', ');

  hideStatus('edit-status');
}

function clearEdit() {
  selectedHospitalId = null;
  document.getElementById('edit-form').style.display = 'none';
  document.getElementById('edit-empty').style.display = 'flex';
  document.querySelectorAll('.result-item').forEach(i => i.classList.remove('active'));
}

// ── Submit edit ───────────────────────────────────────────────────────────────
async function submitEdit(e) {
  e.preventDefault();
  if (!selectedHospitalId) return;
  const form = e.target;
  const data = formToPayload(form);
  const btn = form.querySelector('button[type="submit"]');
  btn.disabled = true;
  btn.textContent = 'Saving…';
  try {
    await apiFetch('/api/admin/hospitals/' + selectedHospitalId, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
    showStatus('edit-status', 'Saved successfully!', true);
    // Refresh the result in the list
    const active = document.querySelector('.result-item.active');
    if (active) {
      const old = JSON.parse(active.dataset.hospital);
      active.dataset.hospital = JSON.stringify({ ...old, ...data, name: data.hospitalName ?? old.name });
      active.querySelector('.result-name').textContent = data.hospitalName ?? old.name;
    }
  } catch (err) {
    showStatus('edit-status', 'Error: ' + err.message, false);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save Changes';
  }
}

// ── Submit add ────────────────────────────────────────────────────────────────
async function submitAdd(e) {
  e.preventDefault();
  const form = e.target;
  const data = formToPayload(form);
  const btn = form.querySelector('button[type="submit"]');
  btn.disabled = true;
  btn.textContent = 'Creating…';
  try {
    const result = await apiFetch('/api/admin/hospitals', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    showStatus('add-status', 'Hospital created! CMS ID: ' + result.hospital.cmsId, true);
    form.reset();
  } catch (err) {
    showStatus('add-status', 'Error: ' + err.message, false);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Create Hospital';
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function formToPayload(form) {
  const fd = new FormData(form);
  const data = {};
  // Text/select fields
  [
    'hospitalName','address','city','state','zip','phone',
    'actualDesignation','serviceLine','strokeDesignation','burnDesignation','pciCapability',
  ].forEach(k => { data[k] = fd.get(k) || null; });
  // Numbers
  const lat = fd.get('latitude'); data.latitude = lat ? Number(lat) : null;
  const lon = fd.get('longitude'); data.longitude = lon ? Number(lon) : null;
  const beds = fd.get('beds'); data.beds = beds ? parseInt(beds, 10) : null;
  // Boolean checkbox
  data.helipad = form.elements['helipad']?.checked ?? false;
  // Specialties — free-text textarea, comma-separated, preserves any existing values
  const specRaw = (fd.get('specialties') ?? '').toString().trim();
  data.specialties = specRaw ? specRaw.split(',').map(s => s.trim()).filter(Boolean) : [];
  return data;
}

function showStatus(id, msg, ok) {
  const el = document.getElementById(id);
  el.textContent = msg;
  el.className = 'status-msg ' + (ok ? 'ok' : 'err');
  el.style.display = 'block';
  if (ok) setTimeout(() => { el.style.display = 'none'; }, 4000);
}
function hideStatus(id) {
  document.getElementById(id).style.display = 'none';
}

// ── Tab switching ─────────────────────────────────────────────────────────────
function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  document.getElementById('content-' + name).classList.add('active');
}
</script>
</body>
</html>`;
}

router.get("/admin-ui", (req, res) => {
  // Serve the inline admin dashboard HTML directly (no auth check on the HTML itself —
  // the token is entered in the UI and sent with every API request).
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.send(buildPage());
});

export default router;
