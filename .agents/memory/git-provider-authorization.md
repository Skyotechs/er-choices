---
name: Git provider authorization
description: Native GitHub source-control authorization can differ from integration and CLI status.
---

Do not treat a healthy native source-control provider as proof that GitHub CLI authentication or repository write permission works.

**Why:** The provider reported active and healthy while the CLI required authentication. Its native connection could not use either the integration reconnect card or the ordinary connection proposal; those flows required a different connection/connector binding.

**How to apply:** Follow the provider's native source-control instructions rather than repeatedly proposing the same connection ID. Consult current Replit documentation for account-level GitHub reconnection when inline authorization is unavailable. A public repository read does not verify push permission, and reconnecting does not authorize a push or deployment.
