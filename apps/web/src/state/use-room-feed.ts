import { useEffect, useMemo, useState } from 'react';
import type { ProjectedEvent, RoomStatus, RosterEntry } from '@mymozhem/sdk';
import type { LotteryState } from '@mymozhem/app-lottery';
import type { QuizState } from '@mymozhem/app-quiz';
import type { ApiClient } from '../api/api-client';
import { listMembers } from '../api/endpoints';
import { rosterNames } from '../components/roster-names';
import { deriveRoomStatus, projectLottery, projectQuiz } from './projections';
import { shouldRefetchRoster } from './roster-refetch';

// Общий клей «лог → ростер + проекции» (ruling Task 14): до этого блок копировался
// в play-page и screen-page; консоль — третий потребитель, поэтому клей поднят
// в хук. Миграция play/screen на него — отдельный follow-up, здесь не делается.
// Все хуки безусловны (гейта eslint-plugin-react-hooks нет): roomId === null —
// это «нет привязки», effects просто не стартуют, как в useRoomBinding.
export function useRoomFeed(
  roomId: string | null,
  client: ApiClient,
  events: ProjectedEvent[],
): {
  members: RosterEntry[];
  names: Map<string, string>;
  quiz: QuizState;
  lottery: LotteryState;
  status: RoomStatus;
} {
  const [members, setMembers] = useState<RosterEntry[]>([]);

  // Ростер: join не эмитит событий — первая загрузка на subscribe (Review Focus 2).
  useEffect(() => {
    if (!roomId) return;
    let stale = false;
    listMembers(client, roomId)
      .then((r) => {
        if (!stale) setMembers(r.members);
      })
      // Best effort: имена дорисуются при следующем событийном рефетче,
      // состояние соединения и так показывает баннер.
      .catch(() => {});
    return () => {
      stale = true;
    };
  }, [roomId, client]);

  // …и событийный рефетч там, где имена появляются на экране (табло/победители).
  useEffect(() => {
    const last = events[events.length - 1];
    if (!roomId || !last || !shouldRefetchRoster(last.type)) return;
    listMembers(client, roomId)
      .then((r) => setMembers(r.members))
      .catch(() => {});
  }, [events, roomId, client]);

  const names = useMemo(() => rosterNames(members), [members]);

  // recordedAt — момент приёма: wire его не несёт (I-1); влияет только на
  // отображение, баллы едут в payload question.revealed.
  const quiz = useMemo(() => projectQuiz(events, new Date().toISOString()), [events]);
  const lottery = useMemo(() => projectLottery(events, new Date().toISOString()), [events]);
  const status = useMemo(() => deriveRoomStatus(events), [events]);

  return { members, names, quiz, lottery, status };
}
