const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

function loadReportsDatabase(env) {
  const pools = [];
  const code = ts.transpileModule(
    fs.readFileSync(path.join(__dirname, "../src/reports.ts"), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        esModuleInterop: true,
      },
    },
  ).outputText;
  const sandbox = {
    exports: {},
    process: { env },
    require(name) {
      if (name === "pg") {
        return {
          Pool: class {
            constructor(options) {
              this.options = options;
              pools.push(this);
            }
          },
        };
      }
      if (name === "drizzle-orm/node-postgres") {
        return { drizzle: (pool) => ({ $client: pool }) };
      }
      if (name === "./schema") return {};
      throw new Error(`Unexpected dependency: ${name}`);
    },
  };
  vm.runInNewContext(code, sandbox);
  return { getReportsDb: sandbox.exports.getReportsDb, pools };
}

test("reports use Railway even when a different default database is set", () => {
  const { getReportsDb } = loadReportsDatabase({
    RAILWAY_DATABASE_URL: "railway-test-placeholder",
    DATABASE_URL: "different-default-test-placeholder",
  });
  assert.equal(
    getReportsDb().$client.options.connectionString,
    "railway-test-placeholder",
  );
});

test("missing Railway configuration fails instead of reading the wrong store", () => {
  const { getReportsDb, pools } = loadReportsDatabase({
    DATABASE_URL: "different-default-test-placeholder",
  });
  assert.equal(pools.length, 0, "import does not open a connection");
  assert.throws(() => getReportsDb(), /RAILWAY_DATABASE_URL must be configured/);
  assert.equal(pools.length, 0);
});

test("report requests reuse one bounded connection pool", () => {
  const { getReportsDb, pools } = loadReportsDatabase({
    RAILWAY_DATABASE_URL: "railway-test-placeholder",
  });
  assert.equal(getReportsDb(), getReportsDb());
  assert.equal(pools.length, 1);
  assert.equal(pools[0].options.max, 5);
  assert.equal(pools[0].options.connectionTimeoutMillis, 10_000);
});
