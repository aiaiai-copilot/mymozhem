## Task 8: CI workflow

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: root scripts (`lint`, `typecheck`, `test`, `build`, `guardrails`) and `prisma generate`.

- [ ] **Step 1: Create `.github/workflows/ci.yml`**

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 11.1.3
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec prisma generate
      - run: pnpm run typecheck
      - run: pnpm run lint
      - run: pnpm run test
      - run: pnpm run build
      - run: pnpm run guardrails
```

- [ ] **Step 2: Verify every CI step passes locally (CI mirrors these)**

Run: `pnpm install --frozen-lockfile && pnpm exec prisma generate && pnpm run typecheck && pnpm run lint && pnpm run test && pnpm run build && pnpm run guardrails`
Expected: every command exits 0; `guardrails` prints "All guardrails verified alive."

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: lint/typecheck/test/build + guardrails on every PR (REQ-DEV-001)"
```

---

