import { useEffect, useMemo, useState } from 'react';
import {
  type Api,
  type Col,
  Badge,
  Cell,
  Empty,
  Grid,
  Loading,
  Panel,
  Row,
  Stat,
  StatRow,
  day,
  say,
  span,
  stamp,
  unit,
} from './shared';
import { Stars } from './Dashboard';
import type { Counts, Sift } from './Banks';

type Props = {
  api: Api;
  sift: Sift;
  onCounts: (counts: Counts) => void;
  reloadKey: number;
};

/* ══════════════ الغرف ══════════════ */

type Room = {
  code: string;
  name: string;
  difficulty: string;
  status: string;
  createdAt: number;
  startedAt: number | null;
  playedMs: number | null;
  rounds: number;
  players: number;
  questions: number;
};

const DIFFICULTY: Record<string, string> = {
  primary: 'ابتدائي',
  middle: 'متوسط',
  secondary: 'ثانوي',
  university: 'جامعي',
};

const STATUS: Record<string, { label: string; tone: 'safe' | 'mute' | 'signal' }> = {
  lobby: { label: 'بانتظار', tone: 'signal' },
  countdown: { label: 'استعداد', tone: 'signal' },
  running: { label: 'جارية', tone: 'safe' },
  paused: { label: 'موقوفة', tone: 'signal' },
  ended: { label: 'بين جولتين', tone: 'signal' },
  finished: { label: 'انتهت', tone: 'mute' },
};

const ROOM_COLS: Col[] = [
  { label: 'الرمز', w: '0.7fr' },
  { label: 'الاسم', w: '1.6fr' },
  { label: 'التاريخ', w: '0.9fr' },
  { label: 'المستوى', w: '0.8fr' },
  { label: 'لاعبون', w: '0.7fr', align: 'center' },
  { label: 'جولات', w: '0.7fr', align: 'center' },
  { label: 'أسئلة', w: '0.7fr', align: 'center' },
  { label: 'المدّة', w: '0.9fr' },
  { label: 'الحال', w: '0.9fr' },
];

export function Rooms({ api, sift, onCounts, reloadKey }: Props) {
  const [rows, setRows] = useState<Room[] | null>(null);

  useEffect(() => {
    setRows(null);
    void api.get<Room[]>('rooms').then(setRows);
  }, [api, reloadKey]);

  const all = useMemo(() => rows ?? [], [rows]);

  useEffect(() => {
    if (!rows) return;
    onCounts({
      all: all.length,
      live: all.filter((r) => r.status !== 'finished').length,
      done: all.filter((r) => r.status === 'finished').length,
      unplayed: all.filter((r) => r.startedAt === null).length,
    });
  }, [rows, all, onCounts]);

  if (!rows) return <Loading />;

  const text = sift.search.trim();
  const shown = all.filter((room) => {
    if (text && !room.name.includes(text) && !room.code.includes(text.toUpperCase())) return false;
    if (sift.view === 'live') return room.status !== 'finished';
    if (sift.view === 'done') return room.status === 'finished';
    if (sift.view === 'unplayed') return room.startedAt === null;
    return true;
  });

  const players = all.reduce((n, r) => n + r.players, 0);
  const rounds = all.reduce((n, r) => n + r.rounds, 0);
  const totalMs = all.reduce((n, r) => n + (r.playedMs ?? 0), 0);
  const played = all.filter((r) => r.playedMs !== null).length;

  return (
    <div className="grid gap-4">
      <StatRow>
        <Stat
          lead
          label="الغرف"
          value={all.length}
          unit={unit(all.length, 'room')}
          hint={played === all.length && all.length ? 'كلّها لُعبت فعلاً' : `${played} منها لُعبت`}
        />
        <Stat
          label="اللاعبون"
          value={players}
          unit={unit(players, 'player')}
          hint={all.length ? `${(players / all.length).toFixed(1)} في الغرفة` : undefined}
        />
        <Stat
          label="الجولات"
          value={rounds}
          unit={unit(rounds, 'round')}
          hint={all.length ? `${(rounds / all.length).toFixed(1)} في الغرفة` : undefined}
        />
        <Stat label="زمن اللعب" value={span(totalMs)} hint="من انطلاق أول جولة إلى آخر أثر" />
      </StatRow>

      <Panel
        title={
          shown.length === all.length
            ? say(all.length, 'room')
            : `${shown.length} من ${say(all.length, 'room')}`
        }
        hint="السجلّ يحفظ ستّين يوماً، ثم يُنسى ما قبلها"
        flush
      >
        {shown.length === 0 ? (
          <Empty title="لا غرف تطابق" lead="بدّل العرض من الشريط الجانبيّ، أو امسح البحث." />
        ) : (
          <Grid cols={ROOM_COLS}>
            {shown.map((room) => (
              <Row key={room.code} cols={ROOM_COLS}>
                <Cell className="tnum text-[13px] tracking-[0.12em] text-faint">{room.code}</Cell>
                <Cell className="font-bold">{room.name}</Cell>
                <Cell className="text-[13px] text-muted">{day(room.createdAt)}</Cell>
                <Cell className="text-[13px] text-muted">
                  {DIFFICULTY[room.difficulty] ?? room.difficulty}
                </Cell>
                <Cell align="center" className="tnum">
                  {room.players}
                </Cell>
                <Cell align="center" className="tnum">
                  {room.rounds}
                </Cell>
                <Cell align="center" className="tnum">
                  {room.questions}
                </Cell>
                {/* غرفةٌ أُنشئت ولم تبدأ لا مدّة لها — والشرطةُ أصدق من صفر */}
                <Cell className={`tnum ${room.playedMs === null ? 'text-faint' : 'font-bold'}`}>
                  {span(room.playedMs)}
                </Cell>
                <Cell>
                  <Badge tone={STATUS[room.status]?.tone ?? 'mute'}>
                    {STATUS[room.status]?.label ?? room.status}
                  </Badge>
                </Cell>
              </Row>
            ))}
          </Grid>
        )}
      </Panel>
    </div>
  );
}

