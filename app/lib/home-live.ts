// ホームのライブ欄で使う純粋ロジック（区間進行バー・Ranked 対戦カードの型）。
// クライアントとサーバーの両方から import される（DB・外部アクセスは持たない）。

import { getSplitTimeline } from "./pace-splits";
import { getLatestSplit, type PaceManLiveRun } from "./paceman";
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

/** ライブ欄の項目のうち、区間を引くのに必要な部分（LiveRailEntry の部分集合） */
export type LiveSplitEntry =
  | { kind: "pace"; run: PaceManLiveRun }
  | { kind: "ranked"; match: Pick<RankedLiveMatch, "progress"> }
  | { kind: "twitch" };

/** ライブ項目の現在区間（PaceManSplitMark の timeline 名）。ペースは最新スプリット、Ranked は最新到達区間。区間の無い項目・対応外は null */
export function liveEntrySplit(entry: LiveSplitEntry): { split: string; stage: number } | null {
  let split: string | null = null;
  if (entry.kind === "pace") {
    const latest = getLatestSplit(entry.run);
    split = latest ? getSplitTimeline(latest.eventId) : null;
  } else if (entry.kind === "ranked") {
    split = entry.match.progress?.split ?? null;
  }
  if (!split) return null;
  const stage = splitStage(split);
  return stage > 0 ? { split, stage } : null;
}

/** 進行バーの各段（1..7）にいる人数。区間の無い項目は数えない */
export function countLiveStages(entries: LiveSplitEntry[]): number[] {
  const counts = LIVE_STAGES.map(() => 0);
  for (const e of entries) {
    const s = liveEntrySplit(e);
    if (s) counts[s.stage - 1] += 1;
  }
  return counts;
}

/** 段（1..7）に対応する区間マーク名（PaceManSplitMark の timeline） */
export const LIVE_STAGE_SPLIT_MARKS = [
  "Enter Nether",
  "Bastion",
  "Fortress",
  "First Portal",
  "Enter Stronghold",
  "Enter End",
  "Finish",
] as const;

// ============================================================
// 並び順（PaceMan 本家に倣う: 区間が深い順 → 同じ深さなら到達タイムが速い順）
// ============================================================

/** 並べ替えに必要な項目（LiveRailEntry の部分集合） */
export type LiveSortEntry =
  | { kind: "pace"; run: PaceManLiveRun }
  | { kind: "ranked"; match: Pick<RankedLiveMatch, "progress" | "currentTimeMs"> }
  | { kind: "twitch" };

/** 並べ替えに使う（深さ, タイム）。区間が分からない項目は null */
export function liveSortKey(entry: LiveSortEntry): { depth: number; timeMs: number } | null {
  if (entry.kind === "pace") {
    const latest = getLatestSplit(entry.run);
    if (!latest) return null;
    const timeline = getSplitTimeline(latest.eventId);
    let depth = splitStage(timeline);
    if (depth === 0) return null;
    // 構造物は到達順で数える（本家と同じ）: 1つ目=2、2つ目=3。Bastion / Fortress のどちらが先かは問わない
    if (timeline === "Bastion" || timeline === "Fortress") {
      const reached = entry.run.eventList.filter(
        (e) => e.eventId === "rsg.enter_bastion" || e.eventId === "rsg.enter_fortress",
      ).length;
      depth = 1 + Math.max(1, Math.min(2, reached));
    }
    return { depth, timeMs: latest.igt };
  }
  if (entry.kind === "ranked") {
    const p = entry.match.progress;
    if (!p) return null;
    const depth = splitStage(p.split);
    return depth > 0 ? { depth, timeMs: p.timeMs } : null;
  }
  return null;
}

/**
 * ライブ欄の比較関数。区間のある項目（PaceMan・Ranked 混在）を深い順→タイムが速い順、
 * 次に区間の無い PaceMan・Ranked（Ranked は経過時間の長い順）、最後に Twitch のみ。同点は 0（安定ソートで入力順を保つ）
 */
