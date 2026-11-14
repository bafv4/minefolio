// ホームの表示設定（users.showPacemanOnHome / showYoutubeOnHome / showTwitchOnHome）で
// 「オフにした人」を、誰のホームからも除外するための一覧取得。
// 除外はサーバー側（API／loader の取得時）で行い、レスポンスは閲覧者非依存のまま保つ（CDN 共有キャッシュと矛盾しない）。
// 値が null（未設定）は既定の true 扱いなので、明示的に false の人だけを拾う。
// 対象はホームと、ホームと同じ設定に従う /favorites/activity。それ以外（/videos・/paces・プロフィール等）では使わない
// （設定文言が「ホーム画面に」であるため）。
// 一覧は60秒キャッシュする（設定を変えた人が他人の画面から消えるまでの最悪値に +60 秒が加わる）。

import { eq, or } from "drizzle-orm";
import type { Database } from "./db";
import { users } from "./schema";
import { getCached, setCached } from "./cache";

const HIDDEN_USERS_TTL = 60 * 1000;
/** キャッシュキー。形状を変えたら版数を上げる（テストからも参照する） */
export const HOME_HIDDEN_USERS_CACHE_KEY = "home:hidden-users:v1";

export interface HomeHiddenUsers {
  /** showPacemanOnHome=false の人の mcid（小文字）。ペース系の照合キー */
  pacemanMcids: Set<string>;
  /** showYoutubeOnHome=false の人の slug */
  youtubeSlugs: Set<string>;
  /** showTwitchOnHome=false の人の slug */
  twitchSlugs: Set<string>;
}

export type HomeVisibilityKind = "paceman" | "youtube" | "twitch";

/** ホームの表示設定。null（未設定）は既定の表示扱いなので、明示的に false のときだけ隠す */
export function isHiddenOnHome(
  user: { showPacemanOnHome?: boolean | null; showYoutubeOnHome?: boolean | null; showTwitchOnHome?: boolean | null },
  kind: HomeVisibilityKind,
): boolean {
  switch (kind) {
    case "paceman":
      return user.showPacemanOnHome === false;
    case "youtube":
      return user.showYoutubeOnHome === false;
    case "twitch":
      return user.showTwitchOnHome === false;
  }
}

interface HiddenRow {
  slug: string;
  mcid: string | null;
  showPacemanOnHome: boolean | null;
  showYoutubeOnHome: boolean | null;
  showTwitchOnHome: boolean | null;
}

export async function getHomeHiddenUsers(db: Database): Promise<HomeHiddenUsers> {
  let rows = await getCached<HiddenRow[]>(HOME_HIDDEN_USERS_CACHE_KEY);
  if (!rows) {
    rows = await db
      .select({
        slug: users.slug,
        mcid: users.mcid,
        showPacemanOnHome: users.showPacemanOnHome,
        showYoutubeOnHome: users.showYoutubeOnHome,
        showTwitchOnHome: users.showTwitchOnHome,
      })
      .from(users)
      .where(
        or(
          eq(users.showPacemanOnHome, false),
          eq(users.showYoutubeOnHome, false),
          eq(users.showTwitchOnHome, false),
        ),
      );
    await setCached(HOME_HIDDEN_USERS_CACHE_KEY, rows, HIDDEN_USERS_TTL);
  }

  const hidden: HomeHiddenUsers = {
    pacemanMcids: new Set(),
    youtubeSlugs: new Set(),
    twitchSlugs: new Set(),
  };
  for (const r of rows) {
    if (isHiddenOnHome(r, "paceman") && r.mcid) hidden.pacemanMcids.add(r.mcid.toLowerCase());
    if (isHiddenOnHome(r, "youtube")) hidden.youtubeSlugs.add(r.slug);
    if (isHiddenOnHome(r, "twitch")) hidden.twitchSlugs.add(r.slug);
  }
  return hidden;
}
