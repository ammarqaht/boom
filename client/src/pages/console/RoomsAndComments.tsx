import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  type Api,
  type Col,
  Badge,
  Cell,
  Empty,
  Grid,
  Loading,
  Modal,
  Panel,
  Row,
  Stat,
  StatRow,
  day,
  say,
  span,
  stamp,
  unit,
  MoreRows,
  useFeed,
  usePaged,
} from './shared';
import { TrashIcon } from '../../components/icons';
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
  { label: '', w: '46px', align: 'center' },
];

export function Rooms({ api, sift, onCounts, reloadKey }: Props) {
  const [doomed, setDoomed] = useState<Room | null>(null);
  /*
   * الغرف لا تنقضي بمدّة، فصفحتُها تعرض السجلّ كلَّه ما لم يُحدَّد مدًى.
   * واللوحةُ الرئيسة تبقى على الستين — نظرةٌ على ما قرُب لا أرشيف.
   */
  const from = sift.range?.from;
  const to = sift.range?.to;

  const load = useCallback(
    () => api.get<Room[]>(from ? `rooms?from=${from}&to=${to ?? Date.now()}` : 'rooms?all=1'),
    [api, from, to],
  );
  const [rows, setRows] = useFeed(load, reloadKey);

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

  return (
    <div className="grid gap-4">
      <StatRow>
        <Stat
          lead
          label="الغرف"
          value={all.length}
          unit={unit(all.length, 'room')}
        />
        <Stat
          label="اللاعبون"
          value={players}
          unit={unit(players, 'player')}
        />
        <Stat
          label="الجولات"
          value={rounds}
          unit={unit(rounds, 'round')}
        />
        <Stat label="زمن اللعب" value={span(totalMs)} />
      </StatRow>

      <Panel
        title={
          shown.length === all.length
            ? say(all.length, 'room')
            : `${shown.length} من ${say(all.length, 'room')}`
        }
        flush
      >
        {shown.length === 0 ? (
          <Empty title="لا غرف تطابق" />
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
                <Cell align="center">
                  <button
                    type="button"
                    onClick={() => setDoomed(room)}
                    title={`حذف غرفة ${room.name}`}
                    aria-label={`حذف غرفة ${room.name}`}
                    className="inline-flex size-8 items-center justify-center rounded-chip text-faint transition hover:bg-danger-2 hover:text-danger"
                  >
                    <TrashIcon size={15} />
                  </button>
                </Cell>
              </Row>
            ))}
          </Grid>
        )}
      </Panel>

      {doomed && (
        <DeleteRoom
          api={api}
          room={doomed}
          onClose={() => setDoomed(null)}
          onDone={() => {
            setRows((prev) => (prev ?? []).filter((r) => r.code !== doomed.code));
            setDoomed(null);
          }}
        />
      )}
    </div>
  );
}

/* ══════════════ حذف الغرفة ══════════════ */

type Detail = Room & {
  comments: number;
  reports: number;
  live: boolean;
  /** نصيبُ هذه الغرفة من إحصاء الأسئلة — يُطرح عند الحذف */
  stats: { questions: number; shown: number };
};

/** سطرُ تفصيلٍ في بطاقة المراجعة — عنوانٌ فوق قيمة */
function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <span className="block text-[12px] font-bold text-faint">{label}</span>
      <span className="mt-0.5 block truncate text-[14px] font-black text-ink">{value}</span>
    </div>
  );
}

/**
 * الحذفُ لا رجعة فيه، فيُقرأ قبل أن يقع.
 *
 * تعرض النافذة الغرفة كما هي، ثم تفصل صراحةً: ما يُمحى وما يبقى. وإحصاءُ
 * الأسئلة يبقى لأنه مجموعُ الغرف كلّها ولا يُعرف نصيبُ غرفةٍ منه ليُطرح —
 * وقولُ ذلك أصدق من ترك المالك يظنّ أنه محا أثرها من البنك.
 */
