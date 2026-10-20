import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
// Визуальный фундамент (T4): порядок важен — токены → база → состояния.
import './styles/tokens.css';
import './styles/base.css';
import './styles/transitions.css';

// SPA-монтирование; маршруты живут в App, чтобы тесты могли рендерить их
// под MemoryRouter без привязки к DOM.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
