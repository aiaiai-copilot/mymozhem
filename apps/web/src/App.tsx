import { Route, Routes } from 'react-router-dom';
import { PlayPage } from './pages/play/play-page';

// Маршруты UI-среза (план 2026-09-23): /play — реальная страница участника
// (Task 11), остальные маршруты приходят батчами C/D — до тех пор placeholder.
export function App() {
  return (
    <Routes>
      <Route path="/" element={<p>tbd</p>} />
      <Route path="/host/*" element={<p>tbd</p>} />
      <Route path="/play/:code?" element={<PlayPage />} />
      <Route path="/screen/:code" element={<p>tbd</p>} />
    </Routes>
  );
}
