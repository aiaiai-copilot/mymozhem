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

// Панель вручения (бриф Task 15, стилизация — бриф T11, дизайн §5.3, мокапы
// console-draw-winner-larger / console-landscape-editor-draw-finish): карточка
// консоли; строки «имя · статус» с действиями справа — «Вручить» primary,
// «Отозвать» тихая без рамки (п. 15); терминальные статусы — тихим текстом.
// Кнопки живы только в статусе AWARDED — FULFILLED/REVOKED терминальны
// (REQ-RWD-007, сервер ответил бы REWARD_ALREADY_RESOLVED). Статус комнаты
// здесь сознательно НЕ гейтится: fulfill/revoke легальны при COMPLETED
// (REQ-RWD-009) — призы вручают после завершения события.
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

  // Заголовок со счётчиком вручения — по мокапу завершения
  // («Награды — вручить 2 из 3»); счётчик только когда вручать есть что.
  const pending = awards?.filter((a) => a.status === 'AWARDED').length ?? 0;
  const title =
    awards !== null && awards.length > 0 && pending > 0
      ? `Награды — вручить ${pending} из ${awards.length}`
      : 'Награды';

  return (
    <section className="console-card">
      <h3 className="console-card-title">{title}</h3>
      {awards === null ? <p className="console-empty-note">Загружаем награды…</p> : null}
      {awards !== null && awards.length === 0 ? (
        <p className="console-empty-note">Наград пока нет.</p>
      ) : null}
      {awards !== null && awards.length > 0 ? (
        <ul className="console-award-list">
          {awards.map((a) => (
            <li className="console-award-row" key={a.id}>
              <span className="console-award-name">
                {displayNameOf(names, a.winnerId)}
                {/* Названий призов на этом контуре нет (listPrizes — панель
                    призов), показываем честный prizeId. */}
                {a.prizeId !== null ? ` — приз ${a.prizeId}` : ''}
                {a.status !== 'AWARDED' ? (
                  <span className="console-award-status"> · {statusLabel(a.status)}</span>
                ) : null}
              </span>
              {a.status === 'AWARDED' ? (
                <span className="console-award-actions">
                  <button
                    type="button"
                    className="btn btn-primary console-mini"
                    disabled={busyId !== null}
                    onClick={() => resolve(a.id, 'fulfill')}
                  >
                    Вручить
                  </button>
                  <button
                    type="button"
                    className="btn btn-quiet console-mini"
                    disabled={busyId !== null}
                    onClick={() => resolve(a.id, 'revoke')}
                  >
                    Отозвать
                  </button>
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {/* Ошибки панели — единый стиль с баннером обрыва связи (бриф T11). */}
      {error ? (
        <p role="alert" className="console-error-banner console-panel-alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
