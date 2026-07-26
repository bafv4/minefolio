// ホームフィード（/ SSR loader・api/home-feed）共通のユーザーデータキャッシュ
// DBクエリ削減のため60秒キャッシュ（PaceMan連携用: registeredMcids等）

import { createDb } from "@/lib/db";
import { users } from "@/lib/schema";
import { and, eq, isNotNull } from "drizzle-orm";
import { excludeViewersCondition } from "@/lib/users-filter";
import { getCached, setCached } from "@/lib/cache";

const USER_DATA_TTL = 60 * 1000; // 1分

/** キャッシュキー。形状を変えたら版数を上げる（テストからも参照する） */
export const USER_DATA_CACHE_KEY = "home-feed:user-data:v3";

export interface UserDataCache {
  registeredMcids: string[];
  mcidToUuid: Record<string, string>;
  mcidToSlug: Record<string, string>;
  mcidToDisplayName: Record<string, string>;
  /** アルファベット表記の表示名（入力済みのユーザーのみ）。ロケール解決は表示側で行う */
  mcidToDisplayNameAlphabet: Record<string, string>;
  mcidToSkinUrl: Record<string, string>;
}

async function getCachedUserData(): Promise<UserDataCache | null> {
  return getCached<UserDataCache>(USER_DATA_CACHE_KEY);
}

async function fetchAndCacheUserData(): Promise<UserDataCache> {
  const db = createDb();
  // DBクエリ段階でMCIDとUUIDがあるユーザーのみフィルタリング（最適化）。
  // このキャッシュは未認証のホーム/ペースフィード（発見・一覧面）に配信されるため、
  // 公開プロフィール（profileVisibility === "public"）のみに限定する。
  // unlisted/private は一覧・発見面には出さない（/browse や home.tsx の他クエリと同じ方針）。
  const usersWithMcid = await db
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
        isNotNull(users.mcid),
        isNotNull(users.uuid),
        eq(users.profileVisibility, "public"),
        excludeViewersCondition,
      ),
    );

  const data: UserDataCache = {
    registeredMcids: usersWithMcid.map((u) => u.mcid!.toLowerCase()),
    mcidToUuid: Object.fromEntries(
      usersWithMcid.map((u) => [u.mcid!.toLowerCase(), u.uuid!])
    ),
    mcidToSlug: Object.fromEntries(
      usersWithMcid.map((u) => [u.mcid!.toLowerCase(), u.slug])
    ),
    mcidToDisplayName: Object.fromEntries(
      usersWithMcid.map((u) => [u.mcid!.toLowerCase(), u.displayName || u.mcid!])
    ),
    mcidToDisplayNameAlphabet: Object.fromEntries(
      usersWithMcid
        .filter((u) => u.displayNameAlphabet)
        .map((u) => [u.mcid!.toLowerCase(), u.displayNameAlphabet!])
    ),
    mcidToSkinUrl: Object.fromEntries(
      usersWithMcid
        .filter((u) => u.customSkinUrl !== null)
        .map((u) => [u.mcid!.toLowerCase(), u.customSkinUrl!])
    ),
  };

  await setCached(USER_DATA_CACHE_KEY, data, USER_DATA_TTL);
  return data;
}

export async function getUserData(): Promise<UserDataCache> {
  const cached = await getCachedUserData();
  if (cached) return cached;
  return fetchAndCacheUserData();
}
