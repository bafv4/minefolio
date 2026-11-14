// ホームのライブ欄で使う純粋ロジック（区間進行バー・Ranked 対戦カードの型）。
// クライアントとサーバーの両方から import される（DB・外部アクセスは持たない）。

import { getSplitTimeline } from "./pace-splits";
import type { TwitchStream } from "./twitch";

/** 進行バーの7点（Nether → Bastion → Fortress → Blind → Stronghold → End → Finish） */
export const LIVE_STAGES = [
  "Nether",
  "Bastion",
  "Fortress",
  "Blind",
  "Stronghold",
  "End",
  "Finish",
] as const;

// pacemanPaces.timeline（PaceMan の正準タイムライン名）→ 進行バー上の到達点（1始まり）。
// Second Portal は Blind の次の区間だが、バーの7点には無いため Blind 到達扱い（4）にする。
// Obtain Blaze Rods は Fortress 内の区間なので Fortress と同じ段階（3）
const STAGE_BY_TIMELINE: Record<string, number> = {
  "Enter Nether": 1,
  Bastion: 2,
  Fortress: 3,
  "Obtain Blaze Rods": 3,
  "First Portal": 4,
  "Second Portal": 4,
  "Enter Stronghold": 5,
  "Enter End": 6,
  Finish: 7,
};

/**
 * スプリットID（rsg.*）またはタイムライン名から、進行バー上の到達点（0=未対応・1..7）を返す。
 * スプリットID は getSplitTimeline でタイムライン名へ変換してから引く（タイムライン名はそのまま通る）
 */
export function splitStage(key: string): number {
  return STAGE_BY_TIMELINE[getSplitTimeline(key)] ?? 0;
}

// MCSR Ranked ライブ API（GET /live）の timeline.type → 区間マーク名（PaceMan の timeline 語彙）。
// 進行バー上の到達点は区間名から splitStage で導く。
// Blind（projectelo.timeline.blind_travel）は PaceMan の First Portal に相当
const RANKED_TIMELINE_SPLIT: Record<string, string> = {
  "story.enter_the_nether": "Enter Nether",
  "nether.find_bastion": "Bastion",
  "nether.find_fortress": "Fortress",
  "projectelo.timeline.blind_travel": "First Portal",
  "story.follow_ender_eye": "Enter Stronghold",
  "story.enter_the_end": "Enter End",
};

/** Ranked の timeline.type から進行バー上の到達点（0=未対応/timeline 無し・1..6）を返す */
export function rankedStage(type: string | null | undefined): number {
  const split = rankedSplitName(type);
  return split ? splitStage(split) : 0;
}

/** Ranked の timeline.type から PaceManSplitMark に渡す区間名。未対応は null */
export function rankedSplitName(type: string | null | undefined): string | null {
  return (type && RANKED_TIMELINE_SPLIT[type]) || null;
}

/** Ranked 対戦中の選手の最新到達区間（最新1イベントのみ。途中経過は API に無い） */
export interface RankedLiveProgress {
  /** 進行バー上の到達点（1..6） */
  stage: number;
  /** 区間マーク名（PaceManSplitMark の timeline） */
  split: string;
  /** 区間への到達時刻（試合開始からのミリ秒） */
  timeMs: number;
}

/** Ranked 対戦中カード（/api/home-feed?type=ranked-live の1件） */
export interface RankedLiveMatch {
  /** 試合の一意キー（Minefolio 登録者の uuid 群） */
  key: string;
  mcid: string;
  slug: string;
  uuid: string;
  displayName: string | null;
  displayNameAlphabet: string | null;
  skinUrl: string | null;
  eloRate: number | null;
  opponent: { nickname: string; eloRate: number | null; progress: RankedLiveProgress | null };
  /** 登録走者の最新到達区間（timeline 無し・未知の type は null） */
  progress: RankedLiveProgress | null;
  /** 試合の経過時間（ミリ秒。取得時点） */
  currentTimeMs: number;
  /** Twitch の配信URL（Twitch 以外は null） */
  liveUrl: string | null;
}

/** Twitch の「Minecraft」カテゴリの game_id */
export const TWITCH_MINECRAFT_GAME_ID = "27471";

/** ホームの Twitch 配信1件（/api/home-feed?type=twitch-streams の応答要素。配信情報＋紐付く Minefolio 走者） */
export interface HomeTwitchStream {
  stream: Pick<
    TwitchStream,
    "id" | "user_login" | "user_name" | "title" | "viewer_count" | "game_id" | "game_name" | "started_at"
  >;
  mcid: string | null;
  uuid: string | null;
  slug: string;
  displayName: string | null;
  /** アルファベット表記の表示名。ロケール解決（pickDisplayName）は表示側で行う */
  displayNameAlphabet: string | null;
  discordAvatar: string | null;
  customSkinUrl: string | null;
}

/** Twitch チャンネルの URL（login は大文字小文字どちらでも可） */
export function twitchChannelUrl(login: string): string {
  return `https://www.twitch.tv/${encodeURIComponent(login)}`;
}

/** ライブ欄に Twitch カードとして出せる配信（HomeTwitchStream の必要部分） */
export interface TwitchLiveCandidate {
  stream: { user_login: string; game_id?: string; game_name?: string };
  slug: string;
}

/** Minecraft カテゴリの配信か（game_id か game_name のどちらかが一致すればよい） */
export function isMinecraftStream(stream: { game_id?: string; game_name?: string }): boolean {
  return stream.game_id === TWITCH_MINECRAFT_GAME_ID || stream.game_name === "Minecraft";
}

/** Twitch 配信URLからチャンネルのログイン名（小文字）を取り出す。Twitch 以外・不正は null */
export function twitchLoginFromUrl(raw: string | null | undefined): string | null {
  const safe = sanitizeTwitchUrl(raw);
  if (!safe) return null;
  const login = new URL(safe).pathname.split("/").filter(Boolean)[0];
  return login ? login.toLowerCase() : null;
}

/**
 * ライブ欄の Twitch カード対象を選ぶ。Minecraft カテゴリの配信に絞り、
 * PaceMan のライブラン・Ranked 対戦中として既に出ている人（slug または Twitch ログイン名が一致）は除く。
 * takenSlugs / takenLogins は優先側（PaceMan・Ranked）の slug・ログイン名。入力の並びは保つ
 */
export function pickTwitchOnlyStreams<T extends TwitchLiveCandidate>(
  streams: T[],
  taken: { slugs: Iterable<string | null | undefined>; logins: Iterable<string | null | undefined> },
): T[] {
  const slugs = new Set<string>();
  for (const s of taken.slugs) if (s) slugs.add(s);
  const logins = new Set<string>();
  for (const l of taken.logins) if (l) logins.add(l.toLowerCase());
  return streams.filter(
    (s) =>
      isMinecraftStream(s.stream) &&
      !(s.slug && slugs.has(s.slug)) &&
      !logins.has(s.stream.user_login.toLowerCase()),
  );
}

/** 検証済みの Twitch 配信URLだけを通す（それ以外は null） */
export function sanitizeTwitchUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    const host = u.hostname.toLowerCase();
    if (host === "twitch.tv" || host === "www.twitch.tv") return `https://www.twitch.tv${u.pathname}`;
    return null;
  } catch {
    return null;
  }
}
