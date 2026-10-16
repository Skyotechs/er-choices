// "Browse by State" view for the inline admin dashboard (admin-ui.ts).
// Exports plain string fragments. The browser script deliberately avoids
// backticks and "${" so it is safe inside the host TypeScript template string.

export const BROWSE_STYLE = `
  .bs-toolbar{display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;margin-bottom:12px}
  .bs-field{display:flex;flex-direction:column;gap:5px;min-width:0}
  .bs-field select{width:auto;min-width:120px}
  .bs-toolbar-right{margin-left:auto;display:flex;gap:8px;align-items:center}
  .bs-summary{display:flex;flex-wrap:wrap;gap:6px 14px;align-items:baseline;font-size:12px;color:#94a3b8;margin-bottom:10px;min-height:18px}
  .bs-summary strong{color:#f1f5f9;font-size:14px}
  .bs-banner{display:none;font-size:12px;padding:8px 12px;border-radius:6px;margin-bottom:12px;background:#78350f22;border:1px solid #b4530955;color:#fbbf24}
  .bs-list{display:flex;flex-direction:column;border:1px solid #1e3352;border-radius:8px;overflow:hidden;background:#0a1524}
  .bs-list.busy{opacity:.6}
  button.bs-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px 12px;align-items:center;width:100%;text-align:left;background:transparent;border:none;border-bottom:1px solid #0d1b2e;color:inherit;padding:10px 14px}
  button.bs-row:last-child{border-bottom:none}
  button.bs-row:hover{background:#152236}
  button.bs-row:focus-visible{outline:2px solid #c0392b;outline-offset:-2px}
  button.bs-row.active{background:#1a2c40;box-shadow:inset 3px 0 0 #c0392b}
  .bs-main{min-width:0}
  .bs-name{font-size:13px;font-weight:600;color:#f1f5f9;word-break:break-word}
  .bs-row.inactive-row .bs-name{text-decoration:line-through;color:#94a3b8}
  .bs-row.inactive-row .bs-main{opacity:.65}
  .bs-meta{font-size:11px;color:#64748b;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .bs-tags{display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end}
  .bs-tags .result-badge{margin-top:0}
  .bs-id{font-size:10px;color:#475569;font-family:ui-monospace,Menlo,monospace}
  .bs-pager{display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between;margin-top:12px}
  .bs-pager-btns{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
  .bs-pager .btn:disabled{opacity:.4;cursor:not-allowed}
  .bs-pager input{width:64px;padding:5px 8px;font-size:12px}
  .bs-state{padding:40px 16px;text-align:center;font-size:14px;color:#475569}
  .bs-state.err{color:#fca5a5}
  .bs-skel{height:52px;border-bottom:1px solid #0d1b2e;animation:rpPulse 1.2s ease-in-out infinite;background:#0a1524}
  .bs-return{display:none;align-items:center;gap:10px;flex-wrap:wrap;font-size:12px;color:#94a3b8;background:#0a1524;border:1px solid #1e3352;border-left:3px solid #c0392b;border-radius:6px;padding:8px 12px;margin-bottom:14px}
  .bs-return strong{color:#f1f5f9}
  .bs-return .btn{margin-left:auto}
  .sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
  @media (max-width:700px){
    body.admin-browse-mode .search-panel{display:none}
    body.admin-browse-mode .edit-area{min-width:0}
    body.admin-browse-mode .tabs{overflow-x:auto}
    body.admin-browse-mode .tab{white-space:nowrap}
    body.admin-browse-mode .header{flex-wrap:wrap}
    body.admin-browse-mode .header-right{width:100%;margin-left:0;flex-wrap:wrap}
    .bs-toolbar-right{margin-left:0;width:100%}
    .bs-field{flex:1}
    .bs-field select{width:100%;min-width:0}
    button.bs-row{grid-template-columns:1fr}
    .bs-tags{justify-content:flex-start}
  }
`;

