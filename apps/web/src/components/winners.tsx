import type { LotteryState } from '@mymozhem/app-lottery';
import { displayNameOf } from './roster-names';

interface WinnersProps {
  // Проекция лотереи из лога (draw.completed): drawId → { prizeId, winnerId }.
  draws: LotteryState['draws'];
  names: Map<string, string>;
}

// Список победителей розыгрыша (functional-minimum). Названий призов на клиенте
// нет (listPrizes — контур консоли организатора), поэтому показываем prizeId.
export function Winners({ draws, names }: WinnersProps) {
  const entries = Object.entries(draws);
  if (entries.length === 0) return null;
  return (
    <section>
      <h2>Победители розыгрыша</h2>
      <ul>
        {entries.map(([drawId, draw]) => (
          <li key={drawId}>
            {displayNameOf(names, draw.winnerId)} — приз {draw.prizeId}
          </li>
        ))}
      </ul>
    </section>
  );
}
