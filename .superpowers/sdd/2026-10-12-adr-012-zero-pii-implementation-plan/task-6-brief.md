### Task 6: Псевдонимы гостей

**REQ:** REQ-ID-003 (уточнение амендмента v1.5: имя необязательно, псевдоним назначает сервер), REQ-RWD-011 по духу (CSPRNG вместо Math.random).

**Files:**
- Create: `packages/core/src/membership/pseudonym.ts` + `pseudonym.spec.ts`
- Modify: `packages/core/src/membership/membership.service.ts` (join: необязательное имя + генерация в tx; JoinResult += displayName)
- Modify: `packages/core/src/membership/membership.service.int-spec.ts` (+= кейсы)
- Modify: `packages/core/src/transport/join.controller.ts` (ответ — JoinResponse)

**Interfaces:**
- Consumes: T2 (`joinRequestSchema.displayName` optional, `joinResponseSchema`).
- Produces: `generatePseudonym(taken: ReadonlySet<string>, rnd?: (bound: number) => number): string`; `JoinResult.displayName: string`; join-ответ несёт фактический displayName (потребитель — T9 join-form).

- [ ] **Step 1: Падающие unit-тесты генератора** — `pseudonym.spec.ts`:

```ts
import { generatePseudonym } from './pseudonym';

// Детерминизм — инжекцией rnd (bound) => number. sequence([...]) отдаёт значения по кругу.
const sequence = (values: number[]) => {
  let i = 0;
  return (_bound: number) => values[i++ % values.length];
};

describe('generatePseudonym (ADR-012 §3)', () => {
  it('формат «Слово-NN»: словарное существительное + число 10–99', () => {
    const name = generatePseudonym(new Set(), sequence([0, 32]));
    expect(name).toMatch(/^[А-ЯЁ][а-яё]+-\d{2}$/);
  });
  it('retry при коллизии с активным ростером', () => {
    const first = generatePseudonym(new Set(), sequence([0, 42]));
    const second = generatePseudonym(new Set([first]), sequence([0, 42, 1, 42]));
    expect(second).not.toBe(first);
  });
  it('исчерпание 10–99 по слову ведёт к расширению диапазона 100–999', () => {
    // Все 90 имён «Лиса-10..99» заняты; rnd всегда выбирает «Лиса» и число.
    const taken = new Set(Array.from({ length: 90 }, (_, i) => `Лиса-${10 + i}`));
    const alwaysLisa = (bound: number) => (bound > 50 ? 0 : 0); // словарь[0] = 'Лиса' (алфавитный первый)
    const name = generatePseudonym(taken, alwaysLisa);
    expect(name).toMatch(/^Лиса-(1\d\d|\d{4})$/);
  });
});
```

(Уточнить детерминизм: словарь отсортирован, индекс слова = `rnd(NOUNS.length)`, число = `10 + rnd(90)`, расширение `100 + rnd(900)`.)

- [ ] **Step 2: Прогон — красные** (`pnpm --filter @mymozhem/core test -- pseudonym` — модуль не существует).

- [ ] **Step 3: Реализация** — `pseudonym.ts`:

```ts
import { randomInt } from 'node:crypto';

// Серверные псевдонимы гостей (ADR-012 §3, уточнение REQ-ID-003): система не
// требует реального имени ни в одном сценарии. Словарь — константа (решение
// §0.1 дизайна); случайность — crypto.randomInt, НЕ Math.random (дух REQ-RWD-011).
const NOUNS = [
  'Барсук', 'Белка', 'Ворона', 'Выдра', 'Ёж', 'Журавль', 'Заяц', 'Иволга', 'Кабан', 'Коза',
  'Коршун', 'Кошка', 'Куница', 'Ласка', 'Лиса', 'Лось', 'Мангуст', 'Медведь', 'Нерпа', 'Олень',
  'Орлан', 'Панда', 'Песец', 'Рысь', 'Сайга', 'Соболь', 'Сорока', 'Тигр', 'Уж', 'Филин',
  'Хорёк', 'Цапля', 'Чайка', 'Шакал', 'Щегол', 'Ястреб', 'Бобр', 'Гусь', 'Дрофа', 'Енот',
  'Жерех', 'Зубр', 'Крот', 'Лебедь', 'Мартышка', 'Ондатра', 'Пума', 'Росомаха', 'Сокол', 'Тюлень',
] as const;

export type RandomInt = (bound: number) => number;

// Уникальность — в рамках комнаты (пересечение с активным ростером — retry).
// 5 попыток «Слово-NN» (10–99), затем расширение «Слово-NNN» (100–999);
// теоретическое исчерпание — детерминированный скан suffix от 10 вверх
// (всегда терминирует; на практике недостижим — 50 слов × 990 номеров).
export function generatePseudonym(taken: ReadonlySet<string>, rnd: RandomInt = randomInt): string {
  const word = () => NOUNS[rnd(NOUNS.length)];
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = `${word()}-${10 + rnd(90)}`;
    if (!taken.has(candidate)) return candidate;
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = `${word()}-${100 + rnd(900)}`;
    if (!taken.has(candidate)) return candidate;
  }
  const base = word();
  for (let suffix = 10; ; suffix++) {
    const candidate = `${base}-${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}