function DeleteRoom({
  api,
  room,
  onClose,
  onDone,
}: {
  api: Api;
  room: Room;
  onClose: () => void;
  onDone: () => void;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api.get<Detail>(`room/${room.code}`).then(setDetail);
  }, [api, room.code]);

  const remove = async () => {
    setBusy(true);
    setError(null);
    const res = await api.send<{ error?: string }>('DELETE', `room/${room.code}`);
    setBusy(false);
    if (!res.ok) return setError(res.data?.error ?? 'تعذّر الحذف');
    onDone();
  };

  /* الحيّةُ لا تُحذف. والحال المحليّة تكفي حتى تصل التفاصيل من الخادم */
  const live = detail?.live ?? room.status !== 'finished';

  return (
    <Modal
      title="حذف الغرفة"
      hint={`${room.name} · ${room.code}`}
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            onClick={remove}
            disabled={busy || live}
            title={live ? 'الغرفة تعمل الآن — أنهِ المسابقة ثم احذفها' : undefined}
            className="h-10 rounded-chip bg-danger px-4 text-[14px] font-black text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? 'يُحذف…' : 'احذف نهائياً'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="h-10 rounded-chip px-4 text-[14px] font-bold text-ink-2 shadow-[inset_0_0_0_1px_var(--color-line)] transition hover:bg-surface-2"
          >
            إلغاء
          </button>
          {error && <span className="text-[13px] font-bold text-danger">{error}</span>}
        </>
      }
    >
      <div className="grid gap-4">
        <div className="grid grid-cols-2 gap-x-5 gap-y-3.5 rounded-card bg-surface-2 px-5 py-4 shadow-[inset_0_0_0_1px_var(--color-line)] sm:grid-cols-4">
          <Fact label="الرمز" value={<span className="tnum tracking-[0.12em]">{room.code}</span>} />
          <Fact label="التاريخ" value={stamp(room.createdAt)} />
          <Fact label="المستوى" value={DIFFICULTY[room.difficulty] ?? room.difficulty} />
          <Fact label="الحال" value={STATUS[room.status]?.label ?? room.status} />
          <Fact label="اللاعبون" value={say(room.players, 'player')} />
          <Fact label="الجولات" value={say(room.rounds, 'round')} />
          <Fact label="الأسئلة" value={room.questions} />
          <Fact label="المدّة" value={span(room.playedMs)} />
        </div>

        {live ? (
          <p className="rounded-card bg-warn-2 px-5 py-4 text-[14px] leading-relaxed font-bold text-warn-ink">
            الغرفة تعمل الآن ولاعبوها متّصلون. أنهِ المسابقة من شاشة المنظّم ثم احذفها — ولو مُحي
            سجلُّها من تحتهم لانقطعوا بلا خبر.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-card px-5 py-4 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-danger)_25%,transparent)]">
              <b className="block text-[13px] font-black text-danger">يُمحى نهائياً</b>
              <ul className="mt-2 grid gap-1.5 text-[13px] leading-relaxed font-medium text-ink-2">
                <li>سجلُّ الغرفة — لاعبوها وجولاتها ومدّتها</li>
                <li>لقطتُها المحفوظة، فلا تُستأنف بعدها</li>
                {/* «ما كُتب فيها» يستقيم مع أيّ عدد — ولا يُجبرنا على مطابقة الفعل */}
                <li>
                  {detail
                    ? `ما كُتب فيها: ${say(detail.comments, 'comment')} و${say(detail.reports, 'report')}`
                    : 'ما كُتب فيها من تعليقاتٍ وبلاغات'}
                </li>
                {/* نصيبُها من الإحصاء يُطرح الآن — فيُقال عددُه قبل أن يقع */}
                <li>
                  {detail
                    ? detail.stats.questions > 0
                      ? `نصيبُها من إحصاء الأسئلة: ${say(detail.stats.questions, 'question')} و${detail.stats.shown} عرضة`
                      : 'لا نصيبَ لها في إحصاء الأسئلة'
                    : 'نصيبُها من إحصاء الأسئلة'}
                </li>
              </ul>
            </div>
            <div className="rounded-card px-5 py-4 shadow-[inset_0_0_0_1px_var(--color-line)]">
              <b className="block text-[13px] font-black text-muted">يبقى كما هو</b>
              <ul className="mt-2 grid gap-1.5 text-[13px] leading-relaxed font-medium text-muted">
                <li>الأسئلةُ نفسها في بنوكها</li>
                <li>ما قاسته الغرفُ الأخرى على تلك الأسئلة</li>
              </ul>
            </div>
          </div>
        )}
      </div>
    </Modal>
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
  unread?: boolean;
};

