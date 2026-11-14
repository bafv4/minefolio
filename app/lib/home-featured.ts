// ホームの「注目の走者」の純粋ロジック（候補の点数・選定・日替わりシード）。
// DB アクセスは home-featured.server.ts 側。クライアントとサーバーの両方から型を import する。

/** 注目の理由（1行目に出す文の元データ） */
export type FeaturedReason =
  | {
      type: "speedruncom";
      timeMs: number;
      /** speedrun_categories の表示名（カテゴリ未設定・不明なら null） */
      categoryName: string | null;
      /** new = 審査中 / verified = 承認済み（rejected は対象外） */
      status: "new" | "verified";
    }
  | { type: "rankedPb"; timeMs: number }
  | { type: "eloGain"; gain: number }
  | { type: "video" };

/** 主要9操作（WASD〈前進・後退・左・右〉・ジャンプ・スニーク・ダッシュ・インベントリ・オフハンド） */
export const FEATURED_KEY_ACTIONS = [
  "forward",
  "back",
  "left",
  "right",
  "jump",
  "sneak",
  "sprint",
  "inventory",
  "swapHands",
] as const;
export type FeaturedKeyAction = (typeof FEATURED_KEY_ACTIONS)[number];

/** 「キー配置が揃っている」とみなす主要操作の最小数 */
export const FEATURED_MIN_KEYS = 4;

/** ホットバー1〜9 */
export const FEATURED_HOTBAR_ACTIONS = [
  "hotbar1",
  "hotbar2",
  "hotbar3",
  "hotbar4",
  "hotbar5",
  "hotbar6",
  "hotbar7",
  "hotbar8",
  "hotbar9",
] as const;
export type FeaturedHotbarAction = (typeof FEATURED_HOTBAR_ACTIONS)[number];

export interface FeaturedKey {
  action: FeaturedKeyAction | FeaturedHotbarAction;
  /** 実際に押すキー（リマップされていれば物理キー）。リマップの有無は表示しない */
  keyCode: string;
}

export interface FeaturedRunner {
  slug: string;
  mcid: string | null;
  uuid: string | null;
  displayName: string | null;
  displayNameAlphabet: string | null;
  customSkinUrl: string | null;
  mainCategory: string | null;
  /** メインカテゴリの PB（ミリ秒） */
  pbMs: number | null;
  sensitivityPercent: number | null;
  /** 振り向き距離（cm/180°） */
  cm180: number | null;
  /** 主要操作のキー（配置が無い人は空配列） */
  keys: FeaturedKey[];
  /** ホットバー1〜9のキー（割り当てのあるスロットだけ。無い人は空配列） */
  hotbar: FeaturedKey[];
  /** 注目の理由（日替わり・ランダムの人は null） */
  reason: FeaturedReason | null;
}

export interface FeaturedEvent {
  userId: string;
  reason: FeaturedReason;
  /** 出来事の時刻（ms）。同点の並べ替えに使う */
  at: number;
}

export const FEATURED_MAX_CANDIDATES = 5;

/**
 * 出来事の点数（高いほど優先）。
 * speedrun.com の新規申請 90 > Ranked の PB 更新 80 > 新しい動画 60。
 * Ranked のレート上昇は 40 + 上昇幅/5（上昇幅 300 で頭打ち、最大 100）なので大きな上昇は申請より上に来る。
 */
export function scoreFeaturedReason(reason: FeaturedReason): number {
  switch (reason.type) {
    case "speedruncom":
      return 90;
    case "rankedPb":
      return 80;
    case "eloGain":
      return 40 + Math.min(Math.max(reason.gain, 0), 300) / 5;
    case "video":
      return 60;
  }
}

/** 1人につき最も点数の高い出来事を理由に採用し、点数順（同点は新しい順）で最大 limit 人返す */
export function pickFeaturedCandidates(
  events: FeaturedEvent[],
  limit = FEATURED_MAX_CANDIDATES,
): { userId: string; reason: FeaturedReason }[] {
  const best = new Map<string, FeaturedEvent & { score: number }>();
  for (const ev of events) {
    const score = scoreFeaturedReason(ev.reason);
    const cur = best.get(ev.userId);
    if (!cur || score > cur.score || (score === cur.score && ev.at > cur.at)) {
      best.set(ev.userId, { ...ev, score });
    }
  }
  return [...best.values()]
    .sort((a, b) => b.score - a.score || b.at - a.at)
    .slice(0, limit)
    .map(({ userId, reason }) => ({ userId, reason }));
}

/** 日付（YYYY-MM-DD）をシードに、n 人の中から決定的に1つ選ぶ添字を返す（n=0 は -1） */
export function dailyPickIndex(dateKey: string, n: number): number {
  if (n <= 0) return -1;
  let h = 2166136261;
  for (let i = 0; i < dateKey.length; i++) {
    h ^= dateKey.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % n;
}
