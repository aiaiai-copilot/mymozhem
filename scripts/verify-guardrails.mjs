// Proves the guardrails themselves are alive: injects a KNOWN violation and
// asserts each enforcer fails on it. A silently-green fence is the v1 failure
// mode this closes (ADR-002, REQ-DEV-001).
import { execSync } from 'node:child_process';
import { writeFileSync, rmSync, mkdirSync } from 'node:fs';

function expectFailure(label, cmd) {
  try {
    execSync(cmd, { stdio: 'pipe' });
  } catch {
    console.log(`OK   — guardrail fired on: ${label}`);
    return;
  }
  console.error(`FAIL — guardrail did NOT fire on: ${label}`);
  process.exitCode = 1;
}

// 1) Boundary probe: a file in sdk importing core (forbidden: sdk is a leaf).
const boundaryProbe = 'packages/sdk/src/__guardrail_probe__.ts';
writeFileSync(
  boundaryProbe,
  "import '../../core/src/health/health.module';\nexport const probe = 1;\n",
);

// 2) Mutable-state probe: a top-level `let` export (forbidden: REQ-CORE-004).
mkdirSync('scripts/__probe__', { recursive: true });
const mutableProbe = 'scripts/__probe__/mutable.ts';
writeFileSync(mutableProbe, 'export let leaked = 1;\nleaked = 2;\n');

// 3) Apps-boundary probe: a file in apps/server deep-importing core's src
// internals instead of the package entrypoint (forbidden: apps-only-through-core-entrypoint).
const appsProbe = 'apps/server/src/__guardrail_probe__.ts';
writeFileSync(
  appsProbe,
  "import '../../../packages/core/src/health/health.module';\nexport const probe = 1;\n",
);

try {
  expectFailure(
    'sdk → core import (dependency-cruiser)',
    `pnpm exec depcruise ${boundaryProbe} --config .dependency-cruiser.cjs`,
  );
  expectFailure(
    'module-level mutable export (eslint)',
    `pnpm exec eslint ${mutableProbe} --no-ignore`,
  );
  expectFailure(
    'apps → core src-internals import (dependency-cruiser)',
    `pnpm exec depcruise ${appsProbe} --config .dependency-cruiser.cjs`,
  );
} finally {
  rmSync(boundaryProbe, { force: true });
  rmSync('scripts/__probe__', { recursive: true, force: true });
  rmSync(appsProbe, { force: true });
}

if (process.exitCode) {
  console.error('\nGuardrails are NOT enforcing. Fix before merge.');
} else {
  console.log('\nAll guardrails verified alive.');
}
