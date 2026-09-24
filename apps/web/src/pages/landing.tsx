import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';

// Лендинг (дизайн Task 13): два входа. Организатор — полная перезагрузка страницы
// на /auth/google (backend владеет /auth, router Link здесь не подходит);
// участник — по коду комнаты в /play.
export function LandingPage() {
  const navigate = useNavigate();
  const [code, setCode] = useState('');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = code.trim();
    if (trimmed) navigate(`/play/${trimmed}`);
  };

  return (
    <main>
      <h1>MyMozhem</h1>
      <p>Квизы и розыгрыши для живых событий.</p>
      <section>
        <h2>Я организатор</h2>
        <p>
          <a href={'/auth/google?redirect=' + encodeURIComponent('/host')}>
            Войти через Google
          </a>
        </p>
      </section>
      <section>
        <h2>У меня есть код</h2>
        <form onSubmit={submit}>
          <label>
            Код комнаты
            <input value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" />
          </label>
          <button type="submit" disabled={!code.trim()}>
            Играть
          </button>
        </form>
      </section>
    </main>
  );
}
