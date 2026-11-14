// ホームのライブ欄で使う純粋ロジック（区間進行バー・Ranked 対戦カードの型）。
// クライアントとサーバーの両方から import される（DB・外部アクセスは持たない）。

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

// PaceMan のスプリットID / pacemanPaces.timeline の語彙 → 進行バー上の到達点（1始まり）。
// Second Portal は Blind の次の区間だが、バーの7点には無いため Blind 到達扱い（4）にする
const STAGE_BY_KEY: Record<string, number> = {
  "rsg.enter_nether": 1,
  "rsg.enter_bastion": 2,
  "rsg.enter_fortress": 3,
  "rsg.first_portal": 4,
  "rsg.second_portal": 4,
  "rsg.enter_stronghold": 5,
  "rsg.enter_end": 6,
  "rsg.credits": 7,
  "Enter Nether": 1,
  Bastion: 2,
  Fortress: 3,
  "First Portal": 4,
  "Second Portal": 4,
  "Enter Stronghold": 5,
  "Enter End": 6,
  Finish: 7,
};

/** スプリットID またはタイムライン名から、進行バー上の到達点（0=未対応・1..7）を返す */
export function splitStage(key: string): number {
  return STAGE_BY_KEY[key] ?? 0;
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
  opponent: { nickname: string; eloRate: number | null };
  /** 試合の経過時間（ミリ秒。取得時点） */
  currentTimeMs: number;
  /** Twitch の配信URL（Twitch 以外は null） */
  liveUrl: string | null;
}

/** Twitch の「Minecraft」カテゴリの game_id */
export const TWITCH_MINECRAFT_GAME_ID = "27471";

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
