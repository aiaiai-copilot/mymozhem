import { Link } from 'react-router-dom';

// Catch-all (финревью батча 5): опечатанный URL не должен рендерить пустой
// экран — минимальный ответ с путём назад. Link, не <a>: маршрут внутри SPA.
export function NotFoundPage() {
  return (
    <main>
      <h1>Страница не найдена</h1>
      <p>
        <Link to="/">На главную</Link>
      </p>
    </main>
  );
}
