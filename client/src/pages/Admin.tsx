import { useEffect, useState } from 'react';
import { socket, ask } from '../lib/socket';
import type { Bank, PublicTeam, RoomState, Settings } from '../lib/types';
import {
  Button,
  Card,
  CheckOption,
  ErrorNote,
  Field,
  Input,
  Page,
  dangerLevel,
  formatTime,
  levelColor,
  type MenuAction,
} from '../components/ui';
import {
  BoomIcon,
  ClockIcon,
  CopyIcon,
  ExitIcon,
  EyeIcon,
  EyeOffIcon,
  HistoryIcon,
  MinusIcon,
  OfflineIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  RestartIcon,
  ScreenIcon,
  SettingsIcon,
  CloseIcon,
  TrophyIcon,
  UsersIcon,
} from '../components/icons';
import { Countdown, HistoryModal, TimeBar } from '../components/game';

const SESSION_KEY = 'qunbula:admin';

const DEFAULTS: Settings = {
  startSeconds: 30,
  correctBonus: 5,
  wrongPenalty: 3,
  maxSeconds: 120,
};

export default function Admin() {
  const [banks, setBanks] = useState<Bank[]>([]);
  const [room, setRoom] = useState<RoomState | null>(null);
  const [error, setError] = useState('');
  const [bankIds, setBankIds] = useState<string[]>([]);
  const [draft, setDraft] = useState<Settings>(DEFAULTS);

  useEffect(() => {
    void fetch('/api/banks')
      .then((r) => r.json())
      .then((list: Bank[]) => {
        setBanks(list);
        setBankIds(list.length ? [list[0].id] : []);
      })
      .catch(() => setError('تعذر تحميل بنوك الأسئلة'));
  }, []);

  useEffect(() => {
    const onState = (next: RoomState) => {
      setRoom(next);
      setDraft(next.settings);
    };
    socket.on('room:state', onState);
    return () => {
      socket.off('room:state', onState);
    };
  }, []);

  // استعادة الغرفة بعد تحديث الصفحة أو انقطاع النت
  useEffect(() => {
    const saved = localStorage.getItem(SESSION_KEY);
    if (!saved) return;
    const session = JSON.parse(saved) as { code: string; adminKey: string };
    const rejoin = async () => {
      const res = await ask<{ state: RoomState }>('admin:join', session);
      if (res.ok) setRoom(res.state);
      else localStorage.removeItem(SESSION_KEY);
    };
    void rejoin();
    socket.on('connect', rejoin);
    return () => {
      socket.off('connect', rejoin);
    };
  }, []);

  const createRoom = async () => {
    setError('');
    const res = await ask<{ code: string; adminKey: string; state: RoomState }>('admin:createRoom', {
      bankIds,
      settings: draft,
    });
    if (!res.ok) return setError(res.error);
    localStorage.setItem(SESSION_KEY, JSON.stringify({ code: res.code, adminKey: res.adminKey }));
    setRoom(res.state);
  };

  if (!room) {
    const toggle = (id: string) =>
      setBankIds((current) =>
        current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
      );
    const total = banks
      .filter((b) => bankIds.includes(b.id))
      .reduce((sum, b) => sum + b.count, 0);

    return (
      <Page>
        <div className="mx-auto max-w-lg">
          <h1 className="mb-5 text-center text-3xl font-black text-[#103f91]">غرفة جديدة</h1>
          <Card className="grid gap-5">
            <Field label="بنوك الأسئلة — اختر واحداً أو أكثر">
              <div className="grid gap-2">
                {banks.map((bank) => (
                  <CheckOption
                    key={bank.id}
                    checked={bankIds.includes(bank.id)}
                    onToggle={() => toggle(bank.id)}
                    title={bank.name}
                    hint={`${bank.count} سؤال`}
                  />
                ))}
              </div>
              <p className="mt-2 text-sm text-[#9a968f]">
                تُخلط أسئلة البنوك المختارة وتُعرض عشوائياً — المجموع {total} سؤال
              </p>
            </Field>

            <SettingsEditor value={draft} onChange={setDraft} />
            <ErrorNote>{error}</ErrorNote>
            <Button onClick={createRoom} disabled={bankIds.length === 0}>
              أنشئ الغرفة
            </Button>
          </Card>
        </div>
      </Page>
    );
  }

  return <Console room={room} banks={banks} draft={draft} setDraft={setDraft} />;
}