export function Comments({ api, sift, onCounts, reloadKey }: Props) {
  const load = useCallback(() => api.get<Comment[]>('feedback?kind=comment'), [api]);
  const [rows] = useFeed(load, reloadKey);

  const all = useMemo(() => rows ?? [], [rows]);

  useEffect(() => {
    if (!rows) return;
    onCounts({
      all: all.length,
      player: all.filter((r) => r.byRole === 'player').length,
      admin: all.filter((r) => r.byRole === 'admin').length,
      text: all.filter((r) => r.note).length,
      low: all.filter((r) => (r.stars ?? 5) <= 2).length,
      unread: all.filter((r) => r.unread).length,
    });
  }, [rows, all, onCounts]);

  /* التصفية قبل الخروج المبكّر: الخطّافات لا تُستدعى خلف شرط */
  const shown = useMemo(() => {
    const text = sift.search.trim();
    return all.filter((row) => {
      if (text && !(row.note ?? '').includes(text) && !(row.roomName ?? '').includes(text)) {
        return false;
      }
      if (sift.view === 'admin') return row.byRole === 'admin';
      if (sift.view === 'player') return row.byRole === 'player';
      if (sift.view === 'low') return (row.stars ?? 5) <= 2;
      if (sift.view === 'text') return Boolean(row.note);
      if (sift.view === 'unread') return Boolean(row.unread);
      return true;
    });
  }, [all, sift.search, sift.view]);

  const paged = usePaged(shown, 36);

  if (!rows) return <Loading />;

  const rated = all.filter((r) => r.stars);
  const average = rated.length
    ? rated.reduce((n, r) => n + (r.stars ?? 0), 0) / rated.length
    : null;
  const low = all.filter((r) => (r.stars ?? 5) <= 2).length;

  return (
    <div className="grid gap-4">
      <StatRow>
        <Stat
          lead
          label="التعليقات"
          value={all.length}
          unit={unit(all.length, 'comment')}
        />
        <Stat
          label="متوسط التقييم"
          value={average === null ? '—' : average.toFixed(1)}
          unit={average === null ? '' : 'من 5'}
          tone={average !== null && average >= 4 ? 'safe' : undefined}
        />
        <Stat
          label="تقييمٌ منخفض"
          value={low}
          tone={low > 0 ? 'warn' : undefined}
        />
        <Stat
          label="من اللاعبين"
          value={all.filter((r) => r.byRole === 'player').length}
        />
      </StatRow>

      {shown.length === 0 ? (
        <Panel>
          <Empty title="لا تعليقات تطابق" />
        </Panel>
      ) : (
        <div className="grid gap-3.5 [grid-template-columns:repeat(auto-fill,minmax(330px,1fr))]">
          {paged.slice.map((row) => (
            <article
              key={row.id}
              className={`tile relative flex flex-col p-4 ${
                row.unread ? 'shadow-[inset_0_0_0_1.5px_color-mix(in_srgb,var(--color-signal)_45%,transparent)]' : ''
              }`}
            >
              {/*
               * نقطةٌ في الزاوية العليا اليمنى: أولُ ما تقع عليه العين في
               * صفحةٍ عربية. ولا تُزاح البطاقةُ لها — تطفو فوق الحافّة.
               */}
              {row.unread && (
                <span
                  title="لم يُقرأ بعد"
                  className="absolute -top-1 right-3 size-2.5 rounded-full bg-signal shadow-[0_0_0_3px_var(--color-surface)]"
                  aria-label="لم يُقرأ بعد"
                />
              )}
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

      {paged.hidden > 0 && (
        <div className="tile">
          <MoreRows
            hidden={paged.hidden}
            onMore={paged.showMore}
            onAll={paged.showAll}
            kind="comment"
          />
        </div>
      )}
    </div>
  );
}
