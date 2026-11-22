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
import { RANKED_API_BASE, MATCH_TYPE_RANKED } from "./external-stats";
import {
  normalizeUuid,
  rankedSplitName,
  rankedStage,
  sanitizeTwitchUrl,
  judgeRankedResult,
  type RankedLiveMatch,
  type RankedLiveProgress,
  type RankedResultResponse,
} from "./home-live";

const RANKED_LIVE_URL = `${RANKED_API_BASE}/live`;

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

const registeredMapCache = new WeakMap<object, Map<string, RegisteredRunner>>();

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
  // キャッシュが同じ配列を返す間は Map も使い回す（ranked-result の照会のたびに登録者数ぶん作り直さない）
  let map = registeredMapCache.get(runners);
  if (!map) {
    map = new Map(runners.map(({ key, ...runner }) => [key, runner]));
    registeredMapCache.set(runners, map);
  }
  return map;
}

/** Minefolio 登録者が出ている Ranked のライブ試合一覧。外部取得に失敗したら null（0試合の [] と区別する。呼び出し側は失敗をキャッシュしない） */
export async function fetchRankedLiveMatches(db: Database): Promise<RankedLiveMatch[] | null> {
  try {
    const res = await fetch(RANKED_LIVE_URL, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const json = (await res.json()) as RankedLiveResponse;
    if (json.status !== "success") return null;
    // 登録者の照合は応答に試合があるときだけ（0試合なら DB を引かない）
    if (!json.data?.liveMatches?.length) return [];
    const matches = buildRankedLiveMatches(json, await getRegisteredByUuid(db));
    if (matches.length === 0) return matches;
    // 「ホーム画面にTwitch配信を表示」をオフにした人は配信リンク（Twitch で見る・配信中の印の元）を消す
    const hidden = await getHomeHiddenUsers(db);
    return matches.map((m) => (m.liveUrl && hidden.twitchSlugs.has(m.slug) ? { ...m, liveUrl: null } : m));
  } catch (error) {
    console.error("MCSR Ranked live error:", error);
    return null;
  }
}

/** 登録走者の最新 Ranked 試合のキャッシュ（uuid 単位）。結果待ちのクライアントが重なっても上流への問い合わせを抑える */
const RANKED_LATEST_TTL = 15 * 1000;
const rankedLatestKey = (uuid: string) => `home:ranked-latest:v1:${uuid}`;
const HEX32 = /^[0-9a-f]{32}$/;

/**
 * 終了した Ranked 試合の結果（登録走者から見た勝敗）。
 * uuid はライブ欄に出せる登録者（getRegisteredByUuid と同じ条件）に限り、それ以外・形式不正・上流失敗・未確定は
 * すべて { status: "pending" } を返す（登録の有無を応答から判別できないようにする）。上流失敗はキャッシュしない
 */
export async function fetchRankedResult(
  db: Database,
  args: { uuid: string; opponent: string; sinceMs: number },
): Promise<RankedResultResponse> {
  const pending: RankedResultResponse = { status: "pending" };
  const opponent = normalizeUuid(args.opponent);
  if (!HEX32.test(opponent) || !Number.isFinite(args.sinceMs)) return pending;
  const runner = (await getRegisteredByUuid(db)).get(normalizeUuid(args.uuid));
  if (!runner) return pending;
  // 上流 URL は照会値ではなく登録済みの uuid から組み立てる
  const uuid = normalizeUuid(runner.uuid);

  const key = rankedLatestKey(uuid);
  let latest = await getCached<{ match: unknown }>(key);
  if (!latest) {
    try {
      const res = await fetch(`${RANKED_API_BASE}/users/${uuid}/matches?count=1&type=${MATCH_TYPE_RANKED}`, {
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return pending;
      const json = (await res.json()) as { status?: string; data?: unknown[] };
      if (json.status !== "success" || !Array.isArray(json.data)) return pending;
      latest = { match: json.data[0] ?? null };
      await setCached(key, latest, RANKED_LATEST_TTL);
    } catch (error) {
      console.error("MCSR Ranked result error:", error);
      return pending;
    }
  }
  const result = judgeRankedResult(latest.match, { uuid, opponent, sinceMs: args.sinceMs });
  return result ? { status: "done", ...result } : pending;
}
