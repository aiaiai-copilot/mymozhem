import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Landing } from './pages/Landing'
import { AdminDashboard } from './pages/AdminDashboard'
import { ParticipantRoom } from './pages/ParticipantRoom'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/admin/:secretId" element={<AdminDashboard />} />
        <Route path="/room/:publicId" element={<ParticipantRoom />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
