const js = require('@eslint/js');
const tseslint = require('typescript-eslint');

const moduleLevelMutableRule = {
  'no-restricted-syntax': [
    'error',
    {
      selector: "Program > VariableDeclaration[kind='let']",
      message: 'Мутабельное module-level состояние запрещено (REQ-CORE-004).',
    },
    {
      selector: "Program > VariableDeclaration[kind='var']",
      message: 'Мутабельное module-level состояние запрещено (REQ-CORE-004).',
    },
    {
      selector: "Program > ExportNamedDeclaration > VariableDeclaration[kind='let']",
      message: 'Мутабельный module-level экспорт запрещён (REQ-CORE-004).',
    },
    {
      selector: "Program > ExportNamedDeclaration > VariableDeclaration[kind='var']",
      message: 'Мутабельный module-level экспорт запрещён (REQ-CORE-004).',
    },
  ],
};

module.exports = tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '.turbo/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    rules: moduleLevelMutableRule,
  },
  {
    // REQ-RWD-011 (решение владельца 2026-09-10): случайность app-модулей —
    // только ctx.randomInt (CSPRNG хоста); Math.random отсекается машиной.
    files: ['packages/app-*/src/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.object.name='Math'][callee.property.name='random']",
          message: 'Случайность app-модулей — только ctx.randomInt (CSPRNG хоста, REQ-RWD-011).',
        },
      ],
    },
  },
);
