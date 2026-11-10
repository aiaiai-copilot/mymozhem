import type { ProjectedEvent } from '@mymozhem/sdk';
import { questionRevealedPayload } from '@mymozhem/app-quiz';

// Логика дорожек «забега» (дизайн §7): чистые функции, без React.
// Дорожка игрока = fill (итог без прироста) + gain (прирост последнего
// раунда), оба нормированы к лидеру (=100%). Прирост выводится из лога,
// а не приезжает отдельным состоянием — перефолд/reconnect дают тот же
// результат (reconnect-safe).

export interface TrackTotal {
  actorId: string;
  total: number;
}

export interface TrackWidth {
  fillPct: number;
  gainPct: number;
}

// Прирост за раунд — awarded ПОСЛЕДНЕГО quiz.question.revealed в логе.
// Reveal не было → пустая запись (все дорожки без gain-сегмента).
export function lastRoundGains(events: ProjectedEvent[]): Record<string, number> {
  let last: Record<string, number> = {};
  for (const e of events) {
    if (e.type !== 'quiz.question.revealed') continue;
    const p = questionRevealedPayload.parse(e.payload);
    last = Object.fromEntries(p.awarded.map((a) => [a.actorId, a.points]));
  }
  return last;
}

// Нормировка к лидеру: fill = (total−gain)/leader, gain = gain/leader (0..100).
// Лидер 0 (все нули, старт игры) → все 0: пустые дорожки, без деления на ноль.
// gain > total быть не должно (прирост входит в итог), но fill не уходит
// в минус — clamp на 0.
export function trackWidths(
  entries: readonly TrackTotal[],
  gains: Readonly<Record<string, number>>,
): Map<string, TrackWidth> {
  const leader = Math.max(0, ...entries.map((e) => e.total));
  const widths = new Map<string, TrackWidth>();
  for (const e of entries) {
    if (leader === 0) {
      widths.set(e.actorId, { fillPct: 0, gainPct: 0 });
      continue;
    }
    const gain = gains[e.actorId] ?? 0;
    widths.set(e.actorId, {
      fillPct: (Math.max(e.total - gain, 0) / leader) * 100,
      gainPct: (gain / leader) * 100,
    });
  }
  return widths;
}

// Верхние n + счётчик остальных («ещё N»). rest никогда не отрицателен.
export function topNWithRest<T>(list: readonly T[], n: number): { top: T[]; rest: number } {
  return { top: list.slice(0, n), rest: Math.max(list.length - n, 0) };
}

// Место в уже отсортированном (desc) списке: плотный порядок — равные очки
// делят место, следующее отличающееся значение получает place+1 (1,2,2,3).
// Актора нет в списке → null (исключён/не играл — табло его не рисует).
export function myPlace(sortedEntries: readonly TrackTotal[], myId: string): number | null {
  let place = 1;
  for (let i = 0; i < sortedEntries.length; i++) {
    const entry = sortedEntries[i];
    if (i > 0 && entry.total < sortedEntries[i - 1].total) place++;
    if (entry.actorId === myId) return place;
  }
  return null;
}
