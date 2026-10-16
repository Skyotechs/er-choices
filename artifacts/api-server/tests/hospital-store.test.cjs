// No real credentials, network services, databases, or maintenance scripts.
// Execute the actual routers against an isolated in-memory Drizzle fixture.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const crypto = require("node:crypto");
const util = require("node:util");

function compile(relative, dependencies, env = {
  ADMIN_SECRET: "fixture-admin", RAILWAY_DATABASE_URL: "railway-fixture", DATABASE_URL: "unrelated-fixture",
}) {
  const sandbox = {
    exports: {}, Buffer, URL, process: { env, cwd: () => "/fixture/api-server" },
    console: { log() {}, error() {}, warn() {} },
    require(name) {
      if (name in dependencies) return dependencies[name];
      throw new Error(`Unexpected dependency: ${name} in ${relative}`);
    },
  };
  vm.runInNewContext(ts.transpileModule(
    fs.readFileSync(path.join(__dirname, relative), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } },
  ).outputText, sandbox);
  return sandbox.exports;
}

const table = (name) => new Proxy({ table: name }, { get: (target, key) => key === "table" ? name : { table: name, key } });
const hospitals = table("hospitals"), overrides = table("overrides"), definitions = table("definitions");
const operators = {
  eq: (col, value) => ({ op: "eq", col, value }),
  ilike: (col, value) => ({ op: "ilike", col, value }),
  inArray: (col, value) => ({ op: "in", col, value }),
  and: (...parts) => ({ op: "and", parts: parts.filter(Boolean) }),
  count: () => ({ op: "count" }),
  isNotNull: (col) => ({ op: "notNull", col }),
  sql: (strings, ...params) => ({ op: "sql", text: strings.join("?"), params }),
};
function matches(row, clause) {
  if (!clause) return true;
  if (clause.op === "and") return clause.parts.every((part) => matches(row, part));
  if (clause.op === "sql" && clause.text.includes("->>'revision'")) {
    return (row.designationSources?._specialityV1?.revision ?? "") === clause.params.at(-1);
  }
  const val = row[clause.col?.key];
  if (clause.op === "eq") return val === clause.value;
  if (clause.op === "notNull") return val != null;
  if (clause.op === "ilike") return String(val).toLowerCase().includes(clause.value.replaceAll("%", "").toLowerCase());
  if (clause.op === "in") return clause.value.includes(val);
  return true;
}

