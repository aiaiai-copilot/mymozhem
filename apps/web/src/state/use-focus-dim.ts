import { useEffect, useState } from 'react';
import { createFocusDimTracker } from './focus-dim';

// React-клей трекера затемнения (дизайн §3(А)): blur/focus на window,
// visibilitychange на document, cleanup снимает всех слушателей. Текущая
// visibility подаётся в трекер и на blur тоже: macOS может отдать blur до
// перехода вкладки в hidden — порядок событий браузером не гарантирован,
// поэтому каждое событие несёт свежий снимок document.visibilityState.
export function useFocusDim(): boolean {
  const [dimmed, setDimmed] = useState(false);
  useEffect(() => {
    const tracker = createFocusDimTracker();
    const sync = () => setDimmed(tracker.dimmed());
    const onBlur = () => {
      tracker.onVisibility(document.visibilityState === 'visible');
      tracker.onBlur();
      sync();
    };
    const onFocus = () => {
      tracker.onFocus();
      sync();
    };
    const onVisibility = () => {
      tracker.onVisibility(document.visibilityState === 'visible');
      sync();
    };
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);
  return dimmed;
}
