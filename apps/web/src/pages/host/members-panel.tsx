import { useState } from 'react';
import type { RosterEntry } from '@mymozhem/sdk';
import { ApiError } from '../../api/api-error';
import { excludeMember, listMembers } from '../../api/endpoints';
import { displayNameOf } from '../../components/roster-names';
import { hostClient } from './host-session';

// UX-маппинг ошибок exclude — тот же стиль, что commandErrorText на
// console-page: человеческий глагол + честный код (REQ-SEC-006).
const excludeErrorText = (e: unknown): string => {
  if (e instanceof ApiError) return `Не удалось исключить (${e.code}).`;
  return 'Ошибка сети. Участник не исключён.';
};

// Wire-роль → подпись в ростере консоли (functional-minimum).
const roleLabel = (role: RosterEntry['role']): string =>
  role === 'participant' ? 'игрок' : 'зритель';

interface MembersPanelProps {
  roomId: string;
  // Ростер и имена — из общего useRoomFeed консоли: второй fetch здесь не
  // нужен, рефетч после exclude делает onChanged (см. ниже).
  members: RosterEntry[];
  names: Map<string, string>;
  // Терминальный статус: исключать в завершённой/отменённой комнате незачем.
  disabled: boolean;
  // Exclude не эмитит публичных событий (CORE_EVENTS — только lifecycle), поэтому
  // событийный рефетч useRoomFeed его не увидит — ростер рефетчим вручную (бриф).
  onChanged: () => void;
}

// Оркестрация exclude с рефетчем-в-момент-действия (находка №6) — вынесена из
// компонента для теста без DOM (прецедент: чистые экспорты quiz-controls).
// 'stale' — identity уже не в активном ростере (перезаход): exclude не шлём,
// вызывающий обновляет ростер и просит выбрать заново.
export async function excludeIfStillActive(
  deps: {
    listMembers: (roomId: string) => Promise<{ members: RosterEntry[] }>;
    excludeMember: (roomId: string, identityId: string) => Promise<unknown>;
  },
  roomId: string,
  identityId: string,
): Promise<'excluded' | 'stale'> {
  const fresh = await deps.listMembers(roomId);
  if (!fresh.members.some((m) => m.identityId === identityId)) return 'stale';
  await deps.excludeMember(roomId, identityId);
  return 'excluded';
}

// Панель участников (бриф Task 15): ростер participant/spectator + «Исключить».
// Organizer/moderator в список не попадают: ORGANIZER сервер исключить не даст
// (TargetNotExcludable), а moderator в MVP-флоу не создаётся.
export function MembersPanel({ roomId, members, names, disabled, onChanged }: MembersPanelProps) {
  const [excludingId, setExcludingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Reason с формы не собираем (functional-minimum): без тела сервер парсит {}
  // (endpoints.excludeMember), повторное исключение — типизированный no-op.
  const exclude = (identityId: string) => {
    if (disabled || excludingId !== null) return; // одна команда за раз
    setExcludingId(identityId);
    setError(null);
    void excludeIfStillActive(
      {
        listMembers: (r) => listMembers(hostClient, r),
        excludeMember: (r, id) => excludeMember(hostClient, r, id),
      },
      roomId,
      identityId,
    )
      .then((result) => {
        // Стейл-ростер (№6): участник перезашёл между загрузкой и кликом —
        // показываем свежий список и просим выбрать заново, exclude не ушёл.
        if (result === 'stale') setError('Участник перезашёл — список обновлён, выберите заново.');
        onChanged();
      })
      .catch((e: unknown) => setError(excludeErrorText(e)))
      .finally(() => setExcludingId(null));
  };

  const excludable = members.filter((m) => m.role === 'participant' || m.role === 'spectator');

  return (
    <section>
      <h2>Участники ({excludable.length})</h2>
      {excludable.length === 0 ? <p>Пока никого нет.</p> : null}
      {excludable.length > 0 ? (
        <ul>
          {excludable.map((m) => (
            <li key={m.identityId}>
              {/* displayName может быть null после TTL-свipa — displayNameOf
                  отдаёт fallback «Гость», дыр в ростере нет. */}
              {displayNameOf(names, m.identityId)} ({roleLabel(m.role)}){' '}
              <button
                type="button"
                disabled={disabled || excludingId !== null}
                onClick={() => exclude(m.identityId)}
              >
                Исключить
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}
