import { useEffect, useState, type FormEvent } from 'react';
import type { PrizeResponse, ProjectedEvent } from '@mymozhem/sdk';
import { LOTTERY_APP_ID } from '@mymozhem/app-lottery';
import { ApiError } from '../../api/api-error';
import { createPrize, listPrizes } from '../../api/endpoints';
import { hostClient } from './host-session';

// Попытка розыгрыша: drawId — клиентский uuid, ключ идемпотентности команды
// lottery.draw.run (манифест app-lottery; дизайн ф.3 §4).
export interface DrawAttempt {
  drawId: string;
  prizeId: string;
}

// Селектор «приз доступен для розыгрыша» (бриф Task 15): остаток фонда > 0.
export const isDrawable = (prize: PrizeResponse): boolean => prize.quantity > 0;

// Одна попытка за раз: повторный клик до ack обязан вернуть null и НЕ тратить
// новый drawId — два разных ключа были бы двумя розыгрышами одного приза.
export const startDrawAttempt = (
  prize: PrizeResponse,
  pending: DrawAttempt | null,
  makeDrawId: () => string,
): DrawAttempt | null => {
  if (pending !== null || !isDrawable(prize)) return null;
  return { drawId: makeDrawId(), prizeId: prize.id };
};

// Текст для синхронного отказа генератора drawId (см. tryStartDrawAttempt).
export const DRAW_ID_GENERATION_FAILED =
  'Действие не выполнено: браузер не даёт сгенерировать идентификатор розыгрыша (нужен HTTPS или localhost).';

// crypto.randomUUID() бросает СИНХРОННО вне secure context (plain-HTTP в LAN) —
// без перехвата onClick умирал бы молча, и ведущий не понял бы, почему розыгрыш
// не пошёл. Бросок превращаем в текст ошибки панели; попытка при этом не
// создаётся и pending не ставится. Фолбэк-генератор НЕ заводим: единственный
// разрешённый источник drawId — crypto.randomUUID() (глобальный констрейнт),
// замена потребовала бы решения владельца.
export const tryStartDrawAttempt = (
  prize: PrizeResponse,
  pending: DrawAttempt | null,
  makeDrawId: () => string,
): { attempt: DrawAttempt | null; error: string | null } => {
  try {
    return { attempt: startDrawAttempt(prize, pending, makeDrawId), error: null };
  } catch {
    return { attempt: null, error: DRAW_ID_GENERATION_FAILED };
  }
};

// UX-маппинг ошибок REST/publish панели — тот же стиль, что commandErrorText
// на console-page: человеческий глагол + честный код (REQ-SEC-006).
const panelErrorText = (e: unknown): string => {
  if (e instanceof ApiError) return `Действие не выполнено (${e.code}).`;
  return 'Ошибка сети. Действие не выполнено.';
};

// Публичные события, после которых остатки фонда могли измениться: awarded —
// серверный декремент при розыгрыше, revoked — возврат quantity при отзыве
// (rewards.service). Оба public (REWARDS_EVENTS) — visibility-дисциплина.
const PRIZE_REFETCH_EVENTS = new Set(['rewards.reward.awarded', 'rewards.reward.revoked']);

interface PrizesPanelProps {
  roomId: string;
  // Пин приложения из payload core.room.activated (REQ-RT-004): кнопка
  // «Разыграть» рисуется только в lottery-комнате.
  pinnedAppId: string | null;
  // Терминальный статус комнаты: сервер не примет ни createPrize
  // (ROOM_NOT_ACTIVE), ни draw.run в не-ACTIVE комнате — отсекаем заранее.
  disabled: boolean;
  // Лог — триггер событийного рефетча остатков (см. PRIZE_REFETCH_EVENTS).
  events: ProjectedEvent[];
  publish: (type: string, payload: Record<string, unknown>) => Promise<void>;
}

