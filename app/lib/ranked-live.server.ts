// MCSR Ranked の公開ライブ試合（GET /live）のうち、Minefolio 登録者が出ている試合を取得する。
// 応答: { status, data: { players, liveMatches: [{ currentTime(ms), players[{uuid(ハイフン無し), nickname, eloRate}],
//   data: { [uuid]: { liveUrl, timeline } } }] } }（公式 openapi.yaml の PublicLiveData）。
// レート制限は 500 回 / 10 分。呼び出し側（/api/home-feed）が30秒キャッシュするため十分に収まる。

import { and, eq, isNotNull, isNull, ne, or } from "drizzle-orm";
import type { Database } from "./db";
import { users } from "./schema";
import { excludeViewersCondition } from "./users-filter";
import { sanitizeTwitchUrl, type RankedLiveMatch } from "./home-live";

const RANKED_LIVE_URL = "https://mcsrranked.com/api/live";

interface RankedLivePlayer {
  uuid: string;
  nickname: string;
  eloRate: number | null;
}
interface RankedLiveResponse {
  status?: string;
  data?: {
    liveMatches?: {
      currentTime?: number;
      players?: RankedLivePlayer[];
      data?: Record<string, { liveUrl?: string | null } | undefined>;
    }[];
  };
}

/** UUID をハイフン無し・小文字に正規化する（users.uuid は両形式が混在するため両側で揃える） */
export function normalizeUuid(uuid: string): string {
  return uuid.replace(/-/g, "").toLowerCase();
}

/** Ranked の応答から、登録者が出ている試合を1試合1カードに変換する（純粋関数。テスト対象） */
export function buildRankedLiveMatches(
  response: RankedLiveResponse | null,
  registered: Map<
    string,
    { mcid: string; slug: string; uuid: string; displayName: string | null; displayNameAlphabet: string | null; skinUrl: string | null }
  >,
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
    const dataEntry = m.data?.[featured.uuid] ?? m.data?.[normalizeUuid(featured.uuid)];
    result.push({
      key: players.map((p) => normalizeUuid(p.uuid)).join("-"),
      mcid: me.mcid,
      slug: me.slug,
      uuid: me.uuid,
      displayName: me.displayName,
      displayNameAlphabet: me.displayNameAlphabet,
      skinUrl: me.skinUrl,
      eloRate: featured.eloRate ?? null,
      opponent: { nickname: opponent?.nickname ?? "", eloRate: opponent?.eloRate ?? null },
      currentTimeMs: typeof m.currentTime === "number" ? m.currentTime : 0,
      liveUrl: sanitizeTwitchUrl(dataEntry?.liveUrl),
    });
  }
  return result;
}

/** Ranked 統計を公開している登録者（公開プロフィール・視聴者除外・uuid あり）を normalizedUuid で引ける形にする */
async function getRegisteredByUuid(db: Database) {
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
        eq(users.profileVisibility, "public"),
        excludeViewersCondition,
        // Ranked 統計を非公開にした人（docs/rankings-stats.md）は対戦中カードにも出さない
        or(isNull(users.showRankedStats), ne(users.showRankedStats, false)),
      ),
    );
  const map = new Map<string, { mcid: string; slug: string; uuid: string; displayName: string | null; displayNameAlphabet: string | null; skinUrl: string | null }>();
  for (const r of rows) {
    map.set(normalizeUuid(r.uuid!), {
      mcid: r.mcid!,
      slug: r.slug,
      uuid: r.uuid!,
      displayName: r.displayName,
      displayNameAlphabet: r.displayNameAlphabet,
      skinUrl: r.customSkinUrl,
    });
  }
  return map;
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
    return buildRankedLiveMatches(json, await getRegisteredByUuid(db));
  } catch (error) {
    console.error("MCSR Ranked live error:", error);
    return [];
  }
}
