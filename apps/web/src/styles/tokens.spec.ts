import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Типы node:fs/node:url — в соседнем node-test-shims.d.ts: apps/web —
// браузерный пакет без @types/node (tsconfig: types ["vite/client"]), но spec
// исполняется vitest в node-окружении (vite.config test.environment).

// Контракт визуального фундамента (T4): токены темы «rybinsk» и кнопочная
// система состояний. Значения — verbatim из брифа (дизайн §4 + принятый мокап
// component-states-live); спек ловит случайный дрейф значений.

const readStyle = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`./${name}`, import.meta.url)), 'utf8');

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Извлекает блок @media по подстроке запроса со сбалансированными скобками.
// Возвращает [блок, css без блока] — нужно, чтобы проверить, что hover-правила
// не существуют вне медиа-запроса (hover: hover) and (pointer: fine).
function extractMediaBlock(css: string, query: string): [string, string] {
  const start = css.indexOf(query);
  expect(start, `медиа-запрос ${query} должен присутствовать`).toBeGreaterThanOrEqual(0);
  const mediaStart = css.lastIndexOf('@media', start);
  const openBrace = css.indexOf('{', start);
  let depth = 0;
  let end = -1;
  for (let i = openBrace; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    if (css[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  expect(end, `медиа-запрос ${query} должен быть закрыт`).toBeGreaterThan(-1);
  const block = css.slice(mediaStart, end + 1);
  return [block, css.slice(0, mediaStart) + css.slice(end + 1)];
}

describe('tokens.css — токены темы rybinsk', () => {
  const css = readStyle('tokens.css');

  const exactTokens: Array<[string, string]> = [
    // сцена (тёмный контур)
    ['--scene-bg', '#0A252B'],
    ['--scene-surface', '#1B3B40'],
    ['--scene-surface-hover', '#23484D'],
    ['--scene-surface-active', '#122E32'],
    ['--gold', '#E6C77D'],
    ['--scene-text', '#F6EDDC'],
    ['--muted-scene', '#9DB8B2'],
    ['--error-dark', '#F27668'],
    ['--input-scene', '#A9BDB2'],
    ['--track-fill', '#0F7B57'],
    ['--track-canvas-dark', '#143138'],
    // консоль (светлый контур)
    ['--console-bg', '#E3F0E9'],
    ['--console-panel', '#F4F8F3'],
    ['--console-strip', '#D7E8DE'],
    ['--console-secondary', '#C4D8CC'],
    ['--console-primary', '#10514F'],
    ['--console-primary-hover', '#17685F'],
    ['--console-primary-active', '#0A3E3B'],
    ['--console-secondary-hover', '#B4CDBC'],
    ['--console-secondary-active', '#A3BFA9'],
    ['--ink', '#12343A'],
    ['--muted', '#5A6B66'],
    ['--error-light', '#A92820'],
    ['--track-canvas-light', '#D5E2DA'],
    ['--danger-hover', '#F3DCD2'],
    ['--danger-active', '#ECCFC4'],
    // мокапные литералы, поднятые в токены (T13): placeholder поля входа и
    // verdict-цвета сцены, ok-зелёный и белый фон полей консоли
    ['--placeholder-scene', '#354B41'],
    ['--verdict-success', '#8FCAA5'],
    ['--verdict-danger', '#E5A092'],
    ['--ok', '#2F6B4F'],
    ['--input-console', '#FFFFFF'],
    // тайминги
    ['--t-hover', '140ms'],
    ['--t-press', '60ms'],
    ['--t-race', '300ms'],
  ];

  it('все токены объявлены под :root с точными значениями', () => {
    expect(css).toContain(':root');
    for (const [name, value] of exactTokens) {
      const re = new RegExp(`${escapeRe(name)}\\s*:\\s*${escapeRe(value)}\\s*;`);
      expect(css, `ожидался токен ${name}: ${value};`).toMatch(re);
    }
  });

  it('шрифтовые токены указывают на self-hosted семейства', () => {
    const fontTokens: Array<[string, string]> = [
      ['--font-logo', "'Oranienbaum'"],
      ['--font-display', "'Oranienbaum'"],
      ['--font-body', "'PT Sans'"],
    ];
    for (const [name, family] of fontTokens) {
      const m = css.match(new RegExp(`${escapeRe(name)}\\s*:\\s*([^;]+);`));
      expect(m, `ожидался токен ${name}`).not.toBeNull();
      expect(m![1]).toContain(family);
    }
  });

  it('точка расширения темы зафиксирована: вторая тема = переопределение под [data-theme=…]', () => {
    expect(css).toContain('[data-theme=');
  });

  it('точка темы включена: index.html несёт data-theme="rybinsk"', () => {
    // Carry батча B: спек касается tokens.css — заодно пиним точку темы.
    const html = readFileSync(
      fileURLToPath(new URL('../../index.html', import.meta.url)),
      'utf8',
    );
    expect(html).toContain('data-theme="rybinsk"');
  });
});

describe('мокапные литералы подняты в токены (T13)', () => {
  // Литералы, которые жили инлайн в scene.css/console.css («в токенах T4 нет…»):
  // после подъёма файлы обязаны ссылаться на var(--…), а не держать hex.
  const liftedLiterals: Array<{ file: string; hex: string }> = [
    { file: 'scene.css', hex: '#354b41' }, // placeholder поля участника
    { file: 'scene.css', hex: '#8fcaa5' }, // verdict success
    { file: 'scene.css', hex: '#e5a092' }, // verdict danger
    { file: 'console.css', hex: '#2f6b4f' }, // ok-зелёный полосы связи
    { file: 'console.css', hex: '#fff' }, // фон полей ввода
  ];

  it('scene.css/console.css не содержат поднятые hex-литералы (регистронезависимо)', () => {
    const files = new Map<string, string>();
    for (const { file, hex } of liftedLiterals) {
      const css = files.get(file) ?? readStyle(file);
      files.set(file, css);
      // Граница слова после короткого hex: «#fff» не должно матчить «#ffffff».
      const re = new RegExp(`${escapeRe(hex)}(?![0-9a-f])`, 'i');
      expect(css, `${file} не должен содержать литерал ${hex}`).not.toMatch(re);
    }
  });
});

describe('transitions.css — кнопочная система состояний', () => {
  const css = readStyle('transitions.css');

  it('.btn объявлен без border (border: none)', () => {
    const m = css.match(/\.btn\s*\{([^}]*)\}/);
    expect(m, 'ожидался базовый блок .btn').not.toBeNull();
    expect(m![1]).toMatch(/border:\s*none/);
  });

  it('hover-правила живут только под @media (hover: hover) and (pointer: fine)', () => {
    const [block, rest] = extractMediaBlock(css, '(hover: hover) and (pointer: fine)');
    expect(block).toContain(':hover');
    expect(rest, 'вне hover-медиа не должно быть :hover-правил').not.toContain(':hover');
  });

  it('reduced-motion гасит переходы', () => {
    const [block] = extractMediaBlock(css, '(prefers-reduced-motion: reduce)');
    expect(block).toMatch(/transition-duration:\s*0ms/);
  });
});
