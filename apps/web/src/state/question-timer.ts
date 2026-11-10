import { useEffect, useState } from 'react';

// Таймер вопроса (quiz v3): durationSec (5–600|null, дефолт 30) — из настроек
// вопроса, openedAt — серверный ISO из payload question.opened. Опорное время —
// серверное: elapsed считается от openedAt, а не от момента получения события,
// поэтому задержка доставки/переподключение не сдвигают отсчёт.

// null duration («без лимита») или null openedAt (вопрос не открыт) → null.
// Иначе clamp(durationSec - floor(elapsed/1000), 0, durationSec): floor ПОСЛЕ
// деления (целые секунды); нижний clamp — таймер стоит на нуле, верхний — часы
// клиента впереди сервера (openedAt «в будущем») не дают уйти выше durationSec.
export function remainingSec(
  durationSec: number | null,
  openedAt: string | null,
  nowMs: number,
): number | null {
  if (durationSec === null || openedAt === null) return null;
  const elapsedSec = Math.floor((nowMs - Date.parse(openedAt)) / 1000);
  return Math.min(Math.max(durationSec - elapsedSec, 0), durationSec);
}

// m:ss: 65 → "1:05", 5 → "0:05".
export function formatTimer(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Тик раз в секунду от Date.now(); cleanup на размонтировании/смене аргументов.
// Без DOM-теста (паттерн репо): чистые функции покрыты спекой, хук — typecheck.
export function useQuestionTimer(
  durationSec: number | null,
  openedAt: string | null,
): number | null {
  const [sec, setSec] = useState<number | null>(() =>
    remainingSec(durationSec, openedAt, Date.now()),
  );

  useEffect(() => {
    setSec(remainingSec(durationSec, openedAt, Date.now()));
    if (durationSec === null || openedAt === null) return;
    const id = setInterval(() => {
      setSec(remainingSec(durationSec, openedAt, Date.now()));
    }, 1000);
    return () => clearInterval(id);
  }, [durationSec, openedAt]);

  return sec;
}
