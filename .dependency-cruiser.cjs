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
  },
};