function fixture() {
  const records = [
    { id: 1, cmsId: "CMS-A", osmId: "node/42", hospitalName: "Alpha Hospital", address: "12 Existing Street", city: "Town", state: "TX", active: true, emergencyServices: true, specialties: ["Stroke"], phone: "base", latitude: 1, longitude: 2, needsAdminReview: ["Obstetrics"], designationSources: {}, source: "cms" },
    { id: 2, cmsId: "CMS-B", osmId: null, hospitalName: "Beta Hospital", address: null, state: "TX", active: false, specialties: [], source: "cms" },
  ];
  const data = { hospitals: records, overrides: [{ id: 1, osmId: "osm-node-42", phone: "effective", latitude: 3, longitude: 4 }], definitions: [] };
  const operations = [], jobs = [];
  let unavailable = false;
  function query(action, target, selection) {
    let clause, values, joined, offset = 0, limit = Infinity, ordering = [];
    const q = {
      from(t) { target = t; return q; },
      leftJoin(t) { joined = t; return q; },
      where(c) { clause = c; return q; },
      set(v) { values = v; return q; },
      values(v) { values = v; return q; },
      returning(s) { selection = s; return q; },
      onConflictDoUpdate() { return q; },
      orderBy(...cols) { ordering = cols; return q; },
      offset(n) { offset = n; return q; },
      limit(n) { limit = n; return q; },
      then(resolve, reject) {
        return Promise.resolve().then(() => {
          if (unavailable) throw new Error("Railway unavailable");
          operations.push({ action, table: target.table, values });
          let rows = data[target.table].filter((r) => matches(r, clause));
          if (action === "update") rows.forEach((r) => {
            const patch = { ...values };
            const expression = patch.designationSources;
            if (expression?.op === "sql") {
              if (expression.text.includes("jsonb_set")) {
                patch.designationSources = { ...r.designationSources, _specialityV1: JSON.parse(expression.params[2]) };
              } else {
                patch.designationSources = { ...JSON.parse(expression.params[0]), ...(r.designationSources?._specialityV1 ? { _specialityV1: r.designationSources._specialityV1 } : {}) };
              }
            }
            Object.assign(r, patch);
          });
          if (action === "insert") {
            const row = { id: data[target.table].length + 1, active: true, ...values };
            data[target.table].push(row); rows = [row];
          }
          if (selection && Object.values(selection).some((v) => v?.op === "count")) return [{ total: rows.length }];
          if (ordering.length) rows = rows.slice().sort((a, b) => {
            for (const col of ordering) {
              const cmp = String(a[col.key]).localeCompare(String(b[col.key]));
              if (cmp) return cmp;
            }
            return 0;
          });
          rows = rows.slice(offset, offset + limit);
          return rows.map((r) => selection
            ? Object.fromEntries(Object.entries(selection).map(([key, col]) => {
              if (col.table === joined?.table) {
                const osmId = r.osmId?.startsWith("osm-") ? r.osmId : "osm-" + r.osmId?.replace("/", "-");
                return [key, data[joined.table].find((o) => o.osmId === osmId)?.[col.key] ?? null];
              }
              return [key, r[col.key]];
            }))
            : { ...r });
        }).then(resolve, reject);
      },
    };
    return q;
  }
  const db = {
    select: (selection) => query("select", undefined, selection),
    update: (target) => query("update", target),
    insert: (target) => query("insert", target),
  };
  const dbModule = {
    hospitalDb: db, hospitalSpecialties: hospitals, hospitalOverrides: overrides, specialtyDefinitions: definitions,
    getHospitalPool: () => ({ async query(sql) {
      assert.equal(sql, "SELECT 1");
      if (unavailable) throw new Error("Railway unavailable");
      operations.push({ action: "health" });
    } }),
  };
  Object.defineProperty(dbModule, "db", { get() { throw new Error("UNRELATED DEFAULT DATABASE ACCESSED"); } });
  const identity = compile("../src/lib/hospital-store.ts", {
    "@workspace/db": dbModule, "drizzle-orm": operators, "node:crypto": crypto,
  });
  const routes = [];
  const router = {};
  router.use = (...handlers) => routes.push({ method: "use", path: "", handlers });
  for (const method of ["get", "post", "put", "patch"]) router[method] = (paths, ...handlers) => {
    for (const p of Array.isArray(paths) ? paths : [paths]) routes.push({ method, path: p, handlers });
  };
  const execFile = () => { throw new Error("Use promisified fixture"); };
  execFile[util.promisify.custom] = async (file, args, options) => {
    jobs.push({ file, args, options });
    return { stdout: ["ENRICHMENT_RESULT:{}", "COORD_UPDATE_RESULT:{}", "GEOCODE_RESULT:{}"].join("\n") };
  };
  const fakeFs = {
    existsSync: () => true, writeFileSync() {}, appendFileSync() {}, unlinkSync() {},
    openSync: () => 9, closeSync() {}, readFileSync: () => "", statSync: () => ({ size: 0 }),
  };
  const dependencies = {
    "@workspace/db": dbModule, "express": { Router: () => router }, "drizzle-orm": operators,
    "crypto": crypto, "../lib/hospital-store": identity,
    "../lib/state-browse-query": compile("../src/lib/state-browse-query.ts", {}),
    "../../scripts/import-cms-hospitals.js": { runImport: async () => { jobs.push({ import: true }); } },
    "child_process": { execFile, spawn: (file, args, options) => {
      jobs.push({ file, args, options }); return { pid: 999, on() {}, unref() {} };
    } },
    "util": util, "fs": fakeFs, "path": path,
  };
  const speciality = compile("../../../lib/speciality/src/index.ts", {});
  Object.assign(dependencies, {
    "@workspace/speciality": speciality,
    "node:crypto": crypto,
    "../lib/speciality-store": compile("../src/lib/speciality-store.ts", {
      "@workspace/db": dbModule, "drizzle-orm": operators, "@workspace/speciality": speciality,
    }),
    "@workspace/api-zod": compile("../../../lib/api-zod/src/generated/api.ts", {
      zod: require(require("node:module").createRequire(path.resolve(__dirname, "../../../lib/api-zod/package.json")).resolve("zod")),
    }),
  });
  compile("../src/routes/admin-hospitals.ts", dependencies);
  compile("../src/routes/specialties.ts", dependencies);
  compile("../src/routes/hospitals.ts", dependencies);
  compile("../src/routes/admin-speciality.ts", dependencies);
  async function request(method, url, body = {}, authorized = true) {
    const u = new URL(url, "http://fixture");
    let status = 200, payload, done = false;
    const headers = {};
    const res = {
      status(code) { status = code; return res; },
      json(data) { payload = data; done = true; return res; },
      send(data) { payload = data; done = true; return res; },
      setHeader(k, v) { headers[k] = v; },
    };
    const req = {
      path: u.pathname, method: method.toUpperCase(), query: Object.fromEntries(u.searchParams), body,
      headers: authorized ? { authorization: "Bearer fixture-admin" } : {},
      log: { error() {} },
    };
    for (const route of routes) {
      if (route.method !== "use" && route.method !== method.toLowerCase()) continue;
      const keys = [];
      const pattern = route.path.replace(/:([^/]+)/g, (_s, key) => { keys.push(key); return "([^/]+)"; });
      const match = route.method === "use" ? [""] : u.pathname.match(new RegExp("^" + pattern + "$"));
      if (!match) continue;
      req.params = Object.fromEntries(keys.map((key, i) => [key, match[i + 1]]));
      for (const handler of route.handlers) {
        let continued = false;
        await handler(req, res, () => { continued = true; });
        if (done) return { status, payload, headers };
        if (!continued) throw new Error(`Fixture handler did not respond or continue: ${route.path}`);
      }
    }
    throw new Error("Unmatched fixture request " + url);
  }
  return { request, records, data, operations, jobs, identity, setUnavailable: () => { unavailable = true; } };
}

