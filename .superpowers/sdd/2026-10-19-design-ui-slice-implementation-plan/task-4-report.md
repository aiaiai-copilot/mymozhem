# Task 4 report: `styles/` — токены, база, состояния, шрифты

**Status: DONE_WITH_CONCERNS** (всё реализовано и зелёное; concerns — два сознательных отступления от буквы мокапа/окружения, оба задокументированы ниже и в коде).

## What was implemented

- `apps/web/src/styles/tokens.css` — все 29 токенов темы «rybinsk» под `:root` с точными значениями из Interfaces брифа (сцена 11, консоль 15, тайминги 3, шрифты 3). Комментарий «вторая тема = переопределение токенов под `[data-theme=…]`» на месте; второй пресет НЕ создан (готовность без пресетов, дизайн п. 5).
- `apps/web/src/styles/base.css` — 6 блоков `@font-face` (Oranienbaum 400, PT Sans 400/700 × cyrillic/latin, `font-display: swap`, `unicode-range` скопированы из css2-ответа Google), reset из старого styles.css, `body` на `var(--font-body)`/`var(--ink)`, `.screen-question`/`.screen-options` переехали как есть (потребители живы до T8).
- `apps/web/src/styles/transitions.css` — кнопочная система из мокапа component-states-live: `.btn` (без `border` — `border: none`), `.btn-primary/-secondary/-quiet/-danger`, `.btn-scene`; hover только под `@media (hover: hover) and (pointer: fine)`; active с `transition-duration: var(--t-press)` (60ms); focus-visible 3px / offset 2px, `.btn-scene:focus-visible` — золотой контур; disabled `opacity: 0.55` + `:not(:disabled)` на hover/active; `@media (prefers-reduced-motion: reduce)` гасит переходы `.btn`.
- `apps/web/public/fonts/` — 6 woff2 (6.6–11.6 КБ каждый, `file` подтверждает валидный WOFF2): oranienbaum-400-cyrillic/latin, pt-sans-400-cyrillic/latin, pt-sans-700-cyrillic/latin. Blagovest НЕ скачан (гейт лицензии). В рантайме обращений к Google нет — файлы отдаются из `public/`.
- `apps/web/src/main.tsx` — импорты tokens → base → transitions вместо `./styles.css`.
- `apps/web/index.html` — `<html lang="ru" data-theme="rybinsk">`.
- `apps/web/src/styles.css` — удалён.
- `apps/web/src/styles/node-test-shims.d.ts` — ambient-декларации `node:fs`/`node:url` для спека (см. Concern 2).

## TDD Evidence

**RED** — `pnpm --filter @mymozhem/web test` после Step 1 (спек написан, css-файлов нет):

```
FAIL  src/styles/tokens.spec.ts [ src/styles/tokens.spec.ts ]
Error: ENOENT: no such file or directory, open '.../apps/web/src/styles/tokens.css'
Test Files  1 failed | 19 passed (20)
```

Ожидаемо: спек читает tokens.css/transitions.css через `fs.readFileSync`, файлы ещё не созданы.

**GREEN** — `pnpm --filter @mymozhem/web test` после Step 3:

```
Test Files  20 passed (20)
Tests  123 passed (123)
```

(+6 новых тестов: 31 токен точным значением, шрифтовые токены, точка темы, `.btn` border:none, hover только под медиа-запросом — включая проверку, что вне блока `:hover` нет вообще, reduced-motion.)

**Build** — `pnpm --filter @mymozhem/web build`: `✓ built`, все 6 woff2 скопированы в `dist/fonts/`, в собранном `dist/index.html` есть `data-theme="rybinsk"`, `@font-face` попали в собранный CSS. Warning о chunk >500kB — pre-existing, относится к JS-бандлу, не к этой задаче.

**Прочие гейты** (прогнаны перед коммитом): `pnpm --filter @mymozhem/web typecheck` — чисто; `pnpm --filter @mymozhem/web lint` — чисто. Тест-аутпут без stray warnings.

## Files changed

- Create: `apps/web/src/styles/tokens.css`, `base.css`, `transitions.css`, `tokens.spec.ts`, `node-test-shims.d.ts`, `apps/web/public/fonts/` (6 woff2)
- Modify: `apps/web/src/main.tsx`, `apps/web/index.html`
- Delete: `apps/web/src/styles.css`

## Self-review findings

Прогнал чеклист: все токены с точными значениями (проверяется спеком — зелёный); hover-правила только под `@media (hover: hover) and (pointer: fine)` (спек дополнительно ассертит отсутствие `:hover` вне блока); reduced-motion блок есть; `.btn` с `border: none`; woff2 непустые и валидные, build подхватывает. Новых npm-зависимостей нет, `pnpm install` не запускался, lockfile не тронут.

## Issues / concerns

1. **Расхождения мокапа с брифом (решено в пользу брифа):**
   - Мокап скоупит сцену обёрткой `.panel.dark` (`.panel.dark .btn-scene:hover`, `.panel.dark .btn:focus-visible`) — в приложении такой обёртки нет, а бриф перечисляет классы без неё. Сцена определена классом `.btn-scene`: hover/active/focus-visible правила привязаны к `.btn-scene` (focus-visible золотой — `.btn-scene:focus-visible { outline-color: var(--gold); }`, идёт после базового `.btn:focus-visible` при равной специфичности). Зафиксировано комментарием в transitions.css.
   - Литералы мокапа `#f3dcd2`/`#eccfc4` в `.btn-danger` заменены токенами `--danger-hover`/`--danger-active` из брифа (значения совпадают); `--track` мокапа → `--track-canvas-light` брифа; `font-family: 'PT Sans', sans-serif` в `.btn` → `var(--font-body)`; цвет текста сцены `#F6EDDC` → `var(--scene-text)`. Значения не менялись, только токенизация.
2. **`node-test-shims.d.ts` — отступление от «как есть»:** бриф предписывает `fs.readFileSync` в спеке, и vitest (environment: node) его подхватывает, но `tsc -p tsconfig.json --noEmit` падал: apps/web — браузерный пакет с `types: ["vite/client"]`, `@types/node` в workspaces не поднят (есть только в .pnpm-сторе), а новые зависимости и `pnpm install` запрещены. Решение: ambient-декларации двух используемых функций в отдельном глобальном `.d.ts` (внутри spec-файла `declare module` не работает — TS2664, файл является модулем). Комментарий в файле: удалить, если в пакет добавят `@types/node`. Runtime использует настоящие node-модули, механизм брифа сохранён.
3. **Кейс hex-значений:** бриф даёт `--muted #5A6B66` и `--muted-scene #9DB8B2` в верхнем регистре, мокап — в нижнем (`#5a6b66`, `#9db8b2`). Взято verbatim из брифа (верхний регистр); значения идентичны.