function SettingsEditor({
  value,
  onChange,
  disabled,
}: {
  value: Settings;
  onChange: (next: Settings) => void;
  disabled?: boolean;
}) {
  const fields: [keyof Settings, string][] = [
    ['startSeconds', 'الوقت الابتدائي (ث)'],
    ['correctBonus', 'مكافأة الصح (ث)'],
    ['wrongPenalty', 'عقوبة الخطأ (ث)'],
    ['maxSeconds', 'السقف الأعلى (ث)'],
  ];
  return (
    <div className="grid grid-cols-2 gap-3">
      {fields.map(([key, label]) => (
        <Field key={key} label={label}>
          <Input
            type="number"
            min={1}
            disabled={disabled}
            value={value[key]}
            onChange={(e) => onChange({ ...value, [key]: Math.max(1, Number(e.target.value) || 1) })}
            className="text-center disabled:opacity-50"
          />
        </Field>
      ))}
    </div>
  );
}

const STATUS = {
  lobby: 'بانتظار البدء',
  countdown: 'استعداد…',
  running: 'الجولة جارية',
  paused: 'موقوفة مؤقتاً',
  ended: 'انتهت الجولة',
  finished: 'انتهت اللعبة',
} as const;

function Console({
  room,
  banks,
  draft,
  setDraft,
}: {
  room: RoomState;
  banks: Bank[];
  draft: Settings;
  setDraft: (next: Settings) => void;
}) {
  const [note, setNote] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const playUrl = `${location.origin}/play?code=${room.code}`;
  const displayUrl = `${location.origin}/display?code=${room.code}`;
  const idle =
    room.status === 'lobby' || room.status === 'ended' || room.status === 'finished';

  const send = (event: string, payload?: unknown) => socket.emit(event, payload ?? {});

  const flash = (message: string) => {
    setNote(message);
    setTimeout(() => setNote(''), 2000);
  };

  const copy = (url: string, label: string) => {
    void navigator.clipboard.writeText(url);
    flash(`نُسخ ${label}`);
  };

  const start = async () => {
    const res = await ask('admin:start');
    if (!res.ok) flash(res.error);
  };

  const actions: MenuAction[] = [
    { label: 'سجل الجولات', icon: <HistoryIcon size={18} />, onClick: () => setShowHistory(true) },
    {
      label: 'إنهاء اللعبة وعرض الأوائل',
      icon: <TrophyIcon size={18} />,
      onClick: () => {
        if (!confirm('إنهاء اللعبة وعرض الأوائل على شاشة العرض والمجموعات؟')) return;
        send('admin:finishGame');
      },
    },
    {
      label: room.displayBlurred ? 'إظهار شاشة العرض' : 'تغبيش شاشة العرض',
      icon: room.displayBlurred ? <EyeIcon size={18} /> : <EyeOffIcon size={18} />,
      onClick: () => send('admin:toggleBlur'),
    },
    {
      label: 'إعادة اللعبة',
      icon: <RestartIcon size={18} />,
      onClick: () => confirm('إعادة اللعبة؟ ستُصفَّر كل النقاط والجولات.') && send('admin:resetAll'),
    },
    { label: 'نسخ رابط الفرق', icon: <CopyIcon size={18} />, onClick: () => copy(playUrl, 'رابط الفرق') },
    { label: 'نسخ رابط العرض', icon: <ScreenIcon size={18} />, onClick: () => copy(displayUrl, 'رابط العرض') },
    { label: 'إعدادات اللعبة', icon: <SettingsIcon size={18} />, onClick: () => setShowSettings(true) },
    {
      label: 'الخروج من اللعبة',
      icon: <ExitIcon size={18} />,
      danger: true,
      onClick: () => {
        if (!confirm('الخروج من الغرفة؟ ستحتاج لإنشاء غرفة جديدة.')) return;
        localStorage.removeItem(SESSION_KEY);
        location.href = '/';
      },
    },
  ];

  return (
    <Page actions={actions}>
      <div className="grid gap-4">
        {/* بطاقة الغرفة: الرمز + بدء الجولة + الحالة */}
        <div className="flex flex-wrap items-center justify-between gap-6 rounded-2xl bg-gradient-to-l from-[#0a2a63] via-[#103f91] to-[#1a5fc4] p-6 text-white shadow-lg shadow-[#103f91]/20">
          <div>
            <div className="text-sm font-bold text-white/60">رمز الغرفة</div>
            <div className="text-6xl font-black tracking-[0.15em]">{room.code}</div>
            <div className="mt-1 text-sm font-bold text-white/60">الجولة {room.round}</div>
          </div>

          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-2 rounded-full bg-white/15 px-4 py-2 text-sm font-black backdrop-blur">
              <ClockIcon size={16} />
              {STATUS[room.status]}
            </span>

            {idle && (
              <Button onClick={start} disabled={room.teams.length === 0} className="px-6 py-3 text-lg">
                <PlayIcon size={18} />
                {room.status === 'ended' ? 'جولة جديدة' : 'ابدأ الجولة'}
              </Button>
            )}
            {room.status === 'running' && (
              <Button variant="ghost" onClick={() => send('admin:pause')} className="px-6 py-3 text-lg">
                <PauseIcon size={18} />
                إيقاف
              </Button>
            )}
            {room.status === 'paused' && (
              <Button onClick={() => send('admin:resume')} className="px-6 py-3 text-lg">
                <PlayIcon size={18} />
                استئناف
              </Button>
            )}
          </div>
        </div>

        {note && (
          <p className="rounded-xl bg-[#e7f7fb] px-4 py-2.5 text-center font-bold text-[#0e92af]">{note}</p>
        )}

        {room.status === 'ended' && room.result && (
          <Card>
            <h2 className="mb-3 text-lg font-black">نتائج الجولة {room.result.round}</h2>
            <div className="grid gap-2">
              {room.result.awards.map((award) => (
                <div
                  key={award.teamId}
                  className="flex items-center justify-between rounded-xl bg-[#faf9f6] px-4 py-2.5"
                >
                  <span className="font-bold">{award.name}</span>
                  <span className="text-sm text-[#6b6b6b]">
                    {award.exploded ? 'انفجرت' : `${formatTime(award.timeMs)} ث`}
                  </span>
                  <span className="font-black text-[#ff9f1c]">+{award.points}</span>
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* الفرق */}
        <Card>
          <h2 className="mb-3 flex items-center gap-2 text-lg font-black">
            <UsersIcon size={20} className="text-[#103f91]" />
            الفرق ({room.teams.length})
          </h2>
          {room.teams.length === 0 ? (
            <p className="py-8 text-center text-[#9a968f]">
              لم ينضم أحد بعد — شارك الرمز <span className="font-black text-[#103f91]">{room.code}</span>
            </p>
          ) : (
            <div className="grid gap-3">
              {room.teams.map((team) => (
                <TeamCard
                  key={team.id}
                  team={team}
                  onAdjust={(seconds) => send('admin:adjustTime', { teamId: team.id, seconds })}
                  onRemove={() =>
                    confirm(`إزالة فريق ${team.name}؟`) && send('admin:removeTeam', { teamId: team.id })
                  }
                />
              ))}
            </div>
          )}
        </Card>
      </div>

      {room.status === 'countdown' && <Countdown ms={room.countdownMs} />}

      {showHistory && <HistoryModal history={room.history} onClose={() => setShowHistory(false)} />}

      {showSettings && (
        <SettingsModal
          room={room}
          banks={banks}
          draft={draft}
          setDraft={setDraft}
          idle={idle}
          onClose={() => setShowSettings(false)}
          onSave={async () => {
            const res = await ask('admin:updateSettings', { settings: draft });
            flash(res.ok ? 'حُفظت الإعدادات' : res.error);
            if (res.ok) setShowSettings(false);
          }}
        />
      )}
    </Page>
  );
}

/**
 * بطاقة المجموعة: خط ملوّن ممتلئ على الطرف الأيمن،
 * الوقت بخط كبير متناقص، شريط التقدم، وعدد الإجابات.
 */
function TeamCard({
  team,
  onAdjust,
  onRemove,
}: {
  team: PublicTeam;
  onAdjust: (seconds: number) => void;
  onRemove: () => void;
}) {
  const color = team.exploded ? '#e52e25' : levelColor[dangerLevel(team.timeMs)];

  return (
    <div className="flex overflow-hidden rounded-2xl border border-[#e8e4dd] bg-white shadow-[0_1px_3px_rgba(26,26,26,0.04)]">
      {/* الخط الملوّن على طرف البطاقة */}
      <div className="w-2 shrink-0 transition-colors duration-500" style={{ backgroundColor: color }} />

      <div className="flex flex-1 flex-wrap items-center gap-4 p-4">
        <div className="min-w-40 flex-1">
          <div className="flex items-center gap-2 text-xl font-black">
            {team.name}
            {!team.connected && <OfflineIcon size={15} className="text-[#9a968f]" />}
          </div>
          <div className="text-sm text-[#9a968f]">
            أجابت على {team.answered} سؤال · {team.correct} صحيحة
          </div>
        </div>

        <div className="w-24 text-center">
          <div
            className="text-4xl font-black leading-none tabular-nums transition-colors duration-500"
            style={{ color }}
          >
            {team.exploded ? <BoomIcon size={34} className="mx-auto" /> : formatTime(team.timeMs)}
          </div>
          {!team.exploded && <div className="text-xs font-bold text-[#9a968f]">ثانية</div>}
        </div>

        <div className="w-20 text-center">
          <div className="text-2xl font-black text-[#ff9f1c]">{team.score}</div>
          <div className="text-xs font-bold text-[#9a968f]">نقطة</div>
        </div>

        <div className="flex gap-1.5">
          <IconButton title="أضف 5 ثوانٍ" onClick={() => onAdjust(5)}>
            <PlusIcon size={16} />
          </IconButton>
          <IconButton title="اخصم 5 ثوانٍ" onClick={() => onAdjust(-5)}>
            <MinusIcon size={16} />
          </IconButton>
          <IconButton title="إزالة الفريق" danger onClick={onRemove}>
            <CloseIcon size={16} />
          </IconButton>
        </div>

        <div className="w-full">
          <TimeBar timeMs={team.timeMs} exploded={team.exploded} />
        </div>
      </div>
    </div>
  );
}

function IconButton({
  children,
  danger,
  ...props
}: ButtonHTMLProps & { danger?: boolean }) {
  return (
    <button
      {...props}
      className={`flex size-8 items-center justify-center rounded-lg border transition active:scale-90 ${
        danger
          ? 'border-[#f5c9c6] bg-white text-[#e52e25] hover:bg-[#fdeae8]'
          : 'border-[#e8e4dd] bg-white text-[#103f91] hover:bg-[#eef3fa]'
      }`}
    >
      {children}
    </button>
  );
}

type ButtonHTMLProps = React.ButtonHTMLAttributes<HTMLButtonElement>;

function SettingsModal({
  room,
  banks,
  draft,
  setDraft,
  idle,
  onClose,
  onSave,
}: {
  room: RoomState;
  banks: Bank[];
  draft: Settings;
  setDraft: (next: Settings) => void;
  idle: boolean;
  onClose: () => void;
  onSave: () => void;
}) {
  const toggleBank = (id: string) => {
    const next = room.bankIds.includes(id)
      ? room.bankIds.filter((x) => x !== id)
      : [...room.bankIds, id];
    if (next.length === 0) return; // لا بد من بنك واحد على الأقل
    socket.emit('admin:setBanks', { bankIds: next });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="drop-in max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-xl font-black">
            <SettingsIcon size={20} className="text-[#103f91]" />
            إعدادات اللعبة
          </h2>
          <IconButton title="إغلاق" onClick={onClose}>
            <CloseIcon size={16} />
          </IconButton>
        </div>

        <div className="grid gap-5">
          {!idle && (
            <p className="rounded-xl bg-[#fff6e8] px-4 py-2.5 text-sm font-bold text-[#e68500]">
              أوقف الجولة لتعديل الأرقام
            </p>
          )}
          <SettingsEditor value={draft} onChange={setDraft} disabled={!idle} />

          <Field label="بنوك الأسئلة">
            <div className="grid gap-2">
              {banks.map((bank) => (
                <CheckOption
                  key={bank.id}
                  checked={room.bankIds.includes(bank.id)}
                  onToggle={() => toggleBank(bank.id)}
                  title={bank.name}
                  hint={`${bank.count} سؤال`}
                />
              ))}
            </div>
          </Field>

          <div className="flex gap-2">
            <Button className="flex-1" onClick={onSave} disabled={!idle}>
              حفظ
            </Button>
            <Button variant="ghost" onClick={onClose}>
              إغلاق
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