test("search and state browse retain Railway addresses, nulls, effective overrides and signed identities", async () => {
  const f = fixture();
  const search = await f.request("get", "/admin/hospitals/search?q=Alpha");
  assert.equal(search.payload[0].address, "12 Existing Street");
  assert.equal(search.payload[0].phone, "effective");
  assert.equal(search.payload[0].latitude, 3);
  assert.equal(search.payload[0].longitude, 4);
  assert.equal(search.payload[0].recordIdentity, f.identity.hospitalRecordIdentity(f.records[0]));
  const state = await f.request("get", "/admin/hospitals/by-state?state=TX&pageSize=25&page=1");
  assert.equal(state.payload.total, 2);
  assert.equal(state.payload.totalPages, 1);
  assert.equal(state.payload.hospitals[1].cmsId, "CMS-B");
  assert.equal(state.payload.hospitals[1].address, null, "never fabricate a missing address");
  const inactive = await f.request("get", "/admin/hospitals/by-state?state=TX&status=inactive");
  assert.equal(inactive.payload.total, 1);
  const count = await f.request("get", "/admin/hospitals/deactivated-count");
  assert.equal(count.payload.count, 1);
  const csv = await f.request("get", "/admin/export-csv");
  assert.match(csv.payload, /12 Existing Street/);
});

test("state browsing reaches every matching record beyond 300 without deduplicating rows", async () => {
  const f = fixture();
  for (let i = 3; i <= 352; i++) {
    f.records.push({ ...f.records[0], id: i, cmsId: "CMS-" + i, hospitalName: "Hospital " + String(i).padStart(3, "0") });
  }
  const seen = [];
  for (let page = 1; page <= 8; page++) {
    const response = await f.request("get", "/admin/hospitals/by-state?state=TX&page=" + page);
    assert.equal(response.payload.total, 352);
    seen.push(...response.payload.hospitals.map((r) => r.id));
  }
  assert.equal(new Set(seen).size, 352, "including records sharing the same OSM id");
});

