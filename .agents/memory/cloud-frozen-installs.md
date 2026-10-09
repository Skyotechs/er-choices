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
