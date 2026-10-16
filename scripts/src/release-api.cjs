#!/usr/bin/env node
"use strict";

const {execFileSync} = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../..");
// Deliberately do not use origin: older remotes may contain embedded credentials.
const REPOSITORY = "https://github.com/Skyotechs/er-choices.git";
const BRANCH = "main";
const TEST_DIRS = [
  "lib/speciality/tests", "artifacts/api-server/tests", "lib/db/tests", "scripts/tests",
];

function credentialReply(action, input, env) {
  const fields = Object.fromEntries(input.trim().split("\n").map(line => {
    const i = line.indexOf("=");
    return [line.slice(0, i), line.slice(i + 1)];
  }));
  if (action !== "get" || fields.protocol !== "https" ||
      fields.host !== "github.com" || !env.GITHUB_PAT) return "";
  return `username=x-access-token\npassword=${env.GITHUB_PAT}\n\n`;
}

function gitOptions(env) {
  const options = [];
  if (env.GITHUB_PAT) {
    const quote = value => `'${value.replace(/'/g, "'\\''")}'`;
    options.push("-c", "credential.helper=", "-c",
      `credential.helper=!${quote(process.execPath)} ${quote(__filename)} --git-credential`);
  }
  return options;
}

function assertNoTrackedCredentials(config) {
  if (/^\s*(?:ADMIN_SECRET|SESSION_SECRET|GITHUB_PAT|(?:RAILWAY_)?DATABASE_URL|[A-Z0-9_]*(?:PASSWORD|PRIVATE_KEY|SECRET_KEY|ACCESS_TOKEN))\s*=\s*["'][^"'\r\n]+/m.test(config)) {
    throw new Error("Release blocked: .replit contains a tracked credential. Move it to Secrets and rotate the exposed credential before pushing. No credential values were logged.");
  }
}

function execute(command, args, options) {
  try {
    return execFileSync(command, args, {...options, encoding: "utf8"}) || "";
  } catch (error) {
    if (command === "git") {
      // Never echo Git stderr: old remote/hook configuration can contain secrets.
      const details = String(error.stderr || "");
      const hint = /lfs|locks/i.test(details) ? " Check Git LFS authentication and lock permissions." :
        /authentication|401|403|denied|username|password/i.test(details) ?
          " Check GitHub authentication and repository write permission." :
        /rejected|non.fast.forward|fetch first/i.test(details) ?
          " GitHub changed; reconcile the histories before retrying." :
          " Check connectivity, GitHub permissions, and any Git hooks.";
      throw new Error(`Git ${args.includes("push") ? "push" : "operation"} failed.${hint}`);
    }
    throw new Error(`${command} failed; release stopped. See the check output above.`);
  }
}

function runRelease({args = [], run = execute, log = console.log, env = process.env} = {}) {
  if (args.some(arg => !["--check", "--check-connection", "--help"].includes(arg)) ||
      args.length > 1) throw new Error("Use no argument, --check, --check-connection, or --help.");
  if (args.includes("--help")) {
    log("pnpm release:api              Check and push committed main to GitHub (may deploy Railway).");
    log("pnpm release:api:check        Run tests and API build only; never pushes.");
    log("pnpm release:api --check-connection   Read-only GitHub connection check.");
    return;
  }
  const gitEnv = {...env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0"};
  const git = (...gitArgs) => run("git", [...gitOptions(env), ...gitArgs], {
    cwd: ROOT, env: gitEnv, stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  const remote = (...remoteArgs) => git(...remoteArgs);
  if (args.includes("--check-connection")) {
    const result = remote("ls-remote", "--exit-code", "--heads", REPOSITORY, `refs/heads/${BRANCH}`);
    if (!/^[a-f0-9]{40,64}\s+refs\/heads\/main$/i.test(result)) {
      throw new Error("GitHub main was not found. Nothing was pushed.");
    }
    log("GitHub main is readable. Nothing was pushed; this does not prove write permission.");
    return;
  }
  const checkOnly = args.includes("--check");
  const assertCleanMain = () => {
    if (git("branch", "--show-current") !== BRANCH) {
      throw new Error("Release only runs from main. Switch branches deliberately, then retry.");
    }
    if (git("status", "--porcelain", "--untracked-files=normal")) {
      throw new Error("Commit or deliberately remove your pending changes first. Nothing was pushed.");
    }
  };
  let testedCommit;
  if (!checkOnly) {
    log("Release target: Skyotechs/er-choices main. A successful push may deploy the live Railway API.");
    assertCleanMain();
    testedCommit = git("rev-parse", "HEAD");
    if (!/^[a-f0-9]{40,64}$/i.test(testedCommit)) throw new Error("Cannot identify the release commit.");
    assertNoTrackedCredentials(git("show", "HEAD:.replit"));
  }
  log("Running Speciality, hospital/report store, startup-safety, and release-command tests…");
  const tests = TEST_DIRS.flatMap(dir => fs.readdirSync(path.join(ROOT, dir))
    .filter(name => name.endsWith(".test.cjs")).sort().map(name => path.join(ROOT, dir, name)));
  run(process.execPath, ["--test", ...tests], {cwd: ROOT, env, stdio: "inherit"});
  log("Building the Railway API…");
  run("pnpm", ["--filter", "@workspace/api-server", "run", "build"], {
    cwd: ROOT, env, stdio: "inherit",
  });
  if (checkOnly) {
    log("Release checks passed. No GitHub push or deployment was performed.");
    return;
  }
  const assertUnchanged = () => {
    assertCleanMain();
    if (git("rev-parse", "HEAD") !== testedCommit) {
      throw new Error("The commit changed while checks ran. Rerun the release; nothing was pushed.");
    }
  };
  assertUnchanged();
  log("Checking current GitHub history (no merge, rebase, or reset)…");
  remote("fetch", "--quiet", "--no-tags", "--no-recurse-submodules", REPOSITORY, `refs/heads/${BRANCH}`);
  const remoteCommit = git("rev-parse", "FETCH_HEAD");
  if (remoteCommit === testedCommit) {
    log("GitHub main already has this tested commit. No new push or deployment requested.");
    return;
  }
  try {
    git("merge-base", "--is-ancestor", remoteCommit, testedCommit);
  } catch {
    throw new Error("GitHub main is ahead or has diverged. Reconcile it manually; nothing was pushed.");
  }
  assertUnchanged();
  // Pin the exact tested commit. Never force, bypass hooks, or push other branches/tags.
  remote("push", REPOSITORY, `${testedCommit}:refs/heads/${BRANCH}`);
  log(`Pushed tested commit ${testedCommit.slice(0, 12)} to GitHub main.`);
  log("Railway deploys only if its GitHub source, main branch, and autodeploy are configured.");
  log("Check Railway for this commit and deployment status. A successful push is not a completed deployment.");
}

if (require.main === module) {
  if (process.argv[2] === "--git-credential") {
    process.stdout.write(credentialReply(process.argv[3], fs.readFileSync(0, "utf8"), process.env));
  } else {
    try { runRelease({args: process.argv.slice(2)}); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
  }
}

module.exports = {runRelease, credentialReply, assertNoTrackedCredentials, REPOSITORY};