test("public hospital values agree with admin effective values, including normalized legacy overrides", async () => {
  const f = fixture();
  const admin = (await f.request("get", "/admin/hospitals/search?q=Alpha")).payload[0];
  const nearby = (await f.request("get", "/hospitals/nearby?lat=1&lon=2")).payload.hospitals[0];
  assert.equal(nearby.id, "osm-node-42");
  for (const field of ["address", "phone", "latitude", "longitude"]) assert.equal(nearby[field], admin[field], field);
  const publicSource = fs.readFileSync(path.join(__dirname, "../src/routes/hospitals.ts"), "utf8");
  assert.match(publicSource, /ELSE 'osm-' \|\| replace\(/, "SQL join must normalize raw legacy OSM ids");
});

test("signed fresh saves, stable CMS edits, additions and activation target only the hospital store", async () => {
  const f = fixture();
  const recordIdentity = f.identity.hospitalRecordIdentity(f.records[0]);
  const saved = await f.request("patch", "/admin/hospitals/1", { recordIdentity, address: "Intentional edit", phone: "new" });
  assert.equal(saved.status, 200);
  assert.equal(f.records[0].address, "Intentional edit");
  assert.equal(f.data.overrides[0].phone, null, "edited phone must not be shadowed");
  assert.equal(f.data.overrides[0].latitude, 3, "unrelated overrides remain intact");
  assert.equal(f.records[0].hospitalName, "Alpha Hospital", "partial patch semantics unchanged");
  await f.request("patch", "/admin/hospitals/1", { recordIdentity, latitude: 5 });
  assert.equal(f.records[0].latitude, 5);
  assert.equal(f.data.overrides[0].latitude, null);
  assert.equal(f.data.overrides[0].longitude, 4, "a latitude edit must not clear longitude");
  await f.request("patch", "/admin/hospitals/1/deactivate", { recordIdentity, reason: "closed" });
  assert.equal(f.records[0].active, false);
  assert.equal(f.records[0].deactivatedReason, "closed");
  await f.request("patch", "/admin/hospitals/1/activate", { recordIdentity });
  assert.equal(f.records[0].active, true);
  await f.request("patch", "/admin/hospitals/cms/CMS-A", { address: null });
  assert.equal(f.records[0].address, null);
  const added = await f.request("post", "/admin/hospitals", { hospitalName: "New fixture", state: "TX", latitude: 1, longitude: 2 });
  assert.equal(added.status, 201);
  assert.equal(f.records.length, 3);
});

test("stale numeric pages, mismatched stable identities, tampering and invalid IDs cannot write", async () => {
  const f = fixture();
  for (const suffix of ["", "/deactivate", "/activate"]) {
    assert.equal((await f.request("patch", "/admin/hospitals/1" + suffix, { phone: "wrong" })).status, 409);
  }
  const wrongRecord = f.identity.hospitalRecordIdentity({ id: 1, cmsId: "OLD-DATABASE-CMS-ID" });
  assert.equal((await f.request("patch", "/admin/hospitals/1", { recordIdentity: wrongRecord, phone: "wrong" })).status, 409);
  const tampered = f.identity.hospitalRecordIdentity(f.records[0]) + "x";
  assert.equal((await f.request("patch", "/admin/hospitals/1", { recordIdentity: tampered, phone: "wrong" })).status, 409);
  assert.equal((await f.request("patch", "/admin/hospitals/1junk", { phone: "wrong" })).status, 400);
  assert.equal(f.operations.filter((o) => o.action === "update").length, 0);
});

test("old specialty writers cannot certify or replace reviewed classifications", async () => {
  const f = fixture();
  const gaps = await f.request("get", "/admin/specialty-gaps");
  const row = gaps.payload.byDesignation.Obstetrics[0];
  assert.equal(typeof row.recordIdentity, "string");
  assert.equal((await f.request("patch", "/admin/specialty-gaps/1/resolve", { designation: "Obstetrics", present: true })).status, 409);
  const resolved = await f.request("patch", "/admin/specialty-gaps/1/resolve", { recordIdentity: row.recordIdentity, designation: "Obstetrics", present: true });
  assert.equal(resolved.status, 409);
  assert.equal((await f.request("put", "/admin/specialty-gaps/1/resolve-all", { recordIdentity: row.recordIdentity, specialties: ["Stroke"] })).status, 409);
  assert.deepEqual(Array.from(f.records[0].specialties), ["Stroke"]);
});

test("CSV and sync maintenance use the hospital store without any live job", async () => {
  const f = fixture();
  const csv = await f.request("post", "/admin/import-csv", "CMS ID,Address\nCMS-A,Fixture CSV Address");
  assert.equal(csv.payload.updated, 1);
  assert.equal(f.records[0].address, "Fixture CSV Address");
  assert.equal((await f.request("post", "/admin/sync-specialties")).status, 200);
  assert.equal(f.jobs.length, 0);
});

const verifiedEntry = (patch = {}) => ({
  category: "Stroke", classification: "Comprehensive Stroke Center", population: "All",
  status: "verified", authority: "Fixture official authority",
  sourceUrl: "https://authority.example/hospital-A", verifiedOn: "2026-01-01",
  officialConfirmed: true, ...patch,
});
test("evidence save/reload is atomic, preserves every legacy field, and projects only verified entries publicly", async () => {
  const f = fixture();
  const legacy = JSON.stringify(f.records[0]);
  const loaded = await f.request("get", "/admin/hospitals/1/speciality");
  assert.equal(loaded.status, 200);
  assert.equal(loaded.payload.revision, "");
  assert.equal(loaded.payload.entries.length, 0);
  assert.equal(JSON.stringify(f.records[0]), legacy, "GET is read only");
  const saved = await f.request("put", "/admin/hospitals/1/speciality", {
    recordIdentity: loaded.payload.recordIdentity, expectedRevision: "", entries: [verifiedEntry()],
  });
  assert.equal(saved.status, 200);
  assert.ok(saved.payload.revision);
  const again = await f.request("get", "/admin/hospitals/1/speciality");
  assert.equal(again.payload.entries[0].classification, "Comprehensive Stroke Center");
  for (const [key, value] of Object.entries(JSON.parse(legacy))) {
    if (key === "designationSources") continue;
    assert.equal(JSON.stringify(f.records[0][key]), JSON.stringify(value), key);
  }
  assert.deepEqual(JSON.parse(JSON.stringify(again.payload.legacy.specialties)), ["Stroke"]);
  const nearby = await f.request("get", "/hospitals/nearby?lat=1&lon=2");
  assert.equal(nearby.payload.hospitals[0].specialities[0].classification, "Comprehensive Stroke Center");
  assert.equal(nearby.payload.hospitals[0].strokeDesignation, "Comprehensive Stroke Center");
  const before = JSON.stringify(f.records[0]);
  const stale = await f.request("put", "/admin/hospitals/1/speciality", {
    recordIdentity: loaded.payload.recordIdentity, expectedRevision: "", entries: [],
  });
  assert.equal(stale.status, 409);
  assert.equal(JSON.stringify(f.records[0]), before);
});
test("unsupported evidence, legacy patches, stale identity, and unauthenticated speciality writes cannot mutate", async () => {
  const f = fixture();
  const identity = f.identity.hospitalRecordIdentity(f.records[0]);
  const before = JSON.stringify(f.records);
  for (const entries of [
    [verifiedEntry({ authority: "" })], [verifiedEntry({ officialConfirmed: false })],
    [verifiedEntry(), verifiedEntry({ classification: "Primary Stroke Center" })],
  ]) {
    const r = await f.request("put", "/admin/hospitals/1/speciality", { recordIdentity: identity, expectedRevision: "", entries });
    assert.equal(r.status, 400);
  }
  assert.equal((await f.request("patch", "/admin/hospitals/1", { recordIdentity: identity, specialties: ["Trauma"] })).status, 409);
  assert.equal((await f.request("put", "/admin/hospitals/1/speciality", { recordIdentity: "old", expectedRevision: "", entries: [] })).status, 503);
  assert.equal((await f.request("put", "/admin/hospitals/1/speciality", {}, false)).status, 401);
  assert.equal((await f.request("get", "/admin/hospitals/1/speciality", {}, false)).status, 401);
  assert.equal(JSON.stringify(f.records), before);
});
test("new hospital speciality is created in the same insert; unverified legacy and failed connections never look verified", async () => {
  const f = fixture();
  const nearby = await f.request("get", "/hospitals/nearby?lat=1&lon=2");
  assert.equal(nearby.payload.hospitals[0].specialities.length, 0);
  assert.equal(nearby.payload.hospitals[0].categories.length, 0);
  const added = await f.request("post", "/admin/hospitals", { hospitalName: "Fixture", state: "TX", specialities: [verifiedEntry()] });
  assert.equal(added.status, 201);
  assert.equal(added.payload.hospital.designationSources._specialityV1.entries.length, 1);
  const n = f.records.length;
  assert.equal((await f.request("post", "/admin/hospitals", { hospitalName: "Invalid", state: "TX", specialities: [verifiedEntry({ sourceUrl: "" })] })).status, 400);
  assert.equal(f.records.length, n);
  f.setUnavailable();
  assert.equal((await f.request("get", "/admin/hospitals/1/speciality")).status, 503);
});
test("legacy CSV imports preserve the current evidence namespace and never certify incoming strings", async () => {
  const f = fixture();
  const identity = f.identity.hospitalRecordIdentity(f.records[0]);
  await f.request("put", "/admin/hospitals/1/speciality", {
    recordIdentity: identity, expectedRevision: "", entries: [verifiedEntry()],
  });
  const state = JSON.stringify(f.records[0].designationSources._specialityV1);
  const response = await f.request("post", "/admin/import-csv", "CMS ID,Confirmed Specialties\nCMS-A,Trauma");
  assert.equal(response.payload.updated, 1);
  assert.equal(JSON.stringify(f.records[0].designationSources._specialityV1), state);
  const review = await f.request("get", "/admin/hospitals/1/speciality");
  assert.equal(review.payload.entries[0].category, "Stroke");
  assert.equal(review.payload.entries.length, 1);
  const source = fs.readFileSync(path.resolve(__dirname, "../scripts/import-cms-hospitals.ts"), "utf8");
  assert.equal((source.match(/designationSources: preserveSpecialityReview\(/g) || []).length, 5);
  assert.match(source, /jsonb_build_object\('_specialityV1'/);
});

test("maintenance connection failure is explicit before acknowledging or spawning work", async () => {
  const f = fixture();
  f.setUnavailable();
  for (const route of ["run-enrichment", "run-coord-update", "run-geocode", "run-geocode-pass2", "run-census-geocode", "run-import", "seed"]) {
    assert.equal((await f.request("post", "/admin/" + route)).status, 503, route);
  }
  assert.equal(f.jobs.length, 0);
  assert.equal((await f.request("get", "/admin/hospitals/search?q=Alpha")).status, 500);
});

test("authenticated background triggers retain the Railway environment without overriding the default", async () => {
  const f = fixture();
  for (const route of ["run-enrichment", "run-coord-update", "run-geocode", "run-geocode-pass2", "run-census-geocode", "run-import", "seed"]) {
    const result = await f.request("post", "/admin/" + route);
    assert.ok([200, 202].includes(result.status), route);
  }
  assert.equal(f.jobs.length, 7);
  for (const job of f.jobs.filter((j) => j.options)) {
    assert.equal(job.options.env.ADMIN_SECRET, "fixture-admin");
    assert.equal(job.options.env.RAILWAY_DATABASE_URL, "railway-fixture");
    assert.equal(job.options.env.DATABASE_URL, "unrelated-fixture", "no global database substitution");
  }
});

test("authentication blocks reads, edits and maintenance before touching the store", async () => {
  const f = fixture();
  for (const [method, route] of [
    ["get", "/admin/hospitals/search?q=Alpha"], ["get", "/admin/hospitals/by-state?state=TX"],
    ["patch", "/admin/hospitals/1"], ["post", "/admin/hospitals"], ["post", "/admin/run-import"],
    ["put", "/admin/specialty-gaps/1/resolve-all"], ["post", "/admin/seed"],
  ]) assert.equal((await f.request(method, route, {}, false)).status, 401);
  assert.equal(f.operations.length, 0);
  assert.equal(f.jobs.length, 0);
});

test("all hospital scripts and routers explicitly import the hospital connection", () => {
  for (const file of [
    "../src/routes/admin-hospitals.ts", "../src/routes/specialties.ts", "../src/routes/hospitals.ts",
    "../scripts/import-cms-hospitals.ts", "../scripts/enrich-specialties.ts",
    "../scripts/geocode-addresses.ts", "../scripts/geocode-addresses-pass2.ts",
    "../scripts/geocode-census-batch.ts", "../scripts/update-coords-from-osm.ts",
    "../scripts/merge-overrides-to-specialties.ts",
  ]) {
    const source = fs.readFileSync(path.join(__dirname, file), "utf8");
    assert.match(source, /hospitalDb as db/, file);
    assert.doesNotMatch(source, /import\s*\{\s*db\s*[,}]/, file);
  }
  for (const file of ["../scripts/run-cms-import.ts", "../scripts/run-enrich-specialties.ts"]) {
    assert.match(fs.readFileSync(path.join(__dirname, file), "utf8"), /hospitalPool as pool/);
  }
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, "../src/app.ts"), "utf8"), /seedSpecialtyDefinitions\(/);
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, "../package.json"), "utf8"), /push-force|DATABASE_URL=/);
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, "../.replit-artifact/artifact.toml"), "utf8"), /push-force/);
});