export const BROWSE_HEADER_BUTTON = `<button class="btn btn-outline btn-sm" onclick="switchTab('browse')">Browse by State</button>`;

export const BROWSE_TAB = `<div class="tab" id="tab-browse" role="button" tabindex="0" onclick="switchTab('browse')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();switchTab('browse')}">Browse by State</div>`;

export function browseContent(stateOptions: string): string {
  return `
      <div class="tab-content" id="content-browse">
        <div class="bs-toolbar">
          <div class="bs-field">
            <label class="field-label" for="bs-state">State</label>
            <select id="bs-state" onchange="bsSetState(this.value)">
              <option value="">Choose a state</option>
              ${stateOptions}
            </select>
          </div>
          <div class="bs-field">
            <label class="field-label" for="bs-status">Status</label>
            <select id="bs-status" onchange="bsSetStatus(this.value)">
              <option value="all">All statuses</option>
              <option value="active">Active only</option>
              <option value="inactive">Deactivated only</option>
            </select>
          </div>
          <div class="bs-field">
            <label class="field-label" for="bs-size">Per page</label>
            <select id="bs-size" onchange="bsSetPageSize(this.value)">
              <option value="25">25</option>
              <option value="50" selected>50</option>
              <option value="100">100</option>
            </select>
          </div>
          <div class="bs-toolbar-right">
            <button type="button" class="btn btn-outline btn-sm" id="bs-refresh" onclick="bsRefresh()" disabled>Refresh</button>
          </div>
        </div>
        <div class="bs-summary" id="bs-summary" aria-live="polite"></div>
        <div class="bs-banner" id="bs-banner" role="alert"></div>
        <div id="bs-body"></div>
        <div class="bs-pager" id="bs-pager" style="display:none">
          <span class="rp-meta" id="bs-page-label"></span>
          <div class="bs-pager-btns">
            <button type="button" class="btn btn-outline btn-sm" id="bs-first" onclick="bsGo(1)" aria-label="First page">First</button>
            <button type="button" class="btn btn-outline btn-sm" id="bs-prev" onclick="bsGo(bsState.page - 1)" aria-label="Previous page">Prev</button>
            <label class="sr-only" for="bs-jump">Go to page</label>
            <input type="number" id="bs-jump" min="1" step="1" onkeydown="if(event.key==='Enter'){bsGo(parseInt(this.value,10))}" onchange="bsGo(parseInt(this.value,10))">
            <button type="button" class="btn btn-outline btn-sm" id="bs-next" onclick="bsGo(bsState.page + 1)" aria-label="Next page">Next</button>
            <button type="button" class="btn btn-outline btn-sm" id="bs-last" onclick="bsGo(bsState.totalPages)" aria-label="Last page">Last</button>
          </div>
        </div>
      </div>
`;
}

export const BROWSE_RETURN_BAR = `
        <div class="bs-return" id="bs-return" role="region" aria-label="Browse by State context">
          <span id="bs-return-text"></span>
          <button type="button" class="btn btn-outline btn-sm" onclick="bsReturnToList()">Back to state list</button>
        </div>
`;

