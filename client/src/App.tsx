import { Routes, Route, Navigate } from 'react-router-dom';
import Home from './pages/Home';
import Play from './pages/Play';
import Display from './pages/Display';
import Admin from './pages/Admin';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/play" element={<Play />} />
      <Route path="/display" element={<Display />} />
      <Route path="/admin" element={<Admin />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
