/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'sdk-is-leaf',
      comment: 'SDK не импортирует внутренние пакеты — это лист контракта (REQ-CTR-002).',
      severity: 'error',
      from: { path: '^packages/sdk/src' },
      to: { path: '^packages/', pathNot: '^packages/sdk/' },
    },
    {
      name: 'app-only-through-sdk',
      comment: 'App-модуль общается с ядром только через SDK, не напрямую (REQ-CTR-001).',
      severity: 'error',
      from: { path: '^packages/app-' },
      to: { path: '^packages/core/' },
    },
    {
      name: 'web-only-through-sdk-and-app-packages',
      severity: 'error',
      comment: 'apps/web видит только контракт (sdk) и чистые app-пакеты; core — за границей (ADR-002).',
      from: { path: '^apps/web/src' },
      to: { path: '^packages/', pathNot: ['^packages/sdk/', '^packages/app-quiz/', '^packages/app-lottery/'] },
    },
    {
      name: 'web-no-cross-app-imports',
      severity: 'error',
      comment: 'apps/web не импортирует другие apps/* — путь в core только через sdk (дизайн UI-среза §2).',
      from: { path: '^apps/web/src' },
      to: { path: '^apps/', pathNot: '^apps/web/' },
    },
    {
      name: 'web-socketio-only-in-realtime',
      severity: 'error',
      comment: 'socket.io-client — только в apps/web/src/realtime (зеркало REQ-RT-006 на клиенте).',
      from: { path: '^apps/web/src', pathNot: '^apps/web/src/realtime' },
      to: { path: 'node_modules/socket[.]io-client' },
    },
    {
      name: 'apps-only-through-core-entrypoint',
      comment:
        'apps/* обращаются к ядру только через пакетный entrypoint @mymozhem/core, не в его src-внутренности (ADR-002, REQ-DEV-001).',
      severity: 'error',
      from: { path: '^apps/' },
      to: { path: '^packages/core/src' },
    },
    {
      name: 'socketio-only-in-realtime',
      comment: 'socket.io импортируется только из Realtime-модуля ядра (REQ-RT-006).',
      severity: 'error',
      // dist/** — скомпилированное эхо src (CI круизит после build): .d.ts gateway
      // легально ссылается на типы socket.io; правило проверяет исходники.
      from: { pathNot: ['^packages/core/src/realtime', '[/\\\\]dist[/\\\\]'] },
      // Якорь на сам server-пакет (слэш после имени): socket.io-client — тестовый
      // клиент провода (apps/server/test e2e), а не реализация транспорта;
      // REQ-RT-006 ограничивает импорт server-библиотеки (решение владельца, Task 8).
      to: { path: 'node_modules/socket[.]io[/\\\\]' },
    },
    {
      name: 'rewards-only-through-di-tokens',
      comment:
        'Ядро не зависит от rewards (REQ-RWD-001): связка — DI-токены AWARD_EFFECT_HANDLER ' +
        '(app-runtime/effects) и ANONYMIZATION_GUARDS (identity); единственные точки, ' +
        'импортирующие core/rewards, — barrel index.ts и сам модуль rewards.',
      severity: 'error',
      from: {
        path: '^packages/core/src',
        // int-spec — миниатюра composition root: интеграционный тест законно
        // собирает реальный RewardsModule/RewardsService для проверки связки
        // (guest-sweep.int-spec, app-runtime.int-spec); правило про продакшн-код.
        pathNot: ['^packages/core/src/rewards', '^packages/core/src/index\\.ts$', '[.]int-spec[.]ts$'],
      },
      to: { path: '^packages/core/src/rewards' },
    },
    {
      name: 'no-circular',
      comment: 'Циклические зависимости запрещены.',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'not-to-unresolvable',
      comment: 'Импорт несуществующего модуля — ошибка (ловит опечатки; делает gate-probe независимым от порядка задач).',
      severity: 'error',
      from: {},
      to: { couldNotResolve: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.base.json' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      // depcruise по умолчанию игнорирует package.json "exports" (exportsFields: [] —
      // наследие enhanced-resolve 4), а современные ESM-пакеты (@vitejs/plugin-react)
      // публикуют точку входа ТОЛЬКО через exports → ложный not-to-unresolvable.
      // Включаем exports; conditionNames обязаны быть заданы явно — дефолт depcruise
      // пуст, и условные exports (zod: types/import/require без default) не резолвятся.
      exportsFields: ['exports'],
      conditionNames: ['types', 'import', 'require', 'node', 'default'],
    },
  },
};
