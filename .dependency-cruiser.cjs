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
      from: { pathNot: '^packages/core/src/realtime' },
      to: { path: 'node_modules/socket[.]io' },
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
