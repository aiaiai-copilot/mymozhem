import { topNWithRest, trackWidths } from '../state/race-tracks';

// Дорожки «забега» — ростер с нормированными к лидеру полосами (дизайн §7).
// Разметка — перенос из мокапа component-states-live (.track-row/.tr-top/
// .tr-lane/.fill/.gain, tabular-nums у счёта, transition width var(--t-race)
// в styles/transitions.css). Пометка своей строки («это ты») и «ещё N» —
// из мокапов tracks-scene/console-reveal-tracks. DOM-тестов нет (паттерн
// репо): чистая логика покрыта state/race-tracks.spec.ts, разметка — T13.

export interface RaceTrackEntry {
  actorId: string;
  // Уже разрешённое отображаемое имя (rosterNames/displayNameOf — у потребителя).
  name: string;
  total: number;
  // Прирост последнего раунда (lastRoundGains из лога у потребителя).
  gain: number;
}

interface RaceTracksProps {
  entries: readonly RaceTrackEntry[];
  // Своя строка: пометка «это ты» (золотая, по мокапу tracks-scene).
  highlightId?: string;
  // Показать верхние topN; под дорожками — «ещё N». Без topN — все.
  topN?: number;
  // Полотно дорожки: сцена — --track-canvas-dark, консоль — --track-canvas-light.
  contour: 'scene' | 'console';
}

export function RaceTracks({ entries, highlightId, topN, contour }: RaceTracksProps) {
  // Сортировка desc — обязанность отображения (как в Standings); равные очки
  // сохраняют порядок входа (sort стабилен). Нормировка — к лидеру ПОЛНОГО
  // списка, а не видимого топа: обрезанные дорожки не меняют масштаб.
  const sorted = [...entries].sort((a, b) => b.total - a.total);
  const widths = trackWidths(
    sorted,
    Object.fromEntries(sorted.map((e) => [e.actorId, e.gain])),
  );
  const { top, rest } = topNWithRest(sorted, topN ?? sorted.length);

  return (
    <div className={`race-tracks contour-${contour}`}>
      {top.map((e) => {
        const w = widths.get(e.actorId) ?? { fillPct: 0, gainPct: 0 };
        return (
          <div className="track-row" key={e.actorId}>
            <div className="tr-top">
              <span className="tr-name">
                {e.name}
                {e.actorId === highlightId && <span className="me">это ты</span>}
              </span>
              <span className="tr-score">
                {e.total}
                {/* Дельта дублируется числом рядом со счётом (дизайн §7:
                    без цвета всё читается). Только при gain > 0. */}
                {e.gain > 0 && <span className="delta">+{e.gain}</span>}
              </span>
            </div>
            <div className="tr-lane">
              {/* Без прироста fill получает solo — закруглённый правый конец
                  (мокап console-reveal-tracks). */}
              <div
                className={w.gainPct > 0 ? 'fill' : 'fill solo'}
                style={{ width: `${w.fillPct}%` }}
              />
              <div className="gain" style={{ width: `${w.gainPct}%` }} />
            </div>
          </div>
        );
      })}
      {rest > 0 && <div className="tr-more">ещё {rest}</div>}
    </div>
  );
}