```

- [ ] **Step 4: Падающие int-тесты join** — в `membership.service.int-spec.ts` (по образцу существующих кейсов join):

```ts
it('join без displayName: сервер назначает псевдоним «Слово-NN» (Review Focus 2)', async () => {
  const { identity } = await membership.join({ code: room.code, displayName: undefined, ip: '10.0.0.1' });
  expect(identity.displayName).toMatch(/^[А-ЯЁ][а-яё]+-\d+$/);
});
it('два безымянных гостя получают РАЗНЫЕ псевдонимы в одной комнате', async () => {
  const a = await membership.join({ code: room.code, displayName: undefined, ip: '10.0.0.2' });
  const b = await membership.join({ code: room.code, displayName: undefined, ip: '10.0.0.3' });
  expect(a.identity.displayName).not.toBe(b.identity.displayName);
});
it('заданное имя проходит без изменений (свободный ввод сохранён)', async () => {
  const { identity } = await membership.join({ code: room.code, displayName: 'Маша', ip: '10.0.0.4' });
  expect(identity.displayName).toBe('Маша');
});
```

Сигнатура `join` меняется: `displayName?: string` — прогнать typecheck спеков, поправить существующие вызовы (они передают имя — не сломаются).

- [ ] **Step 5: Реализация join** — в `membership.service.ts`:

```ts
// сигнатура:
async join(params: { code: string; displayName?: string; ip: string; role?: 'participant' | 'spectator' }): Promise<JoinResult>
// JoinResult += displayName: string (фактическое имя — заданное или псевдоним).
```

Тело: ранняя валидация только заданного имени (`const providedName = params.displayName === undefined ? undefined : displayNameSchema.parse(params.displayName);` — заменяет строку 202). Внутри `$transaction` до `createGuest`:

```ts
const name = providedName ?? generatePseudonym(await this.takenDisplayNames(tx, room.id));
const identity = await this.identity.createGuest(name, tx);
// ... return { membership, identity, displayName: name };
```

Новый приват:

```ts
// Имена активного ростера комнаты — для retry псевдонима (решение §0.1).
// Чтение в той же tx, что и создание гостя: видим свежие join этого запроса.
private async takenDisplayNames(tx: Prisma.TransactionClient, roomId: string): Promise<Set<string>> {
  const rows = await tx.membership.findMany({
    where: { roomId, deletedAt: null },
    select: { identity: { select: { displayName: true } } },
  });
  return new Set(rows.map((r) => r.identity.displayName).filter((n): n is string => n !== null));
}
```

`join.controller.ts`: тип ответа `Promise<JoinResponse>`, возврат `{ accessToken: ..., tokenType: 'Bearer', expiresIn: ..., displayName }` (displayName из результата join).

- [ ] **Step 6: Прогоны**

```bash
pnpm --filter @mymozhem/core test -- pseudonym
pnpm --filter @mymozhem/core test:int -- membership.service
pnpm --filter @mymozhem/server test   # join-потребители (e2e join/room-flow) — ответ join теперь шире; спеки, парсящие ответ join строго, поправить
```

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/membership packages/core/src/transport/join.controller.ts apps/server
git commit -m "feat(core): серверные псевдонимы гостей (ADR-012 §3) — displayName необязателен, генератор «Лиса-42» с retry по ростеру, join-ответ несёт фактическое имя"
```

---

## Батч C — механики/клиент/ops (сессия 3)

