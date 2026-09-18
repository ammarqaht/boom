import { useEffect } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import Home from './pages/Home';
import Play from './pages/Play';
import Display from './pages/Display';
import Admin from './pages/Admin';
import Owner from './pages/Owner';
import { Scrollbar } from './components/ui';

/** كل انتقال أو تحديث يبدأ من أعلى الصفحة */
function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [pathname]);
  return null;
}

export default function App() {
  return (
    <>
      <ScrollToTop />
      {/* شريطُ الصفحة: يطفو في الحافّة اليسرى ولا يقتطع عرضاً */}
      <Scrollbar />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/play" element={<Play />} />
        <Route path="/display" element={<Display />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="/console" element={<Owner />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
