// Read-only Reports surface for the inline admin dashboard (admin-ui.ts).
// Exports plain string fragments. The browser script deliberately avoids
// backticks and "${" so it is safe inside the host TypeScript template string.

export const REPORTS_STYLE = `
  .tab .rp-count{display:none;margin-left:6px;font-size:10px;font-weight:700;padding:1px 6px;border-radius:9px;background:#c0392b;color:#fff;vertical-align:1px}
  .btn .rp-count{display:none;margin-left:6px;font-size:10px;font-weight:700;padding:1px 6px;border-radius:9px;background:#c0392b;color:#fff}
  .rp-toolbar{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:12px}
  .rp-filters{display:flex;gap:4px;flex-wrap:wrap}
  .rp-filter{padding:5px 11px;border-radius:14px;border:1px solid #1e3352;background:transparent;color:#94a3b8;font-size:12px;font-weight:600}
  .rp-filter:hover{border-color:#c0392b;color:#e2e8f0}
  .rp-filter.active{background:#c0392b22;border-color:#c0392b;color:#f1f5f9}
  .rp-filter .n{opacity:.7;margin-left:4px;font-weight:500}
  .rp-toolbar-right{margin-left:auto;display:flex;gap:10px;align-items:center}
  .rp-meta{font-size:11px;color:#64748b}
  .rp-banner{display:none;font-size:12px;padding:8px 12px;border-radius:6px;margin-bottom:12px;background:#78350f22;border:1px solid #b4530955;color:#fbbf24}
  .rp-tz{font-size:11px;color:#475569;margin-bottom:10px}
  .rp-list{display:flex;flex-direction:column;gap:10px}
  .rp-card{background:#0a1524;border:1px solid #1e3352;border-left:3px solid #475569;border-radius:8px;padding:12px 14px}
  .rp-card.s-pending{border-left-color:#c0392b}
  .rp-card.s-resolved{border-left-color:#16a34a}
  .rp-card.s-dismissed{border-left-color:#64748b;opacity:.8}
  .rp-top{display:flex;flex-wrap:wrap;gap:8px;align-items:baseline}
  .rp-hosp{font-size:14px;font-weight:700;color:#f1f5f9;word-break:break-word}
  .rp-hid{font-size:11px;color:#64748b;font-family:ui-monospace,Menlo,monospace;word-break:break-all}
  .rp-status{margin-left:auto;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;padding:2px 7px;border-radius:3px;background:#1e3352;color:#94a3b8}
  .rp-status.s-pending{background:#c0392b22;color:#f87171}
  .rp-status.s-resolved{background:#14532d44;color:#4ade80}
  .rp-row{display:flex;flex-wrap:wrap;gap:6px 14px;margin-top:6px;font-size:12px;color:#94a3b8}
  .rp-issue{font-weight:700;color:#fbbf24}
  .rp-notes{margin-top:8px;font-size:13px;color:#cbd5e1;white-space:pre-wrap;word-break:break-word;background:#0d1b2e;border-radius:6px;padding:8px 10px}
  .rp-notes.none{color:#475569;font-style:italic}
  .rp-state{padding:40px 16px;text-align:center;font-size:14px;color:#475569}
  .rp-state.err{color:#fca5a5}
  .rp-skel{height:86px;border-radius:8px;background:#0a1524;border:1px solid #1e3352;animation:rpPulse 1.2s ease-in-out infinite}
  @keyframes rpPulse{0%,100%{opacity:.5}50%{opacity:1}}
  @media (max-width:700px){
    .rp-toolbar-right{margin-left:0;width:100%;justify-content:space-between;flex-wrap:wrap}
    body.admin-reports-mode .search-panel{display:none}
    body.admin-reports-mode .edit-area{min-width:0}
    body.admin-reports-mode .tabs{overflow-x:auto}
    body.admin-reports-mode .tab{white-space:nowrap}
    body.admin-reports-mode .header{flex-wrap:wrap}
    body.admin-reports-mode .header-right{width:100%;margin-left:0;flex-wrap:wrap}
  }
`;

export const REPORTS_HEADER_BUTTON = `<button class="btn btn-outline btn-sm" onclick="switchTab('reports')">Reports<span class="rp-count" id="rp-count-header"></span></button>`;

export const REPORTS_TAB = `<div class="tab" id="tab-reports" onclick="switchTab('reports')">Reports<span class="rp-count" id="rp-count-tab"></span></div>`;

