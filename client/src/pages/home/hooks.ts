import { useEffect, useRef, useState } from 'react';
import { prefersReducedMotion } from '../../components/ui';

export function useInView<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!('IntersectionObserver' in window)) {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      { threshold: 0.2 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return [ref, inView] as const;
}

export function usePageVisible() {
  const [visible, setVisible] = useState(() => document.visibilityState !== 'hidden');
  useEffect(() => {
    const sync = () => setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, []);
  return visible;
}

export function useLoop(active: boolean, period: number, still: number, restart: unknown) {
  const [t, setT] = useState(still);

  useEffect(() => {
    if (!active || prefersReducedMotion()) {
      setT(still);
      return;
    }
    setT(0);
    const start = performance.now();
    const id = window.setInterval(() => setT((performance.now() - start) % period), 100);
    return () => window.clearInterval(id);
  }, [active, period, still, restart]);

  return t;
}

export function tap() {
  if (prefersReducedMotion()) return;
  if (typeof navigator.vibrate === 'function') navigator.vibrate(8);
}
