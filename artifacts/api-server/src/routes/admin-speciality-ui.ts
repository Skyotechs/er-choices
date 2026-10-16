/**
 * Structured Speciality editor for the inline admin dashboard.
 * Edit mode: dedicated GET/PUT /api/admin/hospitals/:id/speciality with revision guard.
 * Add mode: entries collected locally and sent as `specialities` in the create POST.
 * Browser script below is plain JS embedded in a template literal: no backticks or
 * dollar-brace sequences may appear inside SPECIALITY_SCRIPT.
 */

export const SPECIALITY_STYLE = `
  .sp-wrap{grid-column:1/-1;display:flex;flex-direction:column;gap:10px}
  .sp-note{font-size:12px;color:#64748b;line-height:1.5}
  .sp-entry{border:1px solid #1e3352;border-radius:8px;padding:12px;background:#0a1524;display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px}
  .sp-entry.verified{border-color:#16a34a55}
  .sp-entry .field.wide{grid-column:span 2}
  .sp-entry .field{min-width:0}
  .sp-entry input,.sp-entry select{min-width:0}
  @media(max-width:650px){
    .header{flex-wrap:wrap;padding:12px}
    .header-right{width:100%;margin-left:0;flex-wrap:wrap}
    .main{flex-direction:column;min-height:0}
    .search-panel{width:100%;max-height:32vh;border-right:0;border-bottom:1px solid #1e3352}
    .edit-area{width:100%;min-width:0;min-height:0}
    .tabs{overflow-x:auto}
    .tab{white-space:nowrap;padding:10px 14px}
    .tab-content{padding:12px;min-width:0}
    .form-grid{grid-template-columns:minmax(0,1fr)}
    .field{min-width:0}
    .field input,.field select,.field textarea{min-width:0;width:100%}
    .form-actions{flex-wrap:wrap}
    .sp-entry{grid-template-columns:1fr}
    .sp-entry .field.wide{grid-column:auto}
    .sp-legacy dl{grid-template-columns:1fr}
  }
  .sp-entry-head{grid-column:1/-1;display:flex;align-items:center;gap:8px;font-size:12px;color:#94a3b8}
  .sp-pill{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;padding:2px 6px;border-radius:3px;background:#1e3352;color:#94a3b8}
  .sp-pill.ok{background:#14532d44;color:#4ade80}
  .sp-confirm{grid-column:1/-1;display:flex;gap:8px;align-items:flex-start;font-size:12px;color:#cbd5e1}
  .sp-confirm input{width:auto;margin-top:2px}
  .sp-bar{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
  .sp-state{font-size:12px;color:#64748b}
  .sp-state.err{color:#fca5a5}
  .sp-state.dirty{color:#fbbf24}
  .sp-legacy{border:1px dashed #334155;border-radius:8px;padding:10px 12px;font-size:12px;color:#94a3b8}
  .sp-legacy summary{cursor:pointer;font-weight:700;color:#cbd5e1}
  .sp-legacy dl{display:grid;grid-template-columns:180px 1fr;gap:4px 10px;margin-top:8px}
  .sp-legacy dt{color:#64748b}
  .sp-legacy dd{white-space:pre-wrap;word-break:break-word;color:#cbd5e1}
  .sp-skel{height:64px;border-radius:8px;background:linear-gradient(90deg,#0a1524,#152236,#0a1524);background-size:200% 100%;animation:spsk 1.2s linear infinite}
  @keyframes spsk{to{background-position:-200% 0}}
`;

/** prefix: "edit" | "add" */
export function specialityEditorHtml(prefix: "edit" | "add"): string {
  const isEdit = prefix === "edit";
  return `
            <div class="section-title">Speciality (official classifications)</div>
            <div class="sp-wrap" id="sp-${prefix}">
              <div class="sp-note">Record only the hospital's exact classification as published by the designating authority. Mark an entry verified only after you personally checked the official record. Services such as PCI, beds, helipad and service line are captured separately below and are not Speciality.</div>
              ${isEdit ? `<div class="sp-state" id="sp-edit-state"></div>
              <div id="sp-edit-legacy"></div>` : ""}
              <div id="sp-${prefix}-list"></div>
              <div class="sp-bar">
                <button type="button" class="btn btn-outline btn-sm" id="sp-${prefix}-addrow" onclick="spAddRow('${prefix}')">Add Speciality entry</button>
                ${isEdit ? `<button type="button" class="btn btn-primary btn-sm" id="sp-edit-save" onclick="spSaveEdit()" disabled>Save Speciality</button>
                <button type="button" class="btn btn-outline btn-sm" id="sp-edit-reload" onclick="spReload()" style="display:none">Reload Speciality</button>
                <span class="sp-state" id="sp-edit-dirty"></span>` : ""}
              </div>
              ${isEdit ? `<div class="status-msg" id="sp-edit-status"></div>` : ""}
            </div>
            <div class="section-title">Services &amp; Capabilities</div>`;
}