export const REPORTS_CONTENT = `
      <div class="tab-content" id="content-reports">
        <div class="rp-toolbar">
          <div class="rp-filters" role="group" aria-label="Filter reports by status">
            <button type="button" class="rp-filter active" data-filter="all" onclick="reportsSetFilter('all')">All<span class="n" id="rp-n-all"></span></button>
            <button type="button" class="rp-filter" data-filter="pending" onclick="reportsSetFilter('pending')">Pending<span class="n" id="rp-n-pending"></span></button>
            <button type="button" class="rp-filter" data-filter="resolved" onclick="reportsSetFilter('resolved')">Resolved<span class="n" id="rp-n-resolved"></span></button>
            <button type="button" class="rp-filter" data-filter="dismissed" onclick="reportsSetFilter('dismissed')">Dismissed<span class="n" id="rp-n-dismissed"></span></button>
          </div>
          <div class="rp-toolbar-right">
            <span class="rp-meta" id="rp-updated" aria-live="polite"></span>
            <button type="button" class="btn btn-outline btn-sm" id="rp-refresh" onclick="reportsRefresh()">Refresh</button>
          </div>
        </div>
        <div class="rp-banner" id="rp-banner" role="alert"></div>
        <div class="rp-tz" id="rp-tz"></div>
        <div id="rp-body"></div>
      </div>
`;