export function compareLiveEntries(a: LiveSortEntry, b: LiveSortEntry): number {
  const tier = (e: LiveSortEntry, k: ReturnType<typeof liveSortKey>) => (k ? 0 : e.kind === "twitch" ? 2 : 1);
  const ka = liveSortKey(a);
  const kb = liveSortKey(b);
  const ta = tier(a, ka);
  const tb = tier(b, kb);
  if (ta !== tb) return ta - tb;
  if (ka && kb) return kb.depth - ka.depth || ka.timeMs - kb.timeMs;
  if (ta === 1) {
    const ea = a.kind === "ranked" ? a.match.currentTimeMs : 0;
    const eb = b.kind === "ranked" ? b.match.currentTimeMs : 0;
    return eb - ea;
  }
  return 0;
}

// ============================================================
// 消えたカードを「終了」として少しの間残す
// ============================================================

/** ライブ欄の自動更新間隔 */
export const LIVE_POLL_INTERVAL_MS = 15_000;
/** 終了カードを残す時間 */
export const LIVE_ENDED_HOLD_MS = 120_000;
/**
 * 前回の成功取得からこれより空いたら差分を取らない（何が起きたか分からないので「終了」と出さず黙って消す）。
 * 2 ポーリング間隔に余裕を足して、1回だけ失敗した直後（空き ≒ 30秒±通信時間）でも差分を取れるようにする
 */
export const LIVE_DIFF_MAX_GAP_MS = 2 * LIVE_POLL_INTERVAL_MS + 5_000;

/** UUID をハイフン無し・小文字に正規化する（users.uuid は両形式が混在するため両側で揃える） */
export function normalizeUuid(uuid: string): string {
  return uuid.replace(/-/g, "").toLowerCase();
}

/** Ranked の結果（登録走者から見た勝敗） */
export interface RankedLiveResult {
  outcome: "win" | "lose" | "draw";
  forfeited: boolean;
  /** 登録走者が勝ったときの完走タイム（ミリ秒）。それ以外は null */
  timeMs: number | null;
  /** 登録走者のレート増減。不明は null */
  eloChange: number | null;
}

/** /api/home-feed?type=ranked-result の応答 */
export type RankedResultResponse = { status: "pending" } | ({ status: "done" } & RankedLiveResult);

/** 結果の採用を許す、試合開始推定からの手前側の余裕 */
export const RANKED_RESULT_SINCE_SLACK_MS = 60_000;

/**
 * MCSR Ranked の試合1件（/users/{uuid}/matches の要素）を、登録走者から見た結果にする。
 * players に両者の uuid が無い・終了時刻（date, 秒）が試合開始推定より前（再戦で前の試合を拾う）は null（未確定）
 */
export function judgeRankedResult(
  match: unknown,
  args: { uuid: string; opponent: string; sinceMs: number },
): RankedLiveResult | null {
  if (!match || typeof match !== "object") return null;
  const m = match as {
    date?: unknown;
    forfeited?: unknown;
    result?: { uuid?: unknown; time?: unknown } | null;
    changes?: { uuid?: unknown; change?: unknown }[] | null;
    players?: { uuid?: unknown }[] | null;
  };
  const me = normalizeUuid(args.uuid);
  const opp = normalizeUuid(args.opponent);
  const players = Array.isArray(m.players)
    ? m.players.map((p) => (typeof p?.uuid === "string" ? normalizeUuid(p.uuid) : ""))
    : [];
  if (!players.includes(me) || !players.includes(opp)) return null;
  if (typeof m.date !== "number" || !Number.isFinite(m.date)) return null;
  if (m.date * 1000 < args.sinceMs - RANKED_RESULT_SINCE_SLACK_MS) return null;

  const winner = typeof m.result?.uuid === "string" ? normalizeUuid(m.result.uuid) : null;
  const outcome = winner === null ? "draw" : winner === me ? "win" : "lose";
  const time = m.result?.time;
  const change = Array.isArray(m.changes)
    ? m.changes.find((c) => typeof c?.uuid === "string" && normalizeUuid(c.uuid) === me)?.change
    : undefined;
  return {
    outcome,
    forfeited: m.forfeited === true,
    timeMs: outcome === "win" && typeof time === "number" && Number.isFinite(time) ? time : null,
    eloChange: typeof change === "number" && Number.isFinite(change) ? change : null,
  };
}

/** Ranked 対戦カードの相手 uuid（key は両者の正規化 uuid を "-" で連結したもの）。取れなければ null */
export function rankedOpponentUuid(match: Pick<RankedLiveMatch, "key" | "uuid">): string | null {
  const me = normalizeUuid(match.uuid);
  return match.key.split("-").find((u) => u && u !== me) ?? null;
}

