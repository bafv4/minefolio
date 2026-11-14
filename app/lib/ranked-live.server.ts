// MCSR Ranked の公開ライブ試合（GET /live）のうち、Minefolio 登録者が出ている試合を取得する。
// 応答: { status, data: { players, liveMatches: [{ currentTime(ms), players[{uuid(ハイフン無し), nickname, eloRate}],
//   data: { [uuid]: { liveUrl, timeline } } }] } }（公式 openapi.yaml の PublicLiveData）。
// レート制限は 500 回 / 10 分。呼び出し側（/api/home-feed）が30秒キャッシュするため十分に収まる。

import { and, isNotNull } from "drizzle-orm";
import type { Database } from "./db";
import { users } from "./schema";
import { listedRunnerCondition, rankedStatsVisibleCondition } from "./users-filter";
import { getCached, setCached } from "./cache";
import { getHomeHiddenUsers } from "./home-visibility.server";
import {
  rankedSplitName,
  rankedStage,
  sanitizeTwitchUrl,
  type RankedLiveMatch,
  type RankedLiveProgress,
} from "./home-live";

const RANKED_LIVE_URL = "https://mcsrranked.com/api/live";

// 登録者の一覧は60秒キャッシュ（ライブ応答は30秒キャッシュ。毎回の全公開ユーザー走査を避ける）。
// 設定変更が反映されるまでの最悪値に +60 秒が加わる
const REGISTERED_TTL = 60 * 1000;
/** キャッシュキー。形状を変えたら版数を上げる（テストからも参照する） */
export const RANKED_REGISTERED_CACHE_KEY = "home:ranked-registered:v1";

interface RankedLivePlayer {
  uuid: string;
  nickname: string;
  eloRate: number | null;
}
/** 選手1人分のライブ情報（配信URL・最新 timeline） */
interface RankedLivePlayerEntry {
  liveUrl?: string | null;
  timeline?: { time?: number; type?: string } | null;
}
type RankedLiveEntry = Record<string, RankedLivePlayerEntry | undefined>;
interface RankedLiveResponse {
  status?: string;
  data?: {
    liveMatches?: {
      currentTime?: number;
      players?: RankedLivePlayer[];
      data?: RankedLiveEntry;
    }[];
  };
}

/** Minefolio 登録者（照合結果としてカードに載せる項目） */
export type RegisteredRunner = Pick<
  RankedLiveMatch,
  "mcid" | "slug" | "uuid" | "displayName" | "displayNameAlphabet" | "skinUrl"
>;

/** 選手の最新 timeline を進行バー用に変換する。timeline 無し・未知の type・不正な time は null */
function toProgress(entry: RankedLivePlayerEntry | undefined): RankedLiveProgress | null {
  const tl = entry?.timeline;
  if (!tl || typeof tl.time !== "number" || !Number.isFinite(tl.time)) return null;
  const stage = rankedStage(tl.type);
  const split = rankedSplitName(tl.type);
  if (!stage || !split) return null;
  return { stage, split, timeMs: tl.time };
}

function findEntry(data: RankedLiveEntry | undefined, uuid: string) {
  return data?.[uuid] ?? data?.[normalizeUuid(uuid)];
}

/** UUID をハイフン無し・小文字に正規化する（users.uuid は両形式が混在するため両側で揃える） */
export function normalizeUuid(uuid: string): string {
  return uuid.replace(/-/g, "").toLowerCase();
}

/** Ranked の応答から、登録者が出ている試合を1試合1カードに変換する（純粋関数。テスト対象） */
export function buildRankedLiveMatches(
  response: RankedLiveResponse | null,
  registered: Map<string, RegisteredRunner>,
): RankedLiveMatch[] {
  const matches = response?.data?.liveMatches;
  if (!Array.isArray(matches)) return [];
  const result: RankedLiveMatch[] = [];
  for (const m of matches) {
    const players = Array.isArray(m.players) ? m.players : [];
    const featured = players.find((p) => registered.has(normalizeUuid(p.uuid)));
    if (!featured) continue;
    const me = registered.get(normalizeUuid(featured.uuid))!;
    const opponent = players.find((p) => p !== featured);
    const dataEntry = findEntry(m.data, featured.uuid);
    result.push({
      key: players.map((p) => normalizeUuid(p.uuid)).join("-"),
      ...me,
      eloRate: featured.eloRate ?? null,
      opponent: {
        nickname: opponent?.nickname ?? "",
        eloRate: opponent?.eloRate ?? null,
        progress: opponent ? toProgress(findEntry(m.data, opponent.uuid)) : null,
      },
      progress: toProgress(dataEntry),
      currentTimeMs: typeof m.currentTime === "number" ? m.currentTime : 0,
      liveUrl: sanitizeTwitchUrl(dataEntry?.liveUrl),
    });
  }
  return result;
}

/** Ranked 統計を公開している登録者（公開プロフィール・視聴者除外・uuid あり）を normalizedUuid で引ける形にする */
async function getRegisteredByUuid(db: Database): Promise<Map<string, RegisteredRunner>> {
  // キャッシュするのは Map の元になる配列（JSON 化できる形）
  let runners = await getCached<(RegisteredRunner & { key: string })[]>(RANKED_REGISTERED_CACHE_KEY);
  if (!runners) {
    const rows = await db
      .select({
        mcid: users.mcid,
        uuid: users.uuid,
        slug: users.slug,
        displayName: users.displayName,
        displayNameAlphabet: users.displayNameAlphabet,
        customSkinUrl: users.customSkinUrl,
      })
      .from(users)
      .where(
        and(
          isNotNull(users.uuid),
          isNotNull(users.mcid),
          listedRunnerCondition,
          // Ranked 統計を非公開にした人（docs/rankings-stats.md）は対戦中カードにも出さない
          rankedStatsVisibleCondition,
        ),
      );
    runners = rows.map((r) => ({
      key: normalizeUuid(r.uuid!),
      mcid: r.mcid!,
      slug: r.slug,
      uuid: r.uuid!,
      displayName: r.displayName,
      displayNameAlphabet: r.displayNameAlphabet,
      skinUrl: r.customSkinUrl,
    }));
    await setCached(RANKED_REGISTERED_CACHE_KEY, runners, REGISTERED_TTL);
  }
  return new Map(
    runners.map(({ key, ...runner }) => [key, runner]),
  );
}

/** Minefolio 登録者が出ている Ranked のライブ試合一覧。外部取得に失敗したら空配列（ホーム全体は落とさない） */
export async function fetchRankedLiveMatches(db: Database): Promise<RankedLiveMatch[]> {
  try {
    const res = await fetch(RANKED_LIVE_URL, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [];
    const json = (await res.json()) as RankedLiveResponse;
    if (json.status !== "success") return [];
    // 登録者の照合は応答に試合があるときだけ（0試合なら DB を引かない）
    if (!json.data?.liveMatches?.length) return [];
    const matches = buildRankedLiveMatches(json, await getRegisteredByUuid(db));
    if (matches.length === 0) return matches;
    // 「ホーム画面にTwitch配信を表示」をオフにした人は配信リンク（Twitch で見る・配信中の印の元）を消す
    const hidden = await getHomeHiddenUsers(db);
    return matches.map((m) => (m.liveUrl && hidden.twitchSlugs.has(m.slug) ? { ...m, liveUrl: null } : m));
  } catch (error) {
    console.error("MCSR Ranked live error:", error);
    return [];
  }
}
