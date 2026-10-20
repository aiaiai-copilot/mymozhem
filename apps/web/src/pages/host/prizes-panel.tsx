import { useEffect, useState, type FormEvent } from 'react';
import type { PrizeResponse, ProjectedEvent } from '@mymozhem/sdk';
import { drawCompletedPayload, LOTTERY_APP_ID } from '@mymozhem/app-lottery';
import { ApiError } from '../../api/api-error';
import { createPrize, listPrizes } from '../../api/endpoints';
import { displayNameOf } from '../../components/roster-names';
import { hostClient } from './host-session';

// Попытка розыгрыша: drawId — клиентский uuid, ключ идемпотентности команды
// lottery.draw.run (манифест app-lottery; дизайн ф.3 §4). prizeId null —
// безпризовой розыгрыш «Разыграть участника» (ADR-012 §4 / REQ-RWD-002b).
export interface DrawAttempt {
  drawId: string;
  prizeId: string | null;
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

// Безпризовая попытка («Разыграть участника»): приза нет — проверять остаток
// фонда нечего, гард только pending (та же дисциплина идемпотентности).
export const startParticipantDrawAttempt = (
  pending: DrawAttempt | null,
  makeDrawId: () => string,
): DrawAttempt | null => {
  if (pending !== null) return null;
  return { drawId: makeDrawId(), prizeId: null };
};

// Тот же перехват синхронного броска crypto.randomUUID(), что tryStartDrawAttempt.
export const tryStartParticipantDrawAttempt = (
  pending: DrawAttempt | null,
  makeDrawId: () => string,
): { attempt: DrawAttempt | null; error: string | null } => {
  try {
    return { attempt: startParticipantDrawAttempt(pending, makeDrawId), error: null };
  } catch {
    return { attempt: null, error: DRAW_ID_GENERATION_FAILED };
  }
};

// UX-маппинг ошибок REST/publish панели — тот же стиль, что commandErrorText
// на console-page: человеческий глагол + честный код (REQ-SEC-006).
const panelErrorText = (e: unknown): string => {
  if (e instanceof ApiError) {
    // Серверный гейт prize_mode=off (ADR-012 §4): клиент режим не знает —
    // отказ createPrize/draw.run с призом приезжает этим кодом.
    if (e.code === 'PRIZES_DISABLED') return 'Призовой режим выключен на этом сервере.';
    return `Действие не выполнено (${e.code}).`;
  }
  return 'Ошибка сети. Действие не выполнено.';
};

// Публичные события, после которых остатки фонда могли измениться: awarded —
// серверный декремент при розыгрыше, revoked — возврат quantity при отзыве
// (rewards.service). Оба public (REWARDS_EVENTS) — visibility-дисциплина.
const PRIZE_REFETCH_EVENTS = new Set(['rewards.reward.awarded', 'rewards.reward.revoked']);

// Баннер победителя (бриф T11, дизайн §5.3 «Розыгрыш»): последний
// lottery.draw.completed из лога. Payload парсим схемой app-lottery на
// границе (прецедент lastRoundGains в state/race-tracks.ts), не raw JSON.
// Розыгрышей не было → null, баннер не рисуется.
export interface CompletedDraw {
  drawId: string;
  prizeId: string | null;
  winnerId: string;
}
export const lastCompletedDraw = (events: ProjectedEvent[]): CompletedDraw | null => {
  let last: CompletedDraw | null = null;
  for (const e of events) {
    if (e.type === 'lottery.draw.completed') last = drawCompletedPayload.parse(e.payload);
  }
  return last;
};

// Название приза для баннера победителя (T13, извлечение из рендера): find по
// локальному списку панели. Приз мог быть удалён из выдачи или список ещё не
// загружен → null (строка без названия, fallback брифа T11); безпризовой draw
// (prizeId null) и отсутствие розыгрышей → тоже null.
export const drawPrizeName = (
  draw: CompletedDraw | null,
  prizes: PrizeResponse[] | null,
): string | null =>
  draw?.prizeId != null ? (prizes?.find((p) => p.id === draw.prizeId)?.name ?? null) : null;

interface PrizesPanelProps {
  roomId: string;
  // Пин приложения из payload core.room.activated (REQ-RT-004): кнопка
  // «Разыграть» рисуется только в lottery-комнате.
  pinnedAppId: string | null;
  // Терминальный статус комнаты: сервер не примет ни createPrize
  // (ROOM_NOT_ACTIVE), ни draw.run в не-ACTIVE комнате — отсекаем заранее.
  disabled: boolean;
  // Лог — триггер событийного рефетча остатков (см. PRIZE_REFETCH_EVENTS) и
  // источник баннера победителя (lastCompletedDraw).
  events: ProjectedEvent[];
  // Имена — из общего useRoomFeed: draw.completed несёт только winnerId
  // (REQ-SEC-009), имя победителя берём из membership-проекции.
  names: Map<string, string>;
  publish: (type: string, payload: Record<string, unknown>) => Promise<void>;
}

// Панель призов и розыгрыша (бриф Task 15, стилизация — бриф T11, дизайн
// §5.3 «Розыгрыш», мокап console-draw-winner-larger): карточка консоли;
// баннер последнего победителя внутри карточки (имя 36px Oranienbaum —
// крупнейший элемент экрана); форма name+quantity → createPrize → рефетч;
// в lottery-комнате у приза с quantity>0 — «Разыграть» → publish
// lottery.draw.run; результат приезжает draw.completed и виден в баннере
// и <Winners>. draw.completed сам модуль коммитит — клиент его не публикует
// никогда. ADR-012 §4: кнопка «Разыграть участника» — безпризовой draw
// (без prizeId).
export function PrizesPanel({ roomId, pinnedAppId, disabled, events, names, publish }: PrizesPanelProps) {
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
    // prizeId типизирован nullable (общий DrawAttempt), но призовая попытка его
    // всегда несёт; null на wire недопустим (drawRunPayload: uuid optional) —
    // шлём ключ только при наличии.
    void publish(
      'lottery.draw.run',
      attempt.prizeId === null
        ? { drawId: attempt.drawId }
        : { drawId: attempt.drawId, prizeId: attempt.prizeId },
    )
      .catch((e: unknown) => setError(panelErrorText(e)))
      // Ack ИЛИ ошибка — попытка завершена, кнопка снова доступна; результат
      // приезжает отдельно публичным draw.completed, его здесь не ждём.
      .finally(() => setPendingDraw(null));
  };

