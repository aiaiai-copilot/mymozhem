import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Landing } from './pages/Landing'
import { AdminDashboard } from './pages/AdminDashboard'
import { ParticipantRoom } from './pages/ParticipantRoom'
import { HookTest } from './components/test/HookTest'
import { Toaster } from './components/ui/toaster'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/admin/:secretId" element={<AdminDashboard />} />
        <Route path="/room/:publicId" element={<ParticipantRoom />} />
        <Route path="/test" element={<HookTest />} />
      </Routes>
      <Toaster />
    </BrowserRouter>
  )
}

export default App
