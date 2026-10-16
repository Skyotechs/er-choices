const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

function load(env) {
  const pools = [];
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, "../src/hospitals.ts"), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  const sandbox = {
    exports: {}, process: { env }, Proxy, Reflect,
    require(name) {
      if (name === "./schema") return {};
      if (name === "pg") return { Pool: class {
        constructor(options) { this.options = options; pools.push(this); }
        query() { return this.options.connectionString; }
      } };
      if (name === "drizzle-orm/node-postgres") return {
        drizzle: (pool) => ({ $client: pool, select() { return this.$client.query(); } }),
      };
      throw new Error(`Unexpected dependency ${name}`);
    },
  };
  vm.runInNewContext(code, sandbox);
  return { ...sandbox.exports, pools };
}

test("hospital queries use one bounded Railway pool, never the unrelated default", () => {
  const store = load({ RAILWAY_DATABASE_URL: "railway-fixture", DATABASE_URL: "default-fixture" });
  assert.equal(store.pools.length, 0, "imports must not connect");
  assert.equal(store.hospitalDb.select(), "railway-fixture", "facade binds database methods");
  assert.equal(store.hospitalPool.query(), "railway-fixture", "facade binds pool methods");
  assert.equal(store.getHospitalsDb(), store.getHospitalsDb());
  assert.equal(store.pools.length, 1);
  assert.equal(store.pools[0].options.max, 5);
  assert.equal(store.pools[0].options.connectionTimeoutMillis, 10_000);
  assert.equal(store.pools[0].options.idleTimeoutMillis, 30_000);
});

test("missing Railway configuration fails lazily without a default connection", () => {
  const store = load({ DATABASE_URL: "default-fixture" });
  assert.throws(() => store.hospitalDb.select(), /RAILWAY_DATABASE_URL must be configured/);
  assert.throws(() => store.getHospitalPool(), /RAILWAY_DATABASE_URL must be configured/);
  assert.equal(store.pools.length, 0);
});

test("a failed Railway query never tries the default database", () => {
  const store = load({ RAILWAY_DATABASE_URL: "unreachable-fixture", DATABASE_URL: "default-fixture" });
  store.getHospitalPool().query = () => { throw new Error("connection failed"); };
  assert.throws(() => store.hospitalDb.select(), /connection failed/);
  assert.equal(store.pools.length, 1);
  assert.equal(store.pools[0].options.connectionString, "unreachable-fixture");
});