  // Безпризовой розыгрыш (ADR-012 §4): publish БЕЗ prizeId — тот же
  // tryStartDrawAttempt-паттерн (pending-гард, crypto.randomUUID).
  const runParticipantDraw = () => {
    const { attempt, error: startError } = tryStartParticipantDrawAttempt(pendingDraw, () =>
      crypto.randomUUID(),
    );
    if (startError) {
      setError(startError);
      return;
    }
    if (!attempt) return;
    setPendingDraw(attempt);
    setError(null);
    void publish('lottery.draw.run', { drawId: attempt.drawId })
      .catch((e: unknown) => setError(panelErrorText(e)))
      .finally(() => setPendingDraw(null));
  };

  const isLottery = pinnedAppId === LOTTERY_APP_ID;

  // Баннер последнего победителя (мокап console-draw-winner-larger): внутри
  // карточки призов, над списком. Название приза — из локального списка панели
  // по prizeId; приз мог быть удалён из выдачи — тогда строка без названия
  // (fallback брифа T11), безпризовой draw — тоже без названия.
  const lastDraw = lastCompletedDraw(events);
  const lastDrawPrizeName = drawPrizeName(lastDraw, prizes);

  return (
    <section className="console-card">
      <h3 className="console-card-title">Призы</h3>
      {lastDraw ? (
        <div className="console-winner-banner">
          <div className="console-wb-label">Розыгрыш завершён</div>
          <div className="console-wb-name">{displayNameOf(names, lastDraw.winnerId)}</div>
          {lastDrawPrizeName !== null ? (
            <div className="console-wb-prize">выигрывает «{lastDrawPrizeName}»</div>
          ) : null}
        </div>
      ) : null}
      {prizes === null ? <p className="console-empty-note">Загружаем призы…</p> : null}
      {prizes !== null && prizes.length === 0 ? (
        <p className="console-empty-note">Призов пока нет.</p>
      ) : null}
      {prizes !== null && prizes.length > 0 ? (
        <ul className="console-prize-list">
          {prizes.map((p) => (
            <li className="console-prize-row" key={p.id}>
              <span className="console-prize-name">
                {p.name}
                <span className="console-prize-left">
                  {' '}
                  — осталось {p.quantity} из {p.quantityTotal}
                </span>
              </span>
              {isLottery ? (
                isDrawable(p) ? (
                  <button
                    type="button"
                    className="btn btn-secondary console-mini"
                    disabled={disabled || pendingDraw !== null}
                    onClick={() => runDraw(p)}
                  >
                    Разыграть
                  </button>
                ) : (
                  /* Разыгранный приз (quantity 0): вместо disabled-кнопки —
                     тихий статус (мокап «Разыграна»; при фонде >1 — мн. ч.). */
                  <span className="console-prize-drawn">
                    {p.quantityTotal > 1 ? 'Разыграны' : 'Разыграна'}
                  </span>
                )
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {/* Поля формы переиспользуют editor-стили карточки вопроса (та же
          консольная палитра: белое поле, заголовок-лейбл). */}
      <form className="console-prize-form" onSubmit={submitPrize}>
        <label className="editor-label">
          Название
          <input
            className="editor-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={disabled || creating}
          />
        </label>
        <label className="editor-label">
          Количество
          <input
            className="editor-input console-prize-qty"
            type="number"
            min={1}
            step={1}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            disabled={disabled || creating}
          />
        </label>
        <button
          type="submit"
          className="btn btn-secondary console-prize-add"
          disabled={disabled || creating}
        >
          + Добавить приз
        </button>
      </form>
      {/* ADR-012 §4: создание приза — юридическая ответственность организатора
          (лотереи, налоги). Текст виден всегда: клиент режим не знает, серверный
          гейт отвечает PRIZES_DISABLED при prize_mode=off. */}
      <p className="console-empty-note">
        Призовой режим — юридическая ответственность организатора (лотереи, налоги).
      </p>
      {isLottery ? (
        <button
          type="button"
          className="btn btn-secondary console-draw-participant"
          disabled={disabled || pendingDraw !== null}
          onClick={runParticipantDraw}
        >
          Разыграть участника
        </button>
      ) : null}
      {/* Ошибки панели — единый стиль с баннером обрыва связи (бриф T11,
          мокап console-empty-long-errors-v2). */}
      {error ? (
        <p role="alert" className="console-error-banner console-panel-alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
