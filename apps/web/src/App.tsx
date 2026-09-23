import { Route, Routes } from 'react-router-dom';

// Маршруты-заглушки UI-среза (план 2026-09-23): каркас навигации фиксируется
// сейчас, реальные страницы приходят батчами C/D — до тех пор каждый маршрут
// отдаёт заметный placeholder, а не пустой экран.
export function App() {
  return (
    <Routes>
      <Route path="/" element={<p>tbd</p>} />
      <Route path="/host/*" element={<p>tbd</p>} />
      <Route path="/play/:code?" element={<p>tbd</p>} />
      <Route path="/screen/:code" element={<p>tbd</p>} />
    </Routes>
  );
}