/* ══════════════ التعليقات ══════════════ */

type Comment = {
  id: number;
  stars: number | null;
  note: string | null;
  byRole: string | null;
  byName: string | null;
  roomCode: string | null;
  roomName: string | null;
  createdAt: number;
};

export function Comments({ api, sift, onCounts, reloadKey }: Props) {
  const [rows, setRows] = useState<Comment[] | null>(null);

  useEffect(() => {
    setRows(null);
    void api.get<Comment[]>('feedback?kind=comment').then(setRows);
  }, [api, reloadKey]);

  const all = useMemo(() => rows ?? [], [rows]);

  useEffect(() => {
    if (!rows) return;
    onCounts({
      all: all.length,
      player: all.filter((r) => r.byRole === 'player').length,
      admin: all.filter((r) => r.byRole === 'admin').length,
      text: all.filter((r) => r.note).length,
      low: all.filter((r) => (r.stars ?? 5) <= 2).length,
    });
  }, [rows, all, onCounts]);

  if (!rows) return <Loading />;

  const text = sift.search.trim();
  const shown = all.filter((row) => {
    if (text && !(row.note ?? '').includes(text) && !(row.roomName ?? '').includes(text)) {
      return false;
    }
    if (sift.view === 'admin') return row.byRole === 'admin';
    if (sift.view === 'player') return row.byRole === 'player';
    if (sift.view === 'low') return (row.stars ?? 5) <= 2;
    if (sift.view === 'text') return Boolean(row.note);
    return true;
  });

  const rated = all.filter((r) => r.stars);
  const average = rated.length
    ? rated.reduce((n, r) => n + (r.stars ?? 0), 0) / rated.length
    : null;
  const low = all.filter((r) => (r.stars ?? 5) <= 2).length;
  const written = all.filter((r) => r.note).length;

  return (
    <div className="grid gap-4">
      <StatRow>
        <Stat
          lead
          label="التعليقات"
          value={all.length}
          unit={unit(all.length, 'comment')}
          hint={
            written === all.length && all.length ? 'كلّها فيها نصّ' : `${written} منها فيها نصّ`
          }
        />
        <Stat
          label="متوسط التقييم"
          value={average === null ? '—' : average.toFixed(1)}
          unit={average === null ? '' : 'من 5'}
          tone={average !== null && average >= 4 ? 'safe' : undefined}
          hint={`${say(rated.length, 'rating')} بالنجوم`}
        />
        <Stat
          label="تقييمٌ منخفض"
          value={low}
          tone={low > 0 ? 'warn' : undefined}
          hint="نجمتان فأقلّ — اقرأها أولاً"
        />
        <Stat
          label="من اللاعبين"
          value={all.filter((r) => r.byRole === 'player').length}
          hint="باسم الفريق لا باسم اللاعب"
        />
      </StatRow>

      {shown.length === 0 ? (
        <Panel>
          <Empty title="لا تعليقات تطابق" lead="بدّل العرض من الشريط الجانبيّ، أو امسح البحث." />
        </Panel>
      ) : (
        <div className="grid gap-3.5 [grid-template-columns:repeat(auto-fill,minmax(330px,1fr))]">
          {shown.map((row) => (
            <article key={row.id} className="tile flex flex-col p-4">
              <div className="flex items-center gap-2.5 text-[12.5px]">
                {row.stars ? (
                  <Stars n={row.stars} />
                ) : (
                  <span className="text-faint">بلا تقييم</span>
                )}
                <span className="tnum ms-auto font-medium text-faint">{stamp(row.createdAt)}</span>
              </div>
              {row.note ? (
                <p className="mt-2.5 flex-1 text-[14px] leading-relaxed text-ink">{row.note}</p>
              ) : (
                <p className="mt-2.5 flex-1 text-[13px] text-faint">تقييمٌ بلا نصّ</p>
              )}
              <div className="mt-3 border-t border-line-soft pt-2.5 text-[12.5px] font-medium text-muted">
                {row.byRole === 'admin' ? 'منظّم' : `لاعب · ${row.byName ?? '—'}`}
                {row.roomName && ` · غرفة ${row.roomName}`}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
