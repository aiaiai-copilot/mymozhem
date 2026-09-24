import { useEffect, useState } from 'react';
import type { AwardResponse, ProjectedEvent } from '@mymozhem/sdk';
import { ApiError } from '../../api/api-error';
import { fulfillAward, listRewards, revokeAward } from '../../api/endpoints';
import { displayNameOf } from '../../components/roster-names';
import { hostClient } from './host-session';

// UX-маппинг ошибок fulfill/revoke — тот же стиль, что commandErrorText на
// console-page: человеческий глагол + честный код (REQ-SEC-006).
const awardErrorText = (e: unknown): string => {
  if (e instanceof ApiError) return `Действие не выполнено (${e.code}).`;
  return 'Ошибка сети. Действие не выполнено.';
};

// Подпись wire-статуса награды (AWARD_STATUSES в SDK — uppercase).
const statusLabel = (status: AwardResponse['status']): string => {
  switch (status) {
    case 'FULFILLED':
      return 'Вручено';
    case 'REVOKED':
      return 'Отозвано';
    default:
      return 'Ожидает вручения';
  }
};

interface AwardsPanelProps {
  roomId: string;
  // Имена — из общего useRoomFeed: awards несут только identityId
  // (REQ-SEC-009), имя берём из membership-проекции.
  names: Map<string, string>;
  // Лог — триггер рефетча: новая награда появляется публичным
  // rewards.reward.awarded после розыгрыша (REWARDS_EVENTS, public).
  events: ProjectedEvent[];
}

// Панель вручения (бриф Task 15): список наград + fulfill/revoke. Кнопки живы
// только в статусе AWARDED — FULFILLED/REVOKED терминальны (REQ-RWD-007,
// сервер ответил бы REWARD_ALREADY_RESOLVED). Статус комнаты здесь сознательно
// НЕ гейтится: fulfill/revoke легальны при COMPLETED (REQ-RWD-009) — призы
// вручают после завершения события.
export function AwardsPanel({ roomId, names, events }: AwardsPanelProps) {
  const [awards, setAwards] = useState<AwardResponse[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stale = false;
    listRewards(hostClient, roomId)
      .then((r) => {
        if (!stale) setAwards(r.awards);
      })
      .catch((e: unknown) => {
        if (!stale) setError(awardErrorText(e));
      });
    return () => {
      stale = true;
    };
  }, [roomId]);

  // Событийный рефетч: draw в prizes-panel коммитит reward.awarded на сервере —
  // награда должна появиться в списке без ручного обновления страницы.
  useEffect(() => {
    const last = events[events.length - 1];
    if (!last || last.type !== 'rewards.reward.awarded') return;
    listRewards(hostClient, roomId)
      .then((r) => setAwards(r.awards))
      // Best effort: список самоисправится на следующем событии или действии.
      .catch(() => {});
  }, [events, roomId]);

  // fulfill/revoke — идемпотентны на сервере (no-op при повторе), но параллельные
  // клики по разным наградам не упорядочиваем — одна команда за раз, как везде.
  const resolve = (awardId: string, action: 'fulfill' | 'revoke') => {
    if (busyId !== null) return;
    setBusyId(awardId);
    setError(null);
    const call = action === 'fulfill' ? fulfillAward : revokeAward;
    void call(hostClient, roomId, awardId)
      .then(() => listRewards(hostClient, roomId))
      .then((r) => setAwards(r.awards))
      .catch((e: unknown) => setError(awardErrorText(e)))
      .finally(() => setBusyId(null));
  };

  return (
    <section>
      <h2>Вручение наград</h2>
      {awards === null ? <p>Загружаем награды…</p> : null}
      {awards !== null && awards.length === 0 ? <p>Наград пока нет.</p> : null}
      {awards !== null && awards.length > 0 ? (
        <ul>
          {awards.map((a) => (
            <li key={a.id}>
              {displayNameOf(names, a.winnerId)}
              {a.prizeId !== null ? ` — приз ${a.prizeId}` : ''} — {statusLabel(a.status)}{' '}
              {a.status === 'AWARDED' ? (
                <>
                  <button
                    type="button"
                    disabled={busyId !== null}
                    onClick={() => resolve(a.id, 'fulfill')}
                  >
                    Вручить
                  </button>{' '}
                  <button
                    type="button"
                    disabled={busyId !== null}
                    onClick={() => resolve(a.id, 'revoke')}
                  >
                    Отозвать
                  </button>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}
