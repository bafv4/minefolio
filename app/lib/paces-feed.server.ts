import { eq, and, isNotNull } from "drizzle-orm";
import { createDb } from "./db";
import { createAuth } from "./auth";
import { users } from "./schema";
import { getOptionalSession } from "./session";
import { getPaceFeedEntries } from "./paceman-cache";
import { PACE_FEED_SPLITS } from "./pace-splits";
import { excludeViewersCondition } from "./users-filter";
import { getCached, setCached } from "./cache";

// フィード全体（区間キー毎）のキャッシュTTL
// 無限スクロールのページ毎にテーブル全体を走査しないためのもの
const PACES_FEED_CACHE_TTL = 60 * 1000;

// /paces ページと /api/paces で共用するフィード項目（クライアント表示用に整形済み）
export interface PaceFeedItem {
  mcid: string;
  nickname: string;
  timeline: string;
  rta: number;
  pacemanRunId: number;
  time: number; // Unix秒
}

// /paces の検索条件
export interface PaceSearchFilters {
  player?: string; // MCID・表示名の部分一致（小文字）
  timeline?: string; // 区間（PACE_FEED_SPLITS のいずれか）
  from?: Date; // 時期（開始日）
  to?: Date; // 時期（終了日）
  maxRta?: number; // タイム上限（ミリ秒）
}

