// Логотип «МЫ МОЖЕМЪ» (дизайн п. 3/17; написание — Приложение A, verbatim).
// Шрифт — var(--font-logo): до подтверждения лицензии Blagovest это Oranienbaum
// (гейт п. 4), замена — одна строка в tokens.css. Компонент несёт только
// начертание/цвет/кегль; позиционирование (центр вверху у участника, левый
// верхний угол у проектора) — обязанность страницы-родителя (ruling C-1).

interface LogoProps {
  // Сцена — золото на тёмном; консоль — primary на светлом (потребитель T9).
  contour: 'scene' | 'console';
  // participant — 19px, projector — 22px (п. 17; потребитель projector — T8).
  size: 'participant' | 'projector';
}

export function Logo({ contour, size }: LogoProps) {
  return <div className={`logo logo-${contour} logo-${size}`}>МЫ МОЖЕМЪ</div>;
}