export const BROWSE_SCRIPT = `
// ── Browse by State ───────────────────────────────────────────────────────────
var BS_STATUS_LABELS = { all: 'all statuses', active: 'active', inactive: 'deactivated' };
var bsState = {
  session: 0, seq: 0, loading: false, state: '', status: 'all', page: 1, pageSize: 50,
  data: null, error: null, total: 0, totalPages: 0, loadedAt: null,
  fromBrowse: false, browseSelectedId: null, stale: false
};

function bsEl(tag, cls, text) {
  var e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = String(text);
  return e;
}

function bsStart() {
  bsState.session += 1;
  bsState.seq += 1;
  bsRender();
}
function bsStop() {
  bsState.session += 1;
  bsState.seq += 1;
  bsState.loading = false; bsState.state = ''; bsState.status = 'all'; bsState.page = 1; bsState.pageSize = 50;
  bsState.data = null; bsState.error = null; bsState.total = 0; bsState.totalPages = 0; bsState.loadedAt = null;
  bsState.fromBrowse = false; bsState.browseSelectedId = null; bsState.stale = false;
  var s = document.getElementById('bs-state'); if (s) s.value = '';
  var st = document.getElementById('bs-status'); if (st) st.value = 'all';
  var sz = document.getElementById('bs-size'); if (sz) sz.value = '50';
  bsRender();
  bsUpdateReturnBar();
}

function bsSetState(v) { bsState.seq += 1; bsState.loading = false; bsState.state = v || ''; bsState.page = 1; bsState.data = null; bsState.error = null; bsLoad(); }
function bsSetStatus(v) { bsState.status = (v === 'active' || v === 'inactive') ? v : 'all'; bsState.page = 1; bsState.data = null; bsLoad(); }
function bsSetPageSize(v) {
  var n = parseInt(v, 10); if (n !== 25 && n !== 100) n = 50;
  var firstIdx = (bsState.page - 1) * bsState.pageSize;
  bsState.pageSize = n; bsState.page = Math.floor(firstIdx / n) + 1; bsState.data = null; bsLoad();
}
function bsGo(p) {
  if (!bsState.state || bsState.loading) return;
  p = parseInt(p, 10);
  if (!isFinite(p) || p < 1) p = 1;
  if (bsState.totalPages > 0 && p > bsState.totalPages) p = bsState.totalPages;
  if (p === bsState.page && bsState.data) { bsRenderPager(); return; }
  bsState.page = p; bsState.data = null; bsLoad();
}
function bsRefresh() { if (bsState.state) bsLoad(); }
function bsOnShow() {
  if (bsState.state && (bsState.stale || (!bsState.data && !bsState.loading))) bsLoad();
  else bsRender();
}
function bsInvalidate() {
  if (!bsState.state) return;
  bsState.stale = true;
  var tab = document.getElementById('content-browse');
  if (tab && tab.classList.contains('active')) bsLoad();
}

function bsLoad() {
  if (!TOKEN || !bsState.state) { bsRender(); return; }
  var session = bsState.session;
  var seq = ++bsState.seq;
  bsState.loading = true;
  bsState.error = null;
  bsRender();
  var params = new URLSearchParams();
  params.set('state', bsState.state);
  params.set('page', String(bsState.page));
  params.set('pageSize', String(bsState.pageSize));
  params.set('status', bsState.status);
  apiFetch('/api/admin/hospitals/by-state?' + params.toString(), { cache: 'no-store' })
    .then(function (res) {
      if (session !== bsState.session || seq !== bsState.seq || !TOKEN) return;
      if (!res || !Array.isArray(res.hospitals)) throw new Error('Unexpected response format');
      var tp = Math.max(0, parseInt(res.totalPages, 10) || 0);
      if (tp > 0 && bsState.page > tp) { bsState.page = tp; bsLoad(); return; }
      bsState.data = res.hospitals;
      bsState.total = Math.max(0, parseInt(res.total, 10) || 0);
      bsState.totalPages = tp;
      bsState.page = Math.max(1, parseInt(res.page, 10) || bsState.page);
      bsState.loadedAt = new Date();
      bsState.stale = false;
      bsState.loading = false;
      bsRender();
    })
    .catch(function (e) {
      if (session !== bsState.session || seq !== bsState.seq || !TOKEN) return;
      bsState.loading = false;
      bsState.error = (e && e.message) ? e.message : 'Request failed';
      bsRender();
    });
}

function bsRangeText() {
  if (!bsState.total || !bsState.data) return '';
  var start = (bsState.page - 1) * bsState.pageSize + 1;
  var end = start + bsState.data.length - 1;
  return 'Showing ' + start + '-' + end + ' of ' + bsState.total;
}

function bsRenderSummary() {
  var el = document.getElementById('bs-summary');
  if (!el) return;
  el.textContent = '';
  if (!bsState.state) return;
  if (bsState.data) {
    el.appendChild(bsEl('strong', null, bsState.total + ' hospital' + (bsState.total === 1 ? '' : 's')));
    el.appendChild(bsEl('span', null, 'in ' + bsState.state + ', ' + BS_STATUS_LABELS[bsState.status]));
    var r = bsRangeText(); if (r) el.appendChild(bsEl('span', null, r));
    if (bsState.loading) el.appendChild(bsEl('span', null, 'Loading...'));
    else if (bsState.loadedAt) el.appendChild(bsEl('span', null, 'Updated ' + bsState.loadedAt.toLocaleTimeString()));
  } else if (bsState.loading) {
    el.appendChild(bsEl('span', null, 'Loading ' + bsState.state + '...'));
  }
}

function bsRenderPager() {
  var pager = document.getElementById('bs-pager');
  if (!pager) return;
  var show = !!(bsState.data && bsState.totalPages > 1);
  pager.style.display = show ? 'flex' : 'none';
  if (!show) return;
  var label = document.getElementById('bs-page-label');
  if (label) label.textContent = 'Page ' + bsState.page + ' of ' + bsState.totalPages;
  var jump = document.getElementById('bs-jump');
  if (jump) { jump.value = String(bsState.page); jump.max = String(bsState.totalPages); jump.disabled = bsState.loading; }
  var atStart = bsState.page <= 1, atEnd = bsState.page >= bsState.totalPages;
  [['bs-first', atStart], ['bs-prev', atStart], ['bs-next', atEnd], ['bs-last', atEnd]].forEach(function (p) {
    var b = document.getElementById(p[0]); if (b) b.disabled = p[1] || bsState.loading;
  });
}

function bsRender() {
  var body = document.getElementById('bs-body');
  var banner = document.getElementById('bs-banner');
  var refresh = document.getElementById('bs-refresh');
  if (!body) return;
  if (refresh) { refresh.disabled = !bsState.state || bsState.loading; refresh.textContent = bsState.loading ? 'Loading...' : 'Refresh'; }
  ['bs-state', 'bs-status', 'bs-size'].forEach(function (id) {
    var s = document.getElementById(id); if (s) s.setAttribute('aria-busy', bsState.loading ? 'true' : 'false');
  });
  bsRenderSummary();
  bsRenderPager();
  var have = Array.isArray(bsState.data);
  if (banner) {
    if (bsState.error && have) {
      banner.textContent = 'Could not refresh this page (' + bsState.error + '). Showing the last loaded results, which may be out of date.';
      banner.style.display = 'block';
    } else { banner.textContent = ''; banner.style.display = 'none'; }
  }
  body.textContent = '';

  if (!bsState.state) {
    body.appendChild(bsEl('div', 'bs-state', 'Choose a state to list every hospital on record there, in alphabetical order.'));
    return;
  }
  if (!have) {
    if (bsState.error) {
      var box = bsEl('div', 'bs-state err');
      box.setAttribute('role', 'alert');
      box.appendChild(bsEl('p', null, 'Hospitals for ' + bsState.state + ' could not be loaded: ' + bsState.error));
      var retry = bsEl('button', 'btn btn-outline btn-sm', 'Try again');
      retry.type = 'button'; retry.style.marginTop = '12px';
      retry.onclick = function () { bsLoad(); };
      box.appendChild(retry);
      body.appendChild(box);
    } else {
      var sk = bsEl('div', 'bs-list');
      sk.setAttribute('aria-label', 'Loading hospitals');
      for (var i = 0; i < 6; i++) sk.appendChild(bsEl('div', 'bs-skel'));
      body.appendChild(sk);
    }
    return;
  }
  if (!bsState.data.length) {
    var msg = bsState.status === 'all'
      ? 'No hospitals are on record for ' + bsState.state + '.'
      : 'No ' + BS_STATUS_LABELS[bsState.status] + ' hospitals in ' + bsState.state + '.';
    body.appendChild(bsEl('div', 'bs-state', msg));
    return;
  }

  var list = bsEl('div', 'bs-list' + (bsState.loading ? ' busy' : ''));
  list.setAttribute('aria-busy', bsState.loading ? 'true' : 'false');
  bsState.data.forEach(function (h) {
    if (!h || h.id == null) return;
    var id = Number(h.id);
    var row = bsEl('button', 'result-item bs-row' + (h.active === false ? ' inactive-row' : ''));
    row.type = 'button';
    row.disabled = bsState.loading;
    row.setAttribute('data-id', String(id));
    row.dataset.hospital = JSON.stringify(h);
    if (bsState.fromBrowse && selectedHospitalId === id) row.classList.add('active');
    row.setAttribute('aria-label', 'Edit ' + (h.name || 'unnamed hospital') + (h.active === false ? ' (deactivated)' : ''));
    row.onclick = function () { selectHospital(id, row); };

    var main = bsEl('div', 'bs-main');
    main.appendChild(bsEl('div', 'result-name bs-name', h.name || 'Unnamed hospital'));
    var loc = [h.address, h.city, h.zip].filter(function (x) { return x != null && String(x).trim() !== ''; }).join(', ');
    main.appendChild(bsEl('div', 'bs-meta', loc || 'No address on record'));
    var meta2 = [h.phone].filter(function (x) { return x != null && String(x).trim() !== ''; }).join('  |  ');
    if (meta2) { var m = bsEl('div', 'bs-meta', meta2); m.title = meta2; main.appendChild(m); }
    if (h.active === false && h.deactivatedReason) main.appendChild(bsEl('div', 'bs-meta', 'Reason: ' + h.deactivatedReason));
    row.appendChild(main);

    var tags = bsEl('div', 'bs-tags');
    tags.appendChild(bsEl('span', 'bs-id', '#' + id));
    tags.appendChild(bsEl('span', 'result-badge' + (h.source === 'admin' ? ' admin' : ''), h.source === 'admin' ? 'Admin-created' : 'CMS'));
    if (h.active === false) tags.appendChild(bsEl('span', 'result-badge inactive', 'Deactivated'));
    row.appendChild(tags);
    list.appendChild(row);
  });
  body.appendChild(list);
}

// Called by selectHospital after a row is chosen (search or browse).
function bsOnSelect(el) {
  var fromBrowse = !!(el && el.classList && el.classList.contains('bs-row'));
  bsState.fromBrowse = fromBrowse;
  bsState.browseSelectedId = fromBrowse ? selectedHospitalId : null;
  bsUpdateReturnBar();
}
function bsOnClearEdit() {
  bsState.fromBrowse = false; bsState.browseSelectedId = null;
  bsUpdateReturnBar();
}
function bsUpdateReturnBar() {
  var bar = document.getElementById('bs-return');
  var txt = document.getElementById('bs-return-text');
  if (!bar || !txt) return;
  var show = bsState.fromBrowse && bsState.state && selectedHospitalId != null && selectedHospitalId === bsState.browseSelectedId;
  bar.style.display = show ? 'flex' : 'none';
  txt.textContent = '';
  if (!show) return;
  txt.appendChild(document.createTextNode('Opened from Browse by State: '));
  txt.appendChild(bsEl('strong', null, bsState.state + ', ' + BS_STATUS_LABELS[bsState.status] + ', page ' + bsState.page + (bsState.totalPages ? ' of ' + bsState.totalPages : '')));
}
function bsReturnToList() {
  switchTab('browse');
  var active = document.querySelector('#bs-body .bs-row.active');
  if (active) { try { active.focus({ preventScroll: false }); active.scrollIntoView({ block: 'nearest' }); } catch (_) {} }
}
`;