test("the rendered admin editor sends the loaded identity for save and both status actions", async () => {
  let html;
  const deps = {
    express: { Router: () => ({ get(_path, handler) {
      handler({}, { setHeader() {}, type() { return this; }, send(page) { html = page; } });
    } }) },
    "./admin-reports-ui": compile("../src/routes/admin-reports-ui.ts", {}),
    "./admin-state-browse-ui": compile("../src/routes/admin-state-browse-ui.ts", {}),
    "./admin-speciality-ui": compile("../src/routes/admin-speciality-ui.ts", {}),
  };
  compile("../src/routes/admin-ui.ts", deps);
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const node = () => ({
    style: {}, classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {},
    querySelector: () => ({ disabled: false, textContent: "Save" }), elements: {},
  });
  const elements = new Map();
  const context = vm.createContext({
    document: {
      getElementById(id) { if (!elements.has(id)) elements.set(id, node()); return elements.get(id); },
      addEventListener() {},
      querySelectorAll: () => [], querySelector: () => null, body: node(),
    },
    confirm: () => true, prompt: () => "", setTimeout() {},
    window: { addEventListener() {} },
  });
  vm.runInContext(script, context);
  const requests = [];
  Object.assign(context, {
    apiFetch: async (url, options) => { requests.push({ url, body: JSON.parse(options.body) }); return {}; },
    formToPayload: () => ({ hospitalName: "Intentional fixture edit" }),
    populateEditForm() {}, bsOnSelect() {}, switchTab() {}, bsInvalidate() {}, loadDeactivatedCount() {},
    showStatus() {},
  });
  const row = node();
  row.dataset = { hospital: JSON.stringify({ id: 1, recordIdentity: "loaded-signed-identity" }) };
  context.selectHospital(1, row);
  await context.submitEdit({ preventDefault() {}, target: node() });
  await context.toggleActiveState();
  await context.toggleActiveState();
  assert.equal(requests.length, 3);
  assert.ok(requests.every((r) => r.body.recordIdentity === "loaded-signed-identity"));
  assert.match(requests[1].url, /deactivate$/);
  assert.match(requests[2].url, /activate$/);

  // A new review travels in the create payload, never a second classification write.
  requests.length = 0;
  context.apiFetch = async (url, options = {}) => {
    requests.push({ url, body: JSON.parse(options.body || "{}") });
    return { hospital: { cmsId: "fixture-new" } };
  };
  const addButton = { disabled: false, textContent: "" };
  let reset = false;
  const addForm = { elements: [], querySelector: () => addButton, reset() { reset = true; } };
  vm.runInContext(`sp.add.entries = ${JSON.stringify([verifiedEntry()])}`, context);
  await context.submitAdd({ preventDefault() {}, target: addForm });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "/api/admin/hospitals");
  assert.equal(requests[0].body.specialities[0].authority, "Fixture official authority");
  assert.equal(reset, true);
  assert.equal(vm.runInContext("sp.add.entries.length", context), 0);

  // Switching records while saving cannot replace the new hospital's editor.
  let finishSave;
  context.apiFetch = async (url, options = {}) => {
    if (options.method === "PUT") {
      requests.push({ url, body: JSON.parse(options.body) });
      return new Promise(resolve => { finishSave = resolve; });
    }
    const id = Number(url.split("/").at(-2));
    return { id, recordIdentity: `identity-${id}`, revision: "", entries: [], legacy: {} };
  };
  await context.spLoad(42);
  vm.runInContext(`sp.edit.entries = ${JSON.stringify([verifiedEntry()])}; sp.edit.dirty = true`, context);
  const pendingSave = context.spSaveEdit();
  assert.equal(requests.at(-1).url, "/api/admin/hospitals/42/speciality");
  assert.equal(requests.at(-1).body.recordIdentity, "identity-42");
  assert.equal(requests.at(-1).body.expectedRevision, "");
  await context.spLoad(99);
  finishSave({ id: 42, recordIdentity: "identity-42", revision: "saved", entries: [verifiedEntry()], legacy: {} });
  await pendingSave;
  assert.equal(vm.runInContext("sp.edit.loadedFor", context), 99);
  assert.equal(vm.runInContext("sp.edit.entries.length", context), 0);
});
