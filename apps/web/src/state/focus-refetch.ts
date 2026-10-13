// Дедуп рефетча по фокусу окна (находка №6): visibilitychange→visible и focus
// приходят парой; не чаще одного вызова в minIntervalMs. Чистая фабрика —
// тест без DOM; visibility-фильтр остаётся в вызывающем (use-room-feed).
export function createFocusRefetcher(
  refetch: () => void,
  minIntervalMs = 2_000,
  now: () => number = Date.now,
): () => void {
  let last = -Infinity;
  return () => {
    const t = now();
    if (t - last < minIntervalMs) return;
    last = t;
    refetch();
  };
}
