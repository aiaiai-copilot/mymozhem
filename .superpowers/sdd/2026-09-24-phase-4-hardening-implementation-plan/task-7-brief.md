### Task 7: LOG_LEVEL + pino-конфигурация (PinoLoggerModule)

**Закрывает:** REQ-OPS-004 (логи — инфраструктура), REQ-OPS-003 (LOG_LEVEL в единой схеме). Дизайн §2.

**Files:**
- Modify: `packages/core/package.json` (deps `nestjs-pino`, `pino`, `pino-http`)
- Modify: `packages/core/src/config/config.schema.ts`
- Modify: `packages/core/src/testing/test-config.ts`
- Create: `packages/core/src/observability/pino-logger.module.ts`
- Create: `packages/core/src/observability/pino-options.spec.ts`

**Interfaces:**
- Consumes: `ObservabilityModule`-каталог (Task 6), `APP_CONFIG`.
- Produces: `LOG_LEVEL` в `AppConfig` (pino-уровни, дефолт `'info'`); `buildPinoHttpOptions(config: AppConfig)` (чистая фабрика: level, genReqId с `x-request-id`, redact authorization/cookie); `PINO_STREAM` (Symbol, опциональное назначение логов для тестов); `PinoLoggerModule` (dynamic module const — импорт только по ссылке). Потребители — Tasks 8/9.

- [ ] **Step 0: Зависимости**

Run: `pnpm --filter @mymozhem/core add nestjs-pino@^4.4.0 pino@^9.6.0 pino-http@^10.4.0`

- [ ] **Step 1: RED — конфиг**

`config.schema.ts` — в объект схемы (после `OAUTH_RATE_LIMIT`):

```ts
  // REQ-OPS-004 (ф.4): уровень структурных логов (pino levels).
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
```

`test-config.ts` — добавить поле (иначе typecheck TEST_CONFIG упадёт — это и есть RED формы конфига):

```ts
  LOG_LEVEL: 'warn', // меньше шума в лане; спеки на уровень конструируют конфиг сами
```

Run: `pnpm --filter @mymozhem/core test -- config.schema.spec` → прогон существующей спеки (зелёный — поле с дефолтом обратно-совместимо); RED несёт спека шага 2.

- [ ] **Step 2: RED — `pino-options.spec.ts`**

```ts
import { TEST_CONFIG } from '../testing/test-config';
import { buildPinoHttpOptions } from './pino-logger.module';

// REQ-OPS-004 (ф.4, дизайн §2): опции pino-http — чистая фабрика, юнит-гейты.
describe('buildPinoHttpOptions (REQ-OPS-004)', () => {
  it('уровень — из конфига', () => {
    expect(buildPinoHttpOptions({ ...TEST_CONFIG, LOG_LEVEL: 'debug' }).level).toBe('debug');
  });

  it('redact маскирует authorization и cookie (Review Focus 5)', () => {
    const opts = buildPinoHttpOptions(TEST_CONFIG);
    expect(opts.redact.paths).toEqual(['req.headers.authorization', 'req.headers.cookie']);
  });

  it('genReqId генерирует uuid и отражает его в заголовок x-request-id', () => {
    const setHeader = jest.fn();
    const id = buildPinoHttpOptions(TEST_CONFIG).genReqId({ headers: {} }, { setHeader });
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(setHeader).toHaveBeenCalledWith('x-request-id', id);
  });
});
```

Run: `pnpm --filter @mymozhem/core test -- pino-options.spec` → FAIL (модуля нет).

- [ ] **Step 3: GREEN — `pino-logger.module.ts`**

```ts
import { randomUUID } from 'node:crypto';
import { LoggerModule } from 'nestjs-pino';
import { ConfigModule } from '../config/config.module';
import { APP_CONFIG } from '../config/config.tokens';
import type { AppConfig } from '../config/config.schema';

// REQ-OPS-004 (ф.4, дизайн §2): структурные JSON-логи поверх nestjs-pino.
// Корреляция requestId — из genReqId (pino-http кладёт его в req.id и в каждую
// строку лога запроса); roomId/actorId привязываются потребителями через
// logger.assign/поля в операционных точках (Task 8), не middleware-магией.

// Опциональное назначение логов: прод — stdout (pino default); тесты подставляют
// буферный Writable и читают фактические JSON-строки (observability.int-spec).
export const PINO_STREAM = Symbol('PINO_STREAM');

interface GenReqIdReq {
  headers: Record<string, unknown>;
}
interface GenReqIdRes {
  setHeader(name: string, value: string): void;
}

// Чистая фабрика опций pino-http — юнит-тестируема без Nest (pino-options.spec).
export function buildPinoHttpOptions(config: AppConfig): {
  level: string;
  genReqId: (req: GenReqIdReq, res: GenReqIdRes) => string;
  redact: { paths: string[]; censor: string };
} {
  return {
    level: config.LOG_LEVEL,
    // requestId — uuid; отражаем в ответ для разбора инцидентов с игроками.
    genReqId: (_req: GenReqIdReq, res: GenReqIdRes): string => {
      const id = randomUUID();
      res.setHeader('x-request-id', id);
      return id;
    },
    // Тела и payload'ы не логируются нормой дизайна; секретные заголовки маскируем.
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie'],
      censor: '[redacted]',
    },
  };
}

// Dynamic module определён ОДИН раз и импортируется только по ссылке — Nest
// дедуплицирует его по метаданным, повторный импорт в дереве не порождает
// дубль-регистрацию провайдеров. LoggerModule nestjs-pino — @Global: после
// включения в дерево PinoLogger резолвится в любом модуле этого дерева.
export const PinoLoggerModule = LoggerModule.forRootAsync({
  imports: [ConfigModule],
  inject: [APP_CONFIG, { token: PINO_STREAM, optional: true }],
  useFactory: (config: AppConfig, stream?: unknown) => ({
    pinoHttp: stream === undefined ? buildPinoHttpOptions(config) : { ...buildPinoHttpOptions(config), stream },
  }),
});
```

- [ ] **Step 4: Запустить — GREEN + typecheck/lint**

Run: `pnpm --filter @mymozhem/core test -- pino-options.spec` → PASS.
Run: `pnpm --filter @mymozhem/core typecheck && pnpm --filter @mymozhem/core lint` → зелёные.

- [ ] **Step 5: Commit**

```bash
git add packages/core/package.json pnpm-lock.yaml packages/core/src/config/config.schema.ts packages/core/src/testing/test-config.ts packages/core/src/observability/pino-logger.module.ts packages/core/src/observability/pino-options.spec.ts
git commit -m "feat(core): LOG_LEVEL config + PinoLoggerModule (nestjs-pino, requestId, redact) — REQ-OPS-004"
```

---