/**
 * PaceMan のランのいまの経過時間（RTA、ミリ秒）。ライブ API にラン開始時刻は無いが、`lastUpdated` は
 * 最後のイベント（eventList / contextEventList のどちらか）の時刻なので、最大の rta にそこからの経過を足す。
 * 時計のずれで負にならないよう、足す分は 0 以上にする。イベントが無ければ null
 */
export function paceElapsedRtaMs(
  run: Pick<PaceManLiveRun, "eventList" | "contextEventList" | "lastUpdated">,
  now: number,
): number | null {
  const events = [...run.eventList, ...(run.contextEventList ?? [])];
  if (events.length === 0) return null;
  const lastRta = Math.max(...events.map((e) => e.rta));
  return lastRta + Math.max(0, now - run.lastUpdated);
}

/**
 * live-runs 応答の splitBests で「2つ目の構造物」のベストを入れるキー。蓄積ペース（paceman_paces）は構造物を
 * 種類（Bastion / Fortress）でしか持たないため、同じランで両方に着いたものの遅い方を2つ目として集計する。
 * 2つ目の構造物にいるランは区間名（Bastion / Fortress）ではなくこちらと比べる（1つ目の速い記録と比べない）
 */
export const SECOND_STRUCTURE_BEST_KEY = "Second Structure";

/** ライブランの最新区間に対応する splitBests のキー（2つ目の構造物は SECOND_STRUCTURE_BEST_KEY） */
export function paceBestKey(run: PaceManLiveRun, timeline: string): string {
  return (timeline === "Bastion" || timeline === "Fortress") && (liveSortKey({ kind: "pace", run })?.depth ?? 0) >= 3
    ? SECOND_STRUCTURE_BEST_KEY
    : timeline;
}

/**
 * ベスト比を出す区間か。2つ目の構造物（Second Structure）以降だけ（並び順と同じく構造物は到達順で数える）。
 * ネザーイン・1つ目の構造物は差が運（シード）に大きく左右され、比較の意味が薄いため
 */
export function showsPaceBestDiff(run: PaceManLiveRun): boolean {
  return (liveSortKey({ kind: "pace", run })?.depth ?? 0) >= 3;
}

/** 完走済みのラン（rsg.credits がある。一覧に数分残る間もカードは「完走」表示にする） */
export function isFinishedRun(run: Pick<PaceManLiveRun, "eventList">): boolean {
  return run.eventList.some((e) => e.eventId === "rsg.credits");
}

/** 一覧から消えて「終了」として残している項目 */
export type LiveEndedItem =
  | { kind: "pace"; id: string; run: PaceManLiveRun; endedAt: number; index: number }
  | {
      kind: "ranked";
      id: string;
      match: RankedLiveMatch;
      endedAt: number;
      index: number;
      /** 試合開始の推定（ms。取得時刻 − 経過時間） */
      startedAtMs: number;
      /** 結果。取得前は null */
      result: RankedLiveResult | null;
    };

export interface LiveEndedState {
  /** 直前に成功した PaceMan 取得（at は受信時刻 ms） */
  runs: { at: number; list: PaceManLiveRun[] } | null;
  /** 直前に成功した Ranked 取得（at は受信時刻、fetchedAt はサーバーの取得時刻） */
  matches: { at: number; fetchedAt: number; list: RankedLiveMatch[] } | null;
  ended: LiveEndedItem[];
}

export const initialLiveEndedState: LiveEndedState = { runs: null, matches: null, ended: [] };

export const livePaceId = (run: Pick<PaceManLiveRun, "worldId">) => `pace:${run.worldId}`;
export const liveRankedId = (match: Pick<RankedLiveMatch, "key">) => `ranked:${match.key}`;

/** 期限切れの終了項目を除く */
export function pruneLiveEnded(state: LiveEndedState, now: number): LiveEndedState {
  const ended = state.ended.filter((i) => now - i.endedAt < LIVE_ENDED_HOLD_MS);
  return ended.length === state.ended.length ? state : { ...state, ended };
}