export const REPORTS_SCRIPT = `
// ── Reports (read-only) ───────────────────────────────────────────────────────
var RP_ISSUE_LABELS = {
  wrong_name: 'Wrong Name', wrong_address: 'Wrong Address', wrong_phone: 'Wrong Phone',
  permanently_closed: 'Permanently Closed', not_a_hospital: 'Not a Hospital',
  wrong_specialty: 'Wrong Specialty', other: 'Other'
};
var RP_POLL_MS = 30000;
var rpState = { session: 0, active: false, timer: null, inflight: null, data: null, error: null, loadedAt: null, filter: 'all' };

function rpTzLabel() {
  var name = '';
  try { name = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (_) {}
  var off = -new Date().getTimezoneOffset();
  var sign = off >= 0 ? '+' : '-';
  var a = Math.abs(off);
  var utc = 'UTC' + sign + String(Math.floor(a / 60)).padStart(2, '0') + ':' + String(a % 60).padStart(2, '0');
  return name ? name + ' (' + utc + ')' : utc;
}
function rpFmt(iso) {
  if (iso == null || iso === '') return 'Unknown time';
  var d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso == null ? 'Unknown time' : iso);
  try {
    return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit', timeZoneName: 'short' });
  } catch (_) { return d.toString(); }
}
function rpEl(tag, cls, text) {
  var e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = String(text);
  return e;
}
function rpStatusKey(s) { return (s === 'pending' || s === 'resolved' || s === 'dismissed') ? s : 'other'; }

function reportsStart() {
  reportsStop();
  rpState.session += 1;
  rpState.active = true;
  rpState.data = null; rpState.error = null; rpState.loadedAt = null;
  rpRenderCounts();
  rpRender();
  reportsRefresh();
  rpSchedule();
}
function reportsStop() {
  rpState.active = false;
  rpState.session += 1;
  if (rpState.timer) { clearInterval(rpState.timer); rpState.timer = null; }
  rpState.inflight = null;
  rpState.data = null; rpState.error = null; rpState.loadedAt = null;
  rpRenderCounts();
  var body = document.getElementById('rp-body');
  if (body) body.textContent = '';
}
function rpSchedule() {
  if (rpState.timer) { clearInterval(rpState.timer); rpState.timer = null; }
  if (!rpState.active || document.visibilityState !== 'visible') return;
  rpState.timer = setInterval(function () {
    if (rpState.active && document.visibilityState === 'visible') reportsRefresh();
  }, RP_POLL_MS);
}
document.addEventListener('visibilitychange', function () {
  if (!rpState.active) return;
  if (document.visibilityState === 'visible') { reportsRefresh(); rpSchedule(); }
  else if (rpState.timer) { clearInterval(rpState.timer); rpState.timer = null; }
});

function reportsRefresh() {
  if (!rpState.active || !TOKEN) return Promise.resolve();
  if (rpState.inflight && rpState.inflight.session === rpState.session) return rpState.inflight.promise;
  var session = rpState.session;
  var btn = document.getElementById('rp-refresh');
  if (btn) { btn.disabled = true; btn.textContent = 'Refreshing...'; }
  if (!rpState.data) rpRender();
  var p = apiFetch('/api/admin/reports', { cache: 'no-store' })
    .then(function (rows) {
      if (session !== rpState.session || !rpState.active) return;
      if (!Array.isArray(rows)) throw new Error('Unexpected response format');
      rows = rows.slice().sort(function (a, b) {
        var ta = new Date(a && a.submittedAt).getTime() || 0;
        var tb = new Date(b && b.submittedAt).getTime() || 0;
        return tb - ta || ((b && b.id) || 0) - ((a && a.id) || 0);
      });
      rpState.data = rows; rpState.error = null; rpState.loadedAt = new Date();
    })
    .catch(function (e) {
      if (session !== rpState.session || !rpState.active) return;
      rpState.error = (e && e.message) ? e.message : 'Request failed';
    })
    .then(function () {
      if (session !== rpState.session) return;
      rpState.inflight = null;
      var b = document.getElementById('rp-refresh');
      if (b) { b.disabled = false; b.textContent = 'Refresh'; }
      rpRenderCounts();
      rpRender();
    });
  rpState.inflight = { session: session, promise: p };
  return p;
}

function reportsSetFilter(f) {
  rpState.filter = f;
  document.querySelectorAll('.rp-filter').forEach(function (b) {
    b.classList.toggle('active', b.getAttribute('data-filter') === f);
  });
  rpRender();
}
function reportsOnShow() { reportsRefresh(); }

function rpRenderCounts() {
  var c = { all: 0, pending: 0, resolved: 0, dismissed: 0 };
  var have = Array.isArray(rpState.data);
  if (have) rpState.data.forEach(function (r) {
    c.all++; var k = rpStatusKey(r && r.status); if (c[k] != null) c[k]++;
  });
  ['all', 'pending', 'resolved', 'dismissed'].forEach(function (k) {
    var el = document.getElementById('rp-n-' + k);
    if (el) el.textContent = have ? String(c[k]) : '';
  });
  ['rp-count-header', 'rp-count-tab'].forEach(function (id) {
    var el = document.getElementById(id);
    if (!el) return;
    if (have && c.pending > 0) {
      el.textContent = String(c.pending);
      el.title = c.pending + ' pending report' + (c.pending === 1 ? '' : 's');
      el.style.display = 'inline-block';
    } else { el.textContent = ''; el.style.display = 'none'; }
  });
}

function rpRender() {
  var body = document.getElementById('rp-body');
  var banner = document.getElementById('rp-banner');
  var upd = document.getElementById('rp-updated');
  var tz = document.getElementById('rp-tz');
  if (!body) return;
  if (tz) tz.textContent = 'Times shown in your local time zone: ' + rpTzLabel();
  if (upd) upd.textContent = rpState.loadedAt ? 'Updated ' + rpState.loadedAt.toLocaleTimeString() + ' - auto-refresh every 30s' : '';
  body.textContent = '';

  var have = Array.isArray(rpState.data);
  if (banner) {
    if (rpState.error && have) {
      banner.textContent = 'Could not refresh reports (' + rpState.error + '). Showing the last loaded list, which may be out of date.';
      banner.style.display = 'block';
    } else { banner.textContent = ''; banner.style.display = 'none'; }
  }

  if (!have) {
    if (rpState.error) {
      var box = rpEl('div', 'rp-state err');
      box.appendChild(rpEl('p', null, 'Reports could not be loaded: ' + rpState.error));
      var retry = rpEl('button', 'btn btn-outline btn-sm', 'Try again');
      retry.type = 'button'; retry.style.marginTop = '12px';
      retry.onclick = function () { reportsRefresh(); };
      box.appendChild(retry);
      body.appendChild(box);
    } else {
      var sk = rpEl('div', 'rp-list');
      sk.setAttribute('aria-label', 'Loading reports');
      for (var i = 0; i < 3; i++) sk.appendChild(rpEl('div', 'rp-skel'));
      body.appendChild(sk);
    }
    return;
  }

  var f = rpState.filter;
  var rows = f === 'all' ? rpState.data : rpState.data.filter(function (r) { return r && r.status === f; });
  if (!rows.length) {
    var msg = rpState.data.length === 0 ? 'No reports have been submitted yet.' : 'No ' + f + ' reports.';
    body.appendChild(rpEl('div', 'rp-state', msg));
    return;
  }

  var list = rpEl('div', 'rp-list');
  rows.forEach(function (r) {
    if (!r) return;
    var sk = rpStatusKey(r.status);
    var card = rpEl('div', 'rp-card s-' + sk);
    var top = rpEl('div', 'rp-top');
    top.appendChild(rpEl('span', 'rp-hosp', r.hospitalName || 'Unnamed hospital'));
    top.appendChild(rpEl('span', 'rp-hid', 'ID ' + (r.osmId == null ? 'unknown' : r.osmId)));
    top.appendChild(rpEl('span', 'rp-status s-' + sk, r.status == null ? 'unknown' : r.status));
    card.appendChild(top);

    var row = rpEl('div', 'rp-row');
    row.appendChild(rpEl('span', 'rp-issue', RP_ISSUE_LABELS[r.issueType] || (r.issueType == null ? 'Unknown issue' : r.issueType)));
    var when = rpEl('span', null, 'Submitted ' + rpFmt(r.submittedAt));
    if (r.submittedAt) when.title = String(r.submittedAt);
    row.appendChild(when);
    if (r.resolvedAt) row.appendChild(rpEl('span', null, 'Closed ' + rpFmt(r.resolvedAt)));
    row.appendChild(rpEl('span', null, 'Report #' + r.id));
    card.appendChild(row);

    var hasNotes = r.notes != null && String(r.notes).trim() !== '';
    card.appendChild(rpEl('div', 'rp-notes' + (hasNotes ? '' : ' none'), hasNotes ? r.notes : 'No notes provided'));
    list.appendChild(card);
  });
  body.appendChild(list);
}
`;
