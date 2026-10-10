import { Component, lazy, Suspense, useEffect, type ReactNode } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import Home from './pages/Home';
import { Button, Scrollbar, Toasts, Wordmark } from './components/ui';
import { RefreshIcon } from './components/icons';

const RELOAD_KEY = 'nabda:chunk-reload';

function reloadOnce(error: unknown): Promise<never> {
  let last = 0;
  try {
    last = Number(sessionStorage.getItem(RELOAD_KEY)) || 0;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    throw error;
  }
  if (Date.now() - last < 10000) throw error;
  location.reload();
  return new Promise<never>(() => {});
}

const Play = lazy(() => import('./pages/Play').catch(reloadOnce));
const Display = lazy(() => import('./pages/Display').catch(reloadOnce));
const Admin = lazy(() => import('./pages/Admin').catch(reloadOnce));
const Owner = lazy(() => import('./pages/Owner').catch(reloadOnce));

class RouteBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="flex min-h-dvh flex-col items-center justify-center gap-8 bg-ground px-5">
        <Wordmark className="text-5xl" />
        <Button size="lg" onClick={() => location.reload()}>
          <RefreshIcon size={18} />
          أعد المحاولة
        </Button>
      </div>
    );
  }
}

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
      {/* خبرٌ عابرٌ أعلى الشاشة — مرفأٌ واحدٌ تناديه كلُّ صفحة */}
      <Toasts />
      <RouteBoundary>
        <Suspense fallback={null}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/play" element={<Play />} />
            <Route path="/display" element={<Display />} />
            <Route path="/admin" element={<Admin />} />
            <Route path="/console" element={<Owner />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </RouteBoundary>
    </>
  );
}
