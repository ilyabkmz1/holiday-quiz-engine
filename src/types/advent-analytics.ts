import type { AdventPhase } from "@/domain/advent";

/** Доля с основанием: прочерк в интерфейсе, пока основание нулевое. */
export type Rate = { count: number; base: number; share: number | null };

export type AnalyticsDay = {
  day: number;
  title: string;
  /** Локальная дата окна, `YYYY-MM-DD`. */
  date: string;
  /** `future` — окно ещё не открылось; `running` — идёт сейчас (пропуски предварительные); `closed` — окно закрыто. */
  status: "future" | "running" | "closed";
  /** Открыли в свой день, догнали позже, всего открыли. */
  onTime: number;
  caughtUp: number;
  opened: number;
  /** Активные на конец окна и пропустили из них (`null` у будущих окон). */
  active: number;
  missed: number | null;
  /** Закрыли день целиком (все блоки). */
  completed: number;
  /** Доля открывших в свой день среди активных; `null`, пока активных нет. */
  onTimeShare: number | null;
};

export type AnalyticsBucket = { value: number; count: number };

export type AnalyticsCohortCell = { offset: number; count: number | null; share: number | null };
export type AnalyticsCohort = {
  date: string;
  /** Размер когорты скрыт, если она меньше порога малых групп. */
  size: number | null;
  hidden: boolean;
  cells: AnalyticsCohortCell[];
};

export type AnalyticsReward = {
  rewardId: string;
  label: string;
  kind: "promo" | "gift" | "points" | "finalEntry";
  issued: number;
  redeemed: number;
  expired: number;
  /** Награду можно погасить (`redeem` не `none`): только для таких считается доля погашения. */
  redeemable: boolean;
  redeemShare: number | null;
  stockLeft: number | null;
  stockTotal: number | null;
  codesFree: number | null;
  codesTotal: number | null;
};

export type AnalyticsRewardGroup = { key: string; label: string; issued: number; redeemed: number; expired: number; redeemShare: number | null };

export type AnalyticsTeam = {
  id: string;
  title: string;
  /** Состав скрыт (меньше порога): цифр нет. */
  hidden: boolean;
  members: number | null;
  players: number | null;
  avgDoors: number | null;
  activeShare: number | null;
  points: number | null;
  avgPoints: number | null;
  rank: number | null;
};

export type AnalyticsFunnelStep = { key: string; label: string; count: number; share: number | null };

export type AnalyticsReminders = {
  channel: "email" | "off";
  subscribed: number;
  unsubscribed: number;
  sent: number;
  failed: number;
  clicked: number;
  openedAfter: number;
};

export type AnalyticsInsight = { key: string; tone: "good" | "watch" | "info"; text: string };

export type AdventAnalytics = {
  generatedAt: string;
  timezone: string;
  phase: AdventPhase;
  today: number | null;
  totalDays: number;
  /** Порог малых групп, ниже которого когорты и команды не детализируются. */
  minGroup: number;
  kpis: {
    participants: number;
    players: number;
    activeToday: number;
    d1: Rate;
    d7: Rate;
    doorsAvg: number | null;
    redeemed: number;
    subscribers: number;
  };
  days: AnalyticsDay[];
  doors: { avg: number | null; median: number | null; zero: number; buckets: AnalyticsBucket[] };
  streaks: { avg: number | null; median: number | null; buckets: AnalyticsBucket[] };
  goals: Array<{ opened: number; rewardId: string; label: string; reached: number; share: number | null }>;
  registration: AnalyticsFunnelStep[];
  rewards: AnalyticsReward[];
  rewardsBySource: AnalyticsRewardGroup[];
  rewardsByKind: AnalyticsRewardGroup[];
  cohorts: { offsets: number[]; rows: AnalyticsCohort[] };
  reminders: AnalyticsReminders | null;
  teams: AnalyticsTeam[] | null;
  bestDays: AnalyticsDay[];
  weakDays: AnalyticsDay[];
  insights: AnalyticsInsight[];
};

/** Публичный рейтинг команд: без имён людей; у малых команд цифр нет. */
export type TeamLeaderboard = {
  generatedAt: string;
  teams: Array<{ id: string; title: string; rank: number | null; hidden: boolean; members: number | null; avgDoors: number | null; activeShare: number | null }>;
  /** Команда участника, если он её выбрал. */
  mine: string | null;
};