export const SPECIALITY_SCRIPT = `
// ── Speciality editor ─────────────────────────────────────────────────────────
const SP_CATEGORIES = ['Trauma','Stroke','Burn','Pediatric','Obstetrics','Psychiatric','Cardiac','Cancer','HazMat'];
const SP_POPULATIONS = ['All','Adult','Pediatric'];
const sp = {
  add: { entries: [], seq: 0 },
  edit: { entries: [], loadedFor: null, identity: null, revision: null, ready: false, dirty: false, saving: false, conflict: false, reqSeq: 0 },
};
function spBlank() {
  return { category: 'Trauma', classification: '', population: 'All', status: 'unverified', authority: '', sourceUrl: '', verifiedOn: '', officialConfirmed: false };
}
function spOpts(list, cur) {
  return list.map(function (v) { return '<option value="' + esc(v) + '"' + (v === cur ? ' selected' : '') + '>' + esc(v) + '</option>'; }).join('');
}
function spRender(prefix) {
  const st = sp[prefix];
  const list = document.getElementById('sp-' + prefix + '-list');
  if (!list) return;
  const locked = prefix === 'edit' && (!st.ready || st.saving);
  if (!st.entries.length) {
    list.innerHTML = '<div class="sp-note">No Speciality entries. Public apps will show that Speciality verification is unavailable for this hospital.</div>';
  } else {
    list.innerHTML = st.entries.map(function (e, i) {
      const v = e.status === 'verified';
      const dis = locked ? ' disabled' : '';
      const on = 'oninput="spField(\\'' + prefix + '\\',' + i + ',this)" onchange="spField(\\'' + prefix + '\\',' + i + ',this)"';
      return '<div class="sp-entry' + (v ? ' verified' : '') + '">' +
        '<div class="sp-entry-head"><span class="sp-pill' + (v ? ' ok' : '') + '">' + (v ? 'Verified' : 'Unverified') + '</span>Entry ' + (i + 1) +
        '<button type="button" class="btn btn-danger btn-sm" style="margin-left:auto"' + dis + ' onclick="spRemove(\\'' + prefix + '\\',' + i + ')">Remove</button></div>' +
        '<div class="field"><label class="field-label">Category</label><select data-k="category" ' + on + dis + '>' + spOpts(SP_CATEGORIES, e.category) + '</select></div>' +
        '<div class="field"><label class="field-label">Population</label><select data-k="population" ' + on + dis + '>' + spOpts(SP_POPULATIONS, e.population) + '</select></div>' +
        '<div class="field"><label class="field-label">Review status</label><select data-k="status" ' + on + dis + '>' + spOpts(['unverified','verified'], e.status) + '</select></div>' +
        '<div class="field full" style="grid-column:1/-1"><label class="field-label">Exact official classification *</label><input type="text" maxlength="200" data-k="classification" value="' + esc(e.classification) + '" placeholder="e.g. Level II Trauma Center" ' + on + dis + '></div>' +
        '<div class="field"><label class="field-label">Authority</label><input type="text" maxlength="200" data-k="authority" value="' + esc(e.authority) + '" placeholder="Designating body" ' + on + dis + '></div>' +
        '<div class="field wide"><label class="field-label">Evidence URL (https)</label><input type="url" maxlength="2000" data-k="sourceUrl" value="' + esc(e.sourceUrl) + '" placeholder="https://" ' + on + dis + '></div>' +
        '<div class="field"><label class="field-label">Verified on</label><input type="date" data-k="verifiedOn" value="' + esc(e.verifiedOn) + '" max="' + new Date().toISOString().slice(0, 10) + '" ' + on + dis + '></div>' +
        '<label class="sp-confirm"><input type="checkbox" data-k="officialConfirmed"' + (e.officialConfirmed ? ' checked' : '') + ' ' + on + dis + '>I checked this hospital\\'s exact classification against the official authority record myself. Required to mark verified.</label>' +
        '</div>';
    }).join('');
  }
  const addBtn = document.getElementById('sp-' + prefix + '-addrow');
  if (addBtn) addBtn.disabled = locked || st.entries.length >= 30;
  if (prefix === 'edit') spEditChrome();
}
function spField(prefix, i, el) {
  const e = sp[prefix].entries[i];
  if (!e) return;
  const k = el.dataset.k;
  e[k] = el.type === 'checkbox' ? el.checked : el.value;
  if (prefix === 'edit') { sp.edit.dirty = true; spEditChrome(); }
  if (k === 'status' || k === 'officialConfirmed') spRender(prefix);
}
function spAddRow(prefix) {
  const st = sp[prefix];
  if (prefix === 'edit' && (!st.ready || st.saving)) return;
  if (st.entries.length >= 30) return;
  st.entries.push(spBlank());
  if (prefix === 'edit') st.dirty = true;
  spRender(prefix);
}
function spRemove(prefix, i) {
  const st = sp[prefix];
  if (prefix === 'edit' && (!st.ready || st.saving)) return;
  st.entries.splice(i, 1);
  if (prefix === 'edit') st.dirty = true;
  spRender(prefix);
}
/** Client-side pre-check; the server remains authoritative. */
function spValidate(entries) {
  const today = new Date().toISOString().slice(0, 10);
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i], n = 'Entry ' + (i + 1) + ': ';
    if (!e.classification.trim()) return n + 'enter the exact official classification.';
    if (e.sourceUrl.trim() && !/^https:\\/\\/[^\\s@]+\\.[^\\s]+$/i.test(e.sourceUrl.trim())) return n + 'evidence URL must be a public https link.';
    if (e.verifiedOn && e.verifiedOn > today) return n + 'verification date cannot be in the future.';
    if (e.status === 'verified' && (!e.authority.trim() || !e.sourceUrl.trim() || !e.verifiedOn || !e.officialConfirmed))
      return n + 'verified requires authority, evidence URL, date, and the official-record confirmation checkbox.';
    for (let j = 0; j < i; j++) {
      const o = entries[j];
      if (o.category === e.category && (o.population === e.population || o.population === 'All' || e.population === 'All'))
        return n + 'conflicts with entry ' + (j + 1) + ' (same category and overlapping population). Keep one current classification.';
    }
  }
  return null;
}
function spClean(entries) {
  return entries.map(function (e) {
    return { category: e.category, classification: e.classification.trim(), population: e.population, status: e.status,
      authority: e.authority.trim(), sourceUrl: e.sourceUrl.trim(), verifiedOn: e.verifiedOn || '', officialConfirmed: !!e.officialConfirmed };
  });
}

// ── Add mode ──
function spAddPayload() {
  const err = spValidate(sp.add.entries);
  if (err) throw new Error('Speciality ' + err);
  return spClean(sp.add.entries);
}
function spAddReset() { sp.add.seq++; sp.add.entries = []; spRender('add'); }

// ── Edit mode ──
function spEditChrome() {
  const st = sp.edit;
  const save = document.getElementById('sp-edit-save');
  const reload = document.getElementById('sp-edit-reload');
  const dirty = document.getElementById('sp-edit-dirty');
  if (save) { save.disabled = !st.ready || st.saving || st.conflict || !st.dirty; save.textContent = st.saving ? 'Saving…' : 'Save Speciality'; }
  if (reload) reload.style.display = st.conflict ? 'inline-block' : 'none';
  if (dirty) { dirty.textContent = st.dirty ? 'Unsaved Speciality changes (saved separately from Save Changes)' : ''; dirty.className = 'sp-state' + (st.dirty ? ' dirty' : ''); }
}
function spRenderLegacy(legacy) {
  const box = document.getElementById('sp-edit-legacy');
  if (!box) return;
  const keys = ['specialties','actualDesignation','strokeDesignation','burnDesignation','designationSources','needsAdminReview','serviceLine','pciCapability'];
  const rows = keys.filter(function (k) {
    const v = legacy ? legacy[k] : null;
    return v != null && v !== '' && !(Array.isArray(v) && !v.length);
  }).map(function (k) {
    let v = legacy[k];
    if (typeof v !== 'string') { try { v = JSON.stringify(v, null, 2); } catch (_) { v = String(v); } }
    if (v.length > 4000) v = v.slice(0, 4000) + '…';
    return '<dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd>';
  });
  box.innerHTML = rows.length
    ? '<details class="sp-legacy"><summary>Legacy data for manual review (read-only, ' + rows.length + ' field' + (rows.length === 1 ? '' : 's') + ')</summary><div class="sp-note" style="margin-top:6px">Inferred or imported values. Not shown publicly as Speciality. Transcribe into an entry only after checking the official record.</div><dl>' + rows.join('') + '</dl></details>'
    : '';
}
function spSetState(msg, cls) {
  const el = document.getElementById('sp-edit-state');
  if (!el) return;
  el.className = 'sp-state' + (cls ? ' ' + cls : '');
  el.innerHTML = msg;
}
/** Discard everything (selection change, clear, logout). Invalidates in-flight requests. */
function spEditReset() {
  const st = sp.edit;
  st.reqSeq++;
  st.entries = []; st.loadedFor = null; st.identity = null; st.revision = null;
  st.ready = false; st.dirty = false; st.saving = false; st.conflict = false;
  spRenderLegacy(null);
  spSetState('', '');
  const s = document.getElementById('sp-edit-status'); if (s) s.style.display = 'none';
  spRender('edit');
}
/** True if safe to leave the current record. */
function spConfirmDiscard() {
  if (sp.edit.saving) return confirm('A Speciality save is still in progress for the selected hospital. Leave this editor? The request may still finish for that hospital.');
  if (!sp.edit.dirty) return true;
  return confirm('You have unsaved Speciality changes for this hospital. Discard them?');
}
async function spLoad(id) {
  const st = sp.edit;
  spEditReset();
  st.loadedFor = id;
  const seq = st.reqSeq;
  spSetState('<div class="sp-skel"></div>', '');
  try {
    const data = await apiFetch('/api/admin/hospitals/' + encodeURIComponent(id) + '/speciality');
    if (seq !== st.reqSeq || st.loadedFor !== id) return;
    if (data.id !== id || typeof data.recordIdentity !== 'string' ||
        typeof data.revision !== 'string' || !Array.isArray(data.entries))
      throw new Error('Incomplete Speciality response. Reload before editing.');
    st.identity = data.recordIdentity; st.revision = data.revision;
    st.entries = Array.isArray(data.entries) ? data.entries.map(function (e) { return Object.assign(spBlank(), e); }) : [];
    st.ready = true;
    spSetState('', '');
    spRenderLegacy(data.legacy || {});
    spRender('edit');
  } catch (err) {
    if (seq !== st.reqSeq || st.loadedFor !== id) return;
    spSetState('Could not load Speciality: ' + esc(err.message) + ' <button type="button" class="btn btn-outline btn-sm" onclick="spLoad(' + JSON.stringify(id).replace(/"/g, '&quot;') + ')">Retry</button>', 'err');
    spRender('edit');
  }
}
function spReload() {
  if (sp.edit.loadedFor == null) return;
  if (!confirm('Reload the latest saved Speciality? Your unsaved edits will be replaced.')) return;
  spLoad(sp.edit.loadedFor);
}
async function spSaveEdit() {
  const st = sp.edit;
  if (!st.ready || st.saving || st.conflict || st.loadedFor == null) return;
  const err = spValidate(st.entries);
  if (err) { showStatus('sp-edit-status', err, false); return; }
  // Capture target before awaiting.
  const id = st.loadedFor, identity = st.identity, revision = st.revision, seq = st.reqSeq;
  const entries = spClean(st.entries);
  st.saving = true; spRender('edit');
  try {
    const data = await apiFetch('/api/admin/hospitals/' + encodeURIComponent(id) + '/speciality', {
      method: 'PUT', body: JSON.stringify({ recordIdentity: identity, expectedRevision: revision, entries: entries }),
    });
    if (seq !== st.reqSeq || st.loadedFor !== id) return;
    st.identity = data.recordIdentity; st.revision = data.revision;
    st.entries = (data.entries || []).map(function (e) { return Object.assign(spBlank(), e); });
    st.dirty = false; st.saving = false;
    spRenderLegacy(data.legacy || {});
    spRender('edit');
    showStatus('sp-edit-status', 'Speciality saved.', true);
    if (typeof bsInvalidate === 'function') bsInvalidate();
  } catch (e) {
    if (seq !== st.reqSeq || st.loadedFor !== id) return;
    st.saving = false;
    if (/revision|conflict|changed|409/i.test(e.message)) {
      st.conflict = true;
      showStatus('sp-edit-status', 'This record changed since you loaded it. Your edits are kept on screen; copy anything you need, then Reload Speciality before saving again.', false);
    } else {
      showStatus('sp-edit-status', 'Speciality not saved: ' + e.message, false);
    }
    spRender('edit');
  }
}
window.addEventListener('beforeunload', function (ev) {
  if (sp.edit.dirty || sp.add.entries.length) { ev.preventDefault(); ev.returnValue = ''; }
});
spRender('add');
spRender('edit');
`;
