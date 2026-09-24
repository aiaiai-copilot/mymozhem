import { Route, Routes } from 'react-router-dom';
import { LandingPage } from './pages/landing';
import { ConsolePage } from './pages/host/console-page';
import { HostGate } from './pages/host/host-gate';
import { SetupPage } from './pages/host/setup-page';
import { PlayPage } from './pages/play/play-page';
import { ScreenPage } from './pages/screen/screen-page';

// Маршруты UI-среза (план 2026-09-23): / — лендинг, /host — OAuth-гейт
// организатора, /host/new — setup комнаты (Task 13), /host/console — консоль
// ведущего (Task 14), /play — участник (Task 11), /screen — проектор (Task 12).
export function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/host" element={<HostGate />} />
      <Route path="/host/new" element={<SetupPage />} />
      <Route path="/host/console" element={<ConsolePage />} />
      <Route path="/play/:code?" element={<PlayPage />} />
      <Route path="/screen/:code" element={<ScreenPage />} />
    </Routes>
  );
}
