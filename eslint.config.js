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
);
