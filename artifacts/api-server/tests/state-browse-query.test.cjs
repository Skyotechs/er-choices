const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const sandbox = { exports: {} };
vm.runInNewContext(ts.transpileModule(
  fs.readFileSync(path.join(__dirname, "../src/lib/state-browse-query.ts"), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS } },
).outputText, sandbox);
const parse = sandbox.exports.parseStateBrowseQuery;

test("state browsing requires no name and includes all statuses by default", () => {
  const query = parse({ state: " tx " });
  assert.equal(query.state, "TX");
  assert.equal(query.page, 1);
  assert.equal(query.pageSize, 50);
  assert.equal(query.status, "all");
});

test("valid pagination reaches records past the old 300-result limit", () => {
  const query = parse({ state: "CA", page: "7", pageSize: "50", status: "inactive" });
  assert.equal((query.page - 1) * query.pageSize, 300);
  assert.equal(query.status, "inactive");
});

test("invalid or array-valued parameters fail instead of unbounded queries", () => {
  for (const query of [
    {}, { state: "Texas" }, { state: ["TX"] },
    { state: "TX", page: "0" }, { state: "TX", page: "-1" },
    { state: "TX", page: "1.5" }, { state: "TX", page: ["1"] },
    { state: "TX", page: "1000001" }, { state: "TX", pageSize: "100000" },
    { state: "TX", status: "deleted" }, { state: "TX", status: ["all"] },
  ]) assert.throws(() => parse(query));
});
