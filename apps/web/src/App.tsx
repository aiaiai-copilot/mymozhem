import { Route, Routes } from 'react-router-dom';
import { PlayPage } from './pages/play/play-page';
import { ScreenPage } from './pages/screen/screen-page';

// Маршруты UI-среза (план 2026-09-23): /play — участник (Task 11), /screen —
// проектор (Task 12), остальные маршруты приходят батчами C/D — placeholder.
export function App() {
  return (
    <Routes>
      <Route path="/" element={<p>tbd</p>} />
      <Route path="/host/*" element={<p>tbd</p>} />
      <Route path="/play/:code?" element={<PlayPage />} />
      <Route path="/screen/:code" element={<ScreenPage />} />
    </Routes>
  );
}
