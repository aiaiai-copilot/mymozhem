import { Route, Routes } from 'react-router-dom';
import { LandingPage } from './pages/landing';
import { HOST_NEW_PATH } from './routes';
import { ConsolePage } from './pages/host/console-page';
import { HostGate } from './pages/host/host-gate';
import { HostLoginPage } from './pages/host/host-login-page';
import { SetupPage } from './pages/host/setup-page';
import { NotFoundPage } from './pages/not-found';
import { PlayPage } from './pages/play/play-page';
import { ScreenPage } from './pages/screen/screen-page';

// Маршруты UI-среза (план 2026-09-23): / — лендинг, /host/login — вход
// организатора по setup-токену (ADR-012 §2), /host — гейт организатора,
// /host/new — setup комнаты (Task 13), /host/console — консоль
// ведущего (Task 14), /play — участник (Task 11), /screen — проектор (Task 12).
// '*' — catch-all: опечатка в URL даёт 404-страницу, а не пустой экран.
export function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/host/login" element={<HostLoginPage />} />
      <Route path="/host" element={<HostGate />} />
      <Route path={HOST_NEW_PATH} element={<SetupPage />} />
      <Route path="/host/console" element={<ConsolePage />} />
      <Route path="/play/:code?" element={<PlayPage />} />
      <Route path="/screen/:code" element={<ScreenPage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