// 日付文字列（YYYY-MM-DD）をJSTの日付として解釈（アプリは日本語圏向け）
function parseDateParam(value: string | null, endOfDay: boolean): Date | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const time = endOfDay ? "23:59:59.999" : "00:00:00.000";
  const date = new Date(`${value}T${time}+09:00`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

// "m:ss" 形式のタイムをミリ秒に変換（例: "10:00" → 600000）
function parseTimeParamToMs(value: string | null): number | undefined {
  if (!value) return undefined;
  const match = value.trim().match(/^(\d{1,3}):([0-5]?\d)$/);
  if (!match) return undefined;
  return (Number(match[1]) * 60 + Number(match[2])) * 1000;
}

/**
 * URLクエリパラメータから /paces の検索条件を解析する
 * 不正な値は無視される（条件なし扱い）
 */
export function parsePaceSearchParams(searchParams: URLSearchParams): PaceSearchFilters {
  const filters: PaceSearchFilters = {};

  const player = searchParams.get("q")?.trim().toLowerCase();
  if (player) filters.player = player;

  const split = searchParams.get("split");
  if (split && (PACE_FEED_SPLITS as readonly string[]).includes(split)) {
    filters.timeline = split;
  }

  filters.from = parseDateParam(searchParams.get("from"), false);
  filters.to = parseDateParam(searchParams.get("to"), true);
  filters.maxRta = parseTimeParamToMs(searchParams.get("maxTime"));

  return filters;
}

export interface VisiblePaceFeed {
  items: PaceFeedItem[];
  mcidToUuid: Record<string, string>;
  mcidToDisplayName: Record<string, string>;
  mcidToSkinUrl: Record<string, string>;
}

type Db = ReturnType<typeof createDb>;
type Auth = ReturnType<typeof createAuth>;

/**
 * フィード全体（区間指定のみ反映、他フィルタ未適用）とマップを構築してキャッシュする
 * 区間はSQLでの行選択（そのランのどのSplitを表示するか）に関わるためキャッシュキーに含める。
 * それ以外の条件（プレイヤー・時期・タイム）はキャッシュ済みリストへのJSフィルタで等価に適用できる。
 */
async function getPaceFeedBase(db: Db, timeline?: string): Promise<VisiblePaceFeed> {
  const cacheKey = `paces:feed:${timeline ?? "all"}`;
  const cached = await getCached<VisiblePaceFeed>(cacheKey);
  if (cached) return cached;

  const usersWithMcid = await db
    .select({
      mcid: users.mcid,
      uuid: users.uuid,
      displayName: users.displayName,
      customSkinUrl: users.customSkinUrl,
    })
    .from(users)
    .where(
      and(
        isNotNull(users.mcid),
        isNotNull(users.uuid),
        excludeViewersCondition,
        // 非公開(private)・限定公開(unlisted)プロフィールのラン履歴・表示名・スキンを
        // 未認証で配信される公開フィードに露出させない。/paces はディスカバリ一覧なので、
        // 一覧系と同じ「公開のみ」ルール（browse-query.server.ts と同一）に揃える。
        eq(users.profileVisibility, "public"),
      ),
    );

  const registeredMcidSet = new Set(usersWithMcid.map((u) => u.mcid!.toLowerCase()));
  const mcidToUuid = Object.fromEntries(
    usersWithMcid.map((u) => [u.mcid!.toLowerCase(), u.uuid!])
  );
  const mcidToDisplayName = Object.fromEntries(
    usersWithMcid.map((u) => [u.mcid!.toLowerCase(), u.displayName || u.mcid!])
  );
  const mcidToSkinUrl = Object.fromEntries(
    usersWithMcid
      .filter((u) => u.customSkinUrl !== null)
      .map((u) => [u.mcid!.toLowerCase(), u.customSkinUrl!])
  );

  const paces = await getPaceFeedEntries(registeredMcidSet, { timeline });

  const items = paces.map((p) => ({
    mcid: p.mcid,
    nickname: p.mcid,
    timeline: p.timeline,
    rta: p.rta,
    pacemanRunId: p.pacemanRunId,
    time: Math.floor(p.date.getTime() / 1000),
  }));

  const base: VisiblePaceFeed = { items, mcidToUuid, mcidToDisplayName, mcidToSkinUrl };
  await setCached(cacheKey, base, PACES_FEED_CACHE_TTL);
  return base;
}

/**
 * 表示対象のペース一覧（保持期間内、新しい順）と表示用マップを取得（セッション非依存）
 * - 登録ユーザー（MCID・UUIDあり、視聴者ロール除外）のペースのみ
 * - filters（プレイヤー・時期・区間・タイム）で絞り込み可能
 * - レスポンスはユーザー非依存なのでCDNキャッシュ可能。
 *   「自分のペースを隠す」設定（showPacemanOnHome）はここでは適用せず、
 *   getViewerPacePrefs の結果を使ってクライアント側でフィルタする（ホームと同じ挙動）
 */
export async function getPublicPaceFeed(
  db: Db,
  filters: PaceSearchFilters = {},
): Promise<VisiblePaceFeed> {
  const base = await getPaceFeedBase(db, filters.timeline);
  const { mcidToUuid, mcidToDisplayName, mcidToSkinUrl } = base;

  let items = base.items;

  // 時期（ランは同一日時の行しか持たないため、ラン単位のJSフィルタでSQL条件と等価）
  if (filters.from) {
    const fromSec = Math.floor(filters.from.getTime() / 1000);
    items = items.filter((p) => p.time >= fromSec);
  }
  if (filters.to) {
    const toSec = Math.floor(filters.to.getTime() / 1000);
    items = items.filter((p) => p.time <= toSec);
  }

  // タイム上限（表示される区間のRTAに対して適用）
  if (filters.maxRta !== undefined) {
    const maxRta = filters.maxRta;
    items = items.filter((p) => p.rta <= maxRta);
  }

  // プレイヤー検索（MCID・表示名の部分一致）
  if (filters.player) {
    const q = filters.player;
    items = items.filter((p) => {
      const mcidLower = p.mcid.toLowerCase();
      const displayName = mcidToDisplayName[mcidLower]?.toLowerCase() ?? "";
      return mcidLower.includes(q) || displayName.includes(q);
    });
  }

  return { items, mcidToUuid, mcidToDisplayName, mcidToSkinUrl };
}

/**
 * ログインユーザーの表示設定（自分のペースを一覧・ホームに表示するか）を取得
 * 未ログイン・未登録ユーザーは { mcid: null, showPacemanOnHome: true }（フィルタなし扱い）
 */
export async function getViewerPacePrefs(
  db: Db,
  auth: Auth,
  request: Request,
): Promise<{ mcid: string | null; showPacemanOnHome: boolean }> {
  const session = await getOptionalSession(request, auth);
  if (!session) return { mcid: null, showPacemanOnHome: true };

  const me = await db.query.users.findFirst({
    where: eq(users.discordId, session.user.id),
    columns: { mcid: true, showPacemanOnHome: true },
  });
  if (!me) return { mcid: null, showPacemanOnHome: true };

  return { mcid: me.mcid, showPacemanOnHome: me.showPacemanOnHome ?? true };
}
