import { useEffect, useRef, useState, type ReactNode, type ButtonHTMLAttributes } from 'react';
import { Link } from 'react-router-dom';
import { CheckIcon, MenuIcon } from './icons';

export function formatTime(ms: number) {
  const seconds = Math.max(0, ms) / 1000;
  return seconds >= 100 ? seconds.toFixed(0) : seconds.toFixed(1);
}

/** الشريط يمتلئ عند 30 ثانية فأكثر، ثم ينحسر مع الوقت */
export const BAR_FULL_MS = 30000;

export const barPercent = (ms: number) =>
  Math.max(0, Math.min(100, (ms / BAR_FULL_MS) * 100));

/** أخضر فوق الربع، أصفر عند الربع، أحمر عندما يبقى القليل */
export function dangerLevel(ms: number): 'safe' | 'warn' | 'danger' {
  const pct = ms / BAR_FULL_MS;
  if (pct > 0.25) return 'safe';
  if (pct > 0.1) return 'warn';
  return 'danger';
}

export const levelColor = {
  safe: '#22a45d',
  warn: '#f5a524',
  danger: '#e52e25',
} as const;

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'blue' | 'ghost' | 'danger';
};

export function Button({ variant = 'primary', className = '', ...props }: ButtonProps) {
  const styles = {
    primary: 'bg-[#ff9f1c] text-white hover:bg-[#e68500] shadow-sm shadow-[#ff9f1c]/30',
    blue: 'bg-[#103f91] text-white hover:bg-[#0c2f6e]',
    ghost: 'bg-white text-[#1a1a1a] border border-[#e8e4dd] hover:bg-[#faf9f6]',
    danger: 'bg-[#e52e25] text-white hover:bg-[#c2231b]',
  }[variant];
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 font-bold transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100 ${styles} ${className}`}
    />
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-[#e8e4dd] bg-white p-5 shadow-[0_1px_3px_rgba(26,26,26,0.04)] ${className}`}>
      {children}
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-bold text-[#6b6b6b]">{label}</span>
      {children}
    </label>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full rounded-xl border border-[#e8e4dd] bg-[#faf9f6] px-4 py-3 text-lg font-medium outline-none transition placeholder:text-[#b5b0a7] focus:border-[#ff9f1c] focus:bg-white ${props.className ?? ''}`}
    />
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p className="rounded-xl bg-[#fdeae8] px-4 py-2.5 text-center font-bold text-[#c2231b]">{children}</p>
  );
}

export function Logo({ className = 'h-9', white }: { className?: string; white?: boolean }) {
  return (
    <img
      src={white ? '/nibras-logo-white.png' : '/nibras-logo.png'}
      alt="نادي نبراس"
      className={`${className} w-auto`}
    />
  );
}

export interface MenuAction {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  danger?: boolean;
}

/** شريط علوي: الشعار + زر خيارات اللعبة */
export function NavBar({ actions, cta }: { actions?: MenuAction[]; cta?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <header className="sticky top-0 z-40 border-b border-[#e8e4dd] bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3">
        <Link to="/" className="flex items-center gap-3">
          <Logo />
          <span className="hidden border-r border-[#e8e4dd] pr-3 text-lg font-black text-[#103f91] sm:block">
            القنبلة
          </span>
        </Link>

        {cta}

        {actions && actions.length > 0 && (
          <div className="relative" ref={ref}>
            <Button variant="ghost" onClick={() => setOpen((v) => !v)}>
              <MenuIcon size={18} />
              خيارات اللعبة
            </Button>
            {open && (
              <div className="drop-in absolute left-0 z-50 mt-2 w-60 overflow-hidden rounded-2xl border border-[#e8e4dd] bg-white p-1.5 shadow-xl shadow-black/5">
                {actions.map((action) => (
                  <button
                    key={action.label}
                    onClick={() => {
                      setOpen(false);
                      action.onClick();
                    }}
                    className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-right font-bold transition hover:bg-[#faf9f6] ${
                      action.danger ? 'text-[#e52e25]' : 'text-[#1a1a1a]'
                    }`}
                  >
                    <span className={action.danger ? 'text-[#e52e25]' : 'text-[#103f91]'}>
                      {action.icon}
                    </span>
                    {action.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="mt-auto bg-gradient-to-l from-[#0a2a63] via-[#103f91] to-[#1a5fc4] text-white">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 px-5 py-7 text-center sm:flex-row sm:justify-between sm:text-right">
        <Logo className="h-10" white />
        <div className="text-sm">
          <p className="font-bold">© {new Date().getFullYear()} نادي نبراس — جميع الحقوق محفوظة</p>
          <p className="mt-0.5 text-white/60">تم إنشاء الموقع بواسطة مشعل الجلال</p>
        </div>
      </div>
    </footer>
  );
}

/** هيكل الصفحة: نافبار + محتوى + فوتر ملتصق بالأسفل */
export function Page({
  actions,
  width = 'wide',
  children,
}: {
  actions?: MenuAction[];
  /** wide للوحات، narrow لنماذج الدخول */
  width?: 'wide' | 'narrow';
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-full flex-col">
      <NavBar actions={actions} />
      <main
        className={`mx-auto w-full flex-1 px-5 py-8 ${width === 'wide' ? 'max-w-6xl' : 'max-w-2xl'}`}
      >
        {children}
      </main>
      <Footer />
    </div>
  );
}

/** خيار قابل للتحديد المتعدد — لبنوك الأسئلة */
export function CheckOption({
  checked,
  onToggle,
  title,
  hint,
}: {
  checked: boolean;
  onToggle: () => void;
  title: string;
  hint?: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-right transition ${
        checked ? 'border-[#ff9f1c] bg-[#fff6e8]' : 'border-[#e8e4dd] bg-white hover:bg-[#faf9f6]'
      }`}
    >
      <span className="flex items-center gap-3">
        <span
          className={`flex size-5 shrink-0 items-center justify-center rounded-md border-2 transition ${
            checked ? 'border-[#ff9f1c] bg-[#ff9f1c] text-white' : 'border-[#d8d3ca] bg-white'
          }`}
        >
          {checked && <CheckIcon size={13} strokeWidth={3.5} />}
        </span>
        <span className="font-bold">{title}</span>
      </span>
      {hint && <span className="text-sm text-[#9a968f]">{hint}</span>}
    </button>
  );
}