/**
 * 成功したポーリングを取り込み、前回あって今回無い項目を「終了」として加える（純関数）。
 * 差分を取らない: 初回／前回成功から LIVE_DIFF_MAX_GAP_MS を超えて空いた／matches が null（Ranked 取得失敗）の Ranked 側。
 * 完走済み（credits 付き）の PaceMan は保持しない。復活した id と、同じ人（mcid）の新しいライブが出た終了項目は捨てる。
 * 失敗したポーリングはこの関数を呼ばない（呼ばなければ前回のスナップショットが残り、空きは次回の gap 判定で扱われる）
 */
export function advanceLiveEnded(
  state: LiveEndedState,
  input: { now: number; runs: PaceManLiveRun[]; matches: { list: RankedLiveMatch[]; fetchedAt: number } | null },
): LiveEndedState {
  const { now, runs, matches } = input;
  const fresh = (at: number | undefined) => at !== undefined && now - at <= LIVE_DIFF_MAX_GAP_MS;

  // 前回の並び（終了カードを直前の位置に残すための index 用）
  const prevOrder: LiveSortEntry[] = [
    ...(state.runs?.list ?? []).map((run) => ({ kind: "pace" as const, run })),
    ...(state.matches?.list ?? []).map((match) => ({ kind: "ranked" as const, match })),
  ].sort(compareLiveEntries);

  const added: LiveEndedItem[] = [];
  if (state.runs && fresh(state.runs.at)) {
    const current = new Set(runs.map((r) => r.worldId));
    for (const run of state.runs.list) {
      if (current.has(run.worldId) || isFinishedRun(run)) continue;
      const index = prevOrder.findIndex((e) => e.kind === "pace" && e.run === run);
      added.push({ kind: "pace", id: livePaceId(run), run, endedAt: now, index });
    }
  }
  if (matches && state.matches && fresh(state.matches.at)) {
    const current = new Set(matches.list.map((m) => m.key));
    for (const match of state.matches.list) {
      if (current.has(match.key)) continue;
      const index = prevOrder.findIndex((e) => e.kind === "ranked" && e.match === match);
      added.push({
        kind: "ranked",
        id: liveRankedId(match),
        match,
        endedAt: now,
        index,
        startedAtMs: state.matches.fetchedAt - match.currentTimeMs,
        result: null,
      });
    }
  }

  // 現在ライブの id / 人（mcid）。Ranked 取得失敗時は直前に見えていた Ranked を使う
  const liveMatches = matches ? matches.list : (state.matches?.list ?? []);
  const liveIds = new Set([...runs.map(livePaceId), ...liveMatches.map(liveRankedId)]);
  const liveMcids = new Set([
    ...runs.map((r) => r.nickname.toLowerCase()),
    ...liveMatches.map((m) => m.mcid.toLowerCase()),
  ]);
  const personOf = (i: LiveEndedItem) => (i.kind === "pace" ? i.run.nickname : i.match.mcid).toLowerCase();

  const ended = [...state.ended.filter((i) => now - i.endedAt < LIVE_ENDED_HOLD_MS), ...added].filter(
    (i) => !liveIds.has(i.id) && !liveMcids.has(personOf(i)),
  );
  return {
    runs: { at: now, list: runs },
    matches: matches ? { at: now, fetchedAt: matches.fetchedAt, list: matches.list } : state.matches,
    ended,
  };
}

/** 結果を終了項目へ反映する（id と endedAt の両方が一致するものだけ。再戦の別カードに載せない） */
export function applyRankedResult(
  state: LiveEndedState,
  id: string,
  endedAt: number,
  result: RankedLiveResult,
): LiveEndedState {
  let changed = false;
  const ended = state.ended.map((i) => {
    if (i.kind !== "ranked" || i.id !== id || i.endedAt !== endedAt || i.result) return i;
    changed = true;
    return { ...i, result };
  });
  return changed ? { ...state, ended } : state;
}

/** live（並べ替え済み）に、終了項目を直前の位置（index。範囲外は末尾）へ差し込む */
export function insertEndedAtPrevIndex<T>(live: T[], ended: { item: T; index: number }[]): T[] {
  const out = [...live];
  const pos = (i: number) => (i < 0 ? Number.POSITIVE_INFINITY : i);
  for (const e of [...ended].sort((a, b) => pos(a.index) - pos(b.index))) {
    out.splice(Math.min(pos(e.index), out.length), 0, e.item);
  }
  return out;
}
