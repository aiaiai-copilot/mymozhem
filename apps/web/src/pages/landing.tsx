import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';

// Лендинг (дизайн Task 13): два входа. Организатор — страница ввода setup-токена
// инстанса (ADR-012 §2; router-Link уместен: полная перезагрузка нужна была
// только OAuth-флоу); участник — по коду комнаты в /play.
export function LandingPage() {
  const navigate = useNavigate();
  const [code, setCode] = useState('');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = code.trim();
    // encodeURIComponent: код попадает в path-параметр, посторонние символы
    // (/, ?, #) не должны ломать маршрут.
    if (trimmed) navigate(`/play/${encodeURIComponent(trimmed)}`);
  };

  return (
    <main>
      <h1>MyMozhem</h1>
      <p>Квизы и розыгрыши для живых событий.</p>
      <section>
        <h2>Я организатор</h2>
        <p>
          <Link to="/host/login">Войти по токену организатора</Link>
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
