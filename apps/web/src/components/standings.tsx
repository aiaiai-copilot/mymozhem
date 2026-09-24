import type { z } from 'zod';
import type { gameFinishedPayload } from '@mymozhem/app-quiz';
import { displayNameOf } from './roster-names';

// Итоговое табло финала (game.finished) уже несёт места — доверяем им, а не
// пересортировываем: правила раздела мест — забота app-модуля.
type FinalStandings = z.infer<typeof gameFinishedPayload>['standings'];

interface StandingsProps {
  names: Map<string, string>;
  // Промежуточное табло: очки из проекции QuizState (reveal), сортировка desc здесь.
  totals?: Readonly<Record<string, number>>;
  // Финальное табло: standings из payload game.finished (места посчитаны сервером).
  standings?: FinalStandings;
}

// Табло имя+очки (functional-minimum, дизайн §0.4). Плотный ранг не нужен —
// это отображение, а не подсчёт; при равных очках порядок произволен.
export function Standings({ names, totals, standings }: StandingsProps) {
  const rows: readonly { actorId: string; total: number }[] =
    standings ??
    Object.entries(totals ?? {})
      .map(([actorId, total]) => ({ actorId, total }))
      .sort((a, b) => b.total - a.total);

  if (rows.length === 0) {
    return <p>Очков пока нет.</p>;
  }
  return (
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>Игрок</th>
          <th>Очки</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={row.actorId}>
            <td>{i + 1}</td>
            <td>{displayNameOf(names, row.actorId)}</td>
            <td>{row.total}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
