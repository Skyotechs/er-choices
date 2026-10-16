const {test} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../../..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const forbidden = /\b(?:push-force|drizzle-kit\s+(?:push|migrate)|run\s+(?:push|migrate|import-cms|enrich-specialties|merge-overrides|geocode-addresses|update-coords))\b/i;

test("Railway container startup only executes the API, with no schema or data command", () => {
  const dockerfile = read("Dockerfile");
  const starts = [...dockerfile.matchAll(/^CMD\s+(.+)$/gm)];
  assert.equal(starts.length, 1);
  assert.deepEqual(JSON.parse(starts[0][1]), [
    "node", "--enable-source-maps", "artifacts/api-server/dist/index.mjs",
  ]);
  assert.doesNotMatch(dockerfile, /^\s*(?:ENTRYPOINT|ONBUILD)\b/m);
  const runs = [...dockerfile.matchAll(/^RUN\s+(.+(?:\\\n.+)*)$/gm)].map(match => match[1]);
  assert.ok(runs.some(command => command.includes("@workspace/api-server run build")));
  assert.match(dockerfile, /pnpm --fail-if-no-match --filter @workspace\/api-server run build/);
  assert.match(dockerfile, /test -s artifacts\/api-server\/dist\/index\.mjs/);
  for (const command of runs) assert.doesNotMatch(command, forbidden);
});

test("API package retains its own identity, build commands, and runtime dependencies", () => {
  const api = JSON.parse(read("artifacts/api-server/package.json"));
  const workspace = JSON.parse(read("package.json"));
  assert.equal(api.name, "@workspace/api-server", "do not replace the API manifest with the root manifest");
  assert.notEqual(api.name, workspace.name);
  assert.equal(api.type, "module");
  assert.equal(api.scripts.build, "node ./build.mjs");
  assert.equal(api.scripts.start, "node --enable-source-maps ./dist/index.mjs");
  for (const name of ["express", "drizzle-orm", "pino", "@workspace/db", "@workspace/api-zod", "@workspace/speciality"]) {
    assert.equal(typeof api.dependencies[name], "string", `${name} must remain an API runtime dependency`);
  }
  assert.equal(typeof api.devDependencies.esbuild, "string");
  assert.match(read("scripts/src/release-api.cjs"), /"--fail-if-no-match", "--filter", "@workspace\/api-server"/);
});

test("Railway settings and Replit API release commands do not reintroduce automatic schema pushes", () => {
  const railway = JSON.parse(read("railway.json"));
  assert.equal(railway.build.builder, "DOCKERFILE");
  assert.equal(railway.build.dockerfilePath, "Dockerfile");
  assert.equal(railway.deploy.healthcheckPath, "/api/healthz");
  assert.equal(railway.deploy.startCommand, undefined, "use the safe Dockerfile CMD");
  assert.equal(railway.deploy.preDeployCommand, undefined, "no automatic maintenance job");
  assert.doesNotMatch(JSON.stringify(railway), forbidden);
  const manifest = read("artifacts/api-server/.replit-artifact/artifact.toml");
  assert.doesNotMatch(manifest, forbidden);
  const scripts = JSON.parse(read("artifacts/api-server/package.json")).scripts;
  for (const name of ["dev", "build", "start"]) {
    assert.equal(typeof scripts[name], "string");
    assert.doesNotMatch(scripts[name], forbidden);
    assert.equal(scripts[`pre${name}`], undefined, `no hidden pre${name} maintenance hook`);
    assert.equal(scripts[`post${name}`], undefined, `no hidden post${name} maintenance hook`);
  }
  assert.equal(scripts.build, "node ./build.mjs");
  assert.equal(scripts.start, "node --enable-source-maps ./dist/index.mjs");
  assert.doesNotMatch(read("artifacts/api-server/build.mjs"), forbidden);
});

test("Railway setup separates deployment from approved database maintenance", () => {
  const guide = read("RAILWAY_SETUP.md");
  assert.match(guide, /RAILWAY_DATABASE_URL/);
  assert.match(guide, /service-level overrides/);
  assert.match(guide, /separate explicit approval/);
  assert.match(guide, /`DATABASE_URL`, not `RAILWAY_DATABASE_URL`/);
  assert.match(guide, /Replit republishing is not a native trigger for Railway/);
  const commands = [...guide.matchAll(/```sh\n([\s\S]*?)```/g)].map(match => match[1]);
  for (const command of commands) assert.doesNotMatch(command, forbidden);
});
