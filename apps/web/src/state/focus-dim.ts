// Трекер затемнения нефокусного окна (находка Н1, дизайн §3(А), решение 1):
// dimmed ⟺ blurred && visible. «visible» отделяет десктопный сценарий «окно
// видно, фокус в другом приложении» от мобильного app-switch, где страница
// hidden и затемнять нечего (Review Focus 4). Чистый: DOM не читает — события
// и visibility скармливает хук use-focus-dim; начальное состояние — видимая
// сфокусированная страница.
export interface FocusDimTracker {
  dimmed(): boolean;
  onBlur(): void;
  onFocus(): void;
  onVisibility(visible: boolean): void;
}

export function createFocusDimTracker(): FocusDimTracker {
  let blurred = false;
  let visible = true;
  return {
    dimmed: () => blurred && visible,
    onBlur: () => {
      blurred = true;
    },
    onFocus: () => {
      blurred = false;
    },
    onVisibility: (v: boolean) => {
      visible = v;
    },
  };
}