// Панель призов и розыгрыша (бриф Task 15): форма name+quantity → createPrize →
// рефетч; в lottery-комнате у приза с quantity>0 — «Разыграть» → publish
// lottery.draw.run; результат приезжает draw.completed и виден в <Winners>.
// draw.completed сам модуль коммитит — клиент его не публикует никогда.
export function PrizesPanel({ roomId, pinnedAppId, disabled, events, publish }: PrizesPanelProps) {
  const [prizes, setPrizes] = useState<PrizeResponse[] | null>(null);
  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [creating, setCreating] = useState(false);
  const [pendingDraw, setPendingDraw] = useState<DrawAttempt | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Панель сама владеет списком призов: prizes — контур консоли организатора,
  // в общий useRoomFeed они не входят (табло/экран их не видят).
  useEffect(() => {
    let stale = false;
    listPrizes(hostClient, roomId)
      .then((r) => {
        if (!stale) setPrizes(r.prizes);
      })
      .catch((e: unknown) => {
        if (!stale) setError(panelErrorText(e));
      });
    return () => {
      stale = true;
    };
  }, [roomId]);

  // Событийный рефетч остатков: awarded/revoked меняют quantity на сервере.
  // Тот же паттерн, что событийный рефетч ростера в useRoomFeed.
  useEffect(() => {
    const last = events[events.length - 1];
    if (!last || !PRIZE_REFETCH_EVENTS.has(last.type)) return;
    listPrizes(hostClient, roomId)
      .then((r) => setPrizes(r.prizes))
      // Best effort: устаревший остаток самоисправится на следующем событии.
      .catch(() => {});
  }, [events, roomId]);

  const submitPrize = (e: FormEvent) => {
    e.preventDefault();
    if (disabled || creating) return;
    const qty = Number(quantity);
    // Клиентская пред-проверка по серверной схеме (createPrizeRequestSchema):
    // без неё сервер ответит REQUEST_INVALID — тот же отказ, но позже.
    if (!name.trim() || !Number.isInteger(qty) || qty <= 0) {
      setError('Укажите название приза и целое количество больше нуля.');
      return;
    }
    setCreating(true);
    setError(null);
    void createPrize(hostClient, roomId, { name: name.trim(), quantity: qty })
      .then(() => {
        setName('');
        setQuantity('1');
        return listPrizes(hostClient, roomId);
      })
      .then((r) => setPrizes(r.prizes))
      .catch((err: unknown) => setError(panelErrorText(err)))
      .finally(() => setCreating(false));
  };

  const runDraw = (prize: PrizeResponse) => {
    const { attempt, error: startError } = tryStartDrawAttempt(prize, pendingDraw, () =>
      crypto.randomUUID(),
    );
    // Синхронный отказ генератора drawId (вне secure context) — в текст панели;
    // pending не тронут, попытки не было.
    if (startError) {
      setError(startError);
      return;
    }
    if (!attempt) return; // повторный клик до ack — не попытка (идемпотентность)
    setPendingDraw(attempt);
    setError(null);
    void publish('lottery.draw.run', { drawId: attempt.drawId, prizeId: attempt.prizeId })
      .catch((e: unknown) => setError(panelErrorText(e)))
      // Ack ИЛИ ошибка — попытка завершена, кнопка снова доступна; результат
      // приезжает отдельно публичным draw.completed, его здесь не ждём.
      .finally(() => setPendingDraw(null));
  };

  const isLottery = pinnedAppId === LOTTERY_APP_ID;

  return (
    <section>
      <h2>Призы</h2>
      <form onSubmit={submitPrize}>
        <label>
          Название{' '}
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={disabled || creating}
          />
        </label>{' '}
        <label>
          Количество{' '}
          <input
            type="number"
            min={1}
            step={1}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            disabled={disabled || creating}
          />
        </label>{' '}
        <button type="submit" disabled={disabled || creating}>
          Добавить приз
        </button>
      </form>
      {prizes === null ? <p>Загружаем призы…</p> : null}
      {prizes !== null && prizes.length === 0 ? <p>Призов пока нет.</p> : null}
      {prizes !== null && prizes.length > 0 ? (
        <ul>
          {prizes.map((p) => (
            <li key={p.id}>
              {p.name} — осталось {p.quantity} из {p.quantityTotal}{' '}
              {isLottery ? (
                <button
                  type="button"
                  disabled={disabled || !isDrawable(p) || pendingDraw !== null}
                  onClick={() => runDraw(p)}
                >
                  Разыграть
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}
