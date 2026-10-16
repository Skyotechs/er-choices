const {test} = require("node:test");
const assert = require("node:assert/strict");
const {runRelease, credentialReply, assertNoTrackedCredentials, REPOSITORY} = require("../src/release-api.cjs");

const local = "a".repeat(40);
const upstream = "b".repeat(40);

function fixture(overrides = {}) {
  const calls = [];
  const logs = [];
  let headReads = 0;
  let statusReads = 0;
  const run = (command, args, options) => {
    calls.push({command, args, options});
    if (command === "git") {
      if (args[0] === "branch") return overrides.branch || "main";
      if (args[0] === "status") return overrides.status?.(++statusReads) || "";
      if (args[0] === "rev-parse" && args[1] === "HEAD") {
        return overrides.head?.(++headReads) || local;
      }
      if (args[0] === "rev-parse") return overrides.remote || upstream;
      if (args[0] === "ls-remote") return `${upstream}\trefs/heads/main`;
      if (args[0] === "show") return overrides.config || "";
      if (args[0] === "merge-base" && overrides.diverged) throw new Error("diverged");
      if (args[0] === "push" && overrides.pushFailure) throw new Error("push rejected");
    } else if (overrides.fail === command) throw new Error("check failed");
    return "";
  };
  return {calls, logs, start: args => runRelease({args, run, env: {}, log: text => logs.push(text)})};
}
const pushes = f => f.calls.filter(c => c.command === "git" && c.args[0] === "push");

test("check-only runs tests and the API build without any Git network operations", () => {
  const f = fixture();
  f.start(["--check"]);
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[0].args[0], "--test");
  assert.deepEqual(f.calls[1].args, ["--filter", "@workspace/api-server", "run", "build"]);
  assert.equal(pushes(f).length, 0);
});

test("release checks before pushing precisely the tested commit to the fixed repository", () => {
  const f = fixture();
  f.start([]);
  assert.deepEqual(pushes(f)[0].args, ["push", REPOSITORY, `${local}:refs/heads/main`]);
  assert.ok(f.calls.findIndex(c => c.command === "pnpm") < f.calls.indexOf(pushes(f)[0]));
  assert.ok(f.calls.some(c => c.args[0] === "merge-base"));
  assert.ok(f.calls.every(c => !c.args.some(a => /force|no-verify|push-force|migrate|seed/.test(a))));
});

test("dirty files, untracked files, or a different branch block release before tests", () => {
  for (const options of [{branch: "feature"}, {status: () => " M file"}, {status: () => "?? file"}]) {
    const f = fixture(options);
    assert.throws(() => f.start([]), /main|pending changes/);
    assert.equal(pushes(f).length, 0);
    assert.ok(f.calls.every(c => c.command === "git"));
  }
});

test("a failed test or API build never pushes", () => {
  for (const fail of [process.execPath, "pnpm"]) {
    const f = fixture({fail});
    assert.throws(() => f.start([]), /check failed/);
    assert.equal(pushes(f).length, 0);
  }
});

test("edits or a changed commit during checks stop release", () => {
  for (const options of [
    {status: n => n > 1 ? " M file" : ""},
    {head: n => n > 1 ? "c".repeat(40) : local},
  ]) {
    const f = fixture(options);
    assert.throws(() => f.start([]), /pending changes|commit changed/);
    assert.equal(pushes(f).length, 0);
  }
});

test("divergent history fails closed and an up-to-date GitHub branch is not pushed again", () => {
  const diverged = fixture({diverged: true});
  assert.throws(() => diverged.start([]), /ahead or has diverged/);
  assert.equal(pushes(diverged).length, 0);
  const current = fixture({remote: local});
  current.start([]);
  assert.equal(pushes(current).length, 0);
  assert.ok(current.logs.some(line => /already has/.test(line)));
});

test("a failed push does not claim deployment success", () => {
  const f = fixture({pushFailure: true});
  assert.throws(() => f.start([]), /push rejected/);
  assert.ok(f.logs.every(line => !line.startsWith("Pushed tested commit")));
});

test("connection check is read-only and does not claim write access", () => {
  const f = fixture();
  f.start(["--check-connection"]);
  assert.deepEqual(f.calls[0].args, ["ls-remote", "--exit-code", "--heads", REPOSITORY, "refs/heads/main"]);
  assert.equal(f.calls.length, 1);
  assert.match(f.logs[0], /does not prove write permission/);
});

test("credential helper only supplies an existing secret to GitHub HTTPS get requests", () => {
  const env = {GITHUB_PAT: "fake-test-token"};
  const input = "protocol=https\nhost=github.com\n\n";
  assert.equal(credentialReply("get", input, env),
    "username=x-access-token\npassword=fake-test-token\n\n");
  assert.equal(credentialReply("store", input, env), "");
  assert.equal(credentialReply("get", "protocol=https\nhost=other.example\n\n", env), "");
  assert.equal(credentialReply("get", "protocol=http\nhost=github.com\n\n", env), "");
  assert.equal(credentialReply("get", input, {}), "");
});

test("unknown options fail rather than accidentally starting a release", () => {
  const f = fixture();
  assert.throws(() => f.start(["--dry-run"]), /Use no argument/);
  assert.equal(f.calls.length, 0);
});

test("tracked admin credentials block release without logging their values", () => {
  const f = fixture({config: '[userenv.shared]\nADMIN_SECRET = "fake-password"\n'});
  assert.throws(() => f.start([]), error =>
    /tracked credential/.test(error.message) && !error.message.includes("fake-password"));
  assert.equal(pushes(f).length, 0);
  assert.ok(f.calls.every(c => c.command === "git"));
  assert.ok(f.logs.every(line => !line.includes("fake-password")));
});

test("credential guard permits public API addresses but rejects database and session secrets", () => {
  assert.doesNotThrow(() => assertNoTrackedCredentials('VITE_API_BASE = "https://example.com/api"\n'));
  for (const name of ["SESSION_SECRET", "GITHUB_PAT", "RAILWAY_DATABASE_URL", "DATABASE_URL"]) {
    assert.throws(() => assertNoTrackedCredentials(`${name} = "fake-value"\n`), /tracked credential/);
  }
});
