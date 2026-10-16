---
name: Cloud frozen installs
description: Interpreting incompatible lockfile warnings during external mobile builds.
---

When a cloud dependency install warns that it is ignoring an incompatible
lockfile and then reports an overrides mismatch, check the build server's
pnpm version before changing dependencies or regenerating the lockfile.

**Why:** A lockfile that passes a frozen install locally can be rejected by
a different pnpm version; the overrides error alone does not establish
that the repository's dependency configuration is inconsistent.

**How to apply:** Keep the repository and external build profiles on the
same pnpm version. Verify a frozen install with that version, and ensure
the external rebuild uses the updated source commit. Do not disable
frozen installation as the default fix.

When source files are uploaded manually, check the actual remote files at their
original monorepo paths. A committed root package-manager pin does not establish
that the app-subdirectory cloud build configuration was updated; a duplicate
configuration uploaded at the repository root is not a substitute.

**Why:** Manual uploads can leave the cloud builder reading an older app-specific
configuration even though a new repository commit exists.

Preserve each workspace package's own manifest when uploading files manually;
do not substitute the root manifest for an artifact manifest.

**Why:** Files share the name `package.json` but have different roles. A misplaced
root manifest can remove the API's workspace identity, and a filtered pnpm build
can otherwise succeed without matching any package or producing a server bundle.

**How to apply:** Compare full repository paths and package identity, not just
filenames. Make production filtered builds fail on zero matches and require the
expected entry bundle before allowing the container build to finish. If the
corrected manifest adds shared workspace dependencies, release their source
packages alongside it rather than uploading only the manifest.
