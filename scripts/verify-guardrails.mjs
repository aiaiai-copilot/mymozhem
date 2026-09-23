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

// 4) Rewards-boundary probe: a core domain outside rewards importing rewards
// (forbidden: rewards-only-through-di-tokens, REQ-RWD-001 — связка только
// через DI-токены AWARD_EFFECT_HANDLER / ANONYMIZATION_GUARDS). Импорт
// относительный: пакетный путь '@mymozhem/core/src/…' depcruise не резолвит,
// и probe ловил бы not-to-unresolvable вместо целевого правила.
const rewardsProbe = 'packages/core/src/room/__probe-rewards-boundary.ts';
writeFileSync(
  rewardsProbe,
  "import '../rewards/rewards.module';\nexport const probe = 1;\n",
);

// 5) Math.random probe: случайность app-модуля через Math.random
// (forbidden: REQ-RWD-011 — только ctx.randomInt, CSPRNG хоста).
const mathRandomProbe = 'packages/app-quiz/src/__probe-math-random.ts';
writeFileSync(mathRandomProbe, 'export const x = Math.random();\n');

// 6) Web-boundary probe: apps/web импортирует core напрямую (forbidden:
// web-only-through-sdk-and-app-packages — web видит только контракт sdk и
// чистые app-пакеты, ADR-002). Относительный импорт по прецеденту probes 1/3/4.
const webCoreProbe = 'apps/web/src/__guardrail_probe__.ts';
writeFileSync(
  webCoreProbe,
  "import '../../../packages/core/src/health/health.module';\nexport const probe = 1;\n",
);

// 7) Web-socket probe: socket.io-client вне apps/web/src/realtime (forbidden:
// web-socketio-only-in-realtime — зеркало REQ-RT-006 на клиенте). Прямой
// пакетный spec: правило матчится по node_modules-пути резолва.
const webSocketProbe = 'apps/web/src/__probe-socket__.ts';
writeFileSync(webSocketProbe, "import 'socket.io-client';\nexport const probe = 1;\n");

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
  expectFailure(
    'core domain → rewards import (dependency-cruiser)',
    `pnpm exec depcruise ${rewardsProbe} --config .dependency-cruiser.cjs`,
  );
  expectFailure(
    'Math.random in app module (eslint)',
    `pnpm exec eslint ${mathRandomProbe}`,
  );
  expectFailure(
    'web → core import (dependency-cruiser)',
    `pnpm exec depcruise ${webCoreProbe} --config .dependency-cruiser.cjs`,
  );
  expectFailure(
    'socket.io-client outside web/src/realtime (dependency-cruiser)',
    `pnpm exec depcruise ${webSocketProbe} --config .dependency-cruiser.cjs`,
  );
} finally {
  rmSync(boundaryProbe, { force: true });
  rmSync('scripts/__probe__', { recursive: true, force: true });
  rmSync(appsProbe, { force: true });
  rmSync(rewardsProbe, { force: true });
  rmSync(mathRandomProbe, { force: true });
  rmSync(webCoreProbe, { force: true });
  rmSync(webSocketProbe, { force: true });
}

if (process.exitCode) {
  console.error('\nGuardrails are NOT enforcing. Fix before merge.');
} else {
  console.log('\nAll guardrails verified alive.');
}
