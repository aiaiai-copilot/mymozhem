import type { LotteryState } from '@mymozhem/app-lottery';
import { displayNameOf } from './roster-names';

interface WinnersProps {
  // Проекция лотереи из лога (draw.completed): drawId → { prizeId, winnerId }.
  draws: LotteryState['draws'];
  names: Map<string, string>;
  // Консольный потребитель передаёт карточный класс (бриф T11); сцены
  // стилизованы своими обёртками (.play-winners/.screen-winners) и проп не
  // передают — регресса сцен нет.
  className?: string;
}

// Список победителей розыгрыша (functional-minimum). Названий призов на клиенте
// нет (listPrizes — контур консоли организатора), поэтому показываем prizeId.
// prizeId null — безпризовой розыгрыш (ADR-012 §4): строка без «приз …».
export function Winners({ draws, names, className }: WinnersProps) {
  const entries = Object.entries(draws);
  if (entries.length === 0) return null;
  return (
    <section className={className}>
      <h2>Победители розыгрыша</h2>
      <ul>
        {entries.map(([drawId, draw]) => (
          <li key={drawId}>
            {draw.prizeId === null
              ? displayNameOf(names, draw.winnerId)
              : `${displayNameOf(names, draw.winnerId)} — приз ${draw.prizeId}`}
          </li>
        ))}
      </ul>
    </section>
  );
}
