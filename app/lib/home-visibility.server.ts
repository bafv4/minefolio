// ホームの表示設定（users.showPacemanOnHome / showYoutubeOnHome / showTwitchOnHome）で
// 「オフにした人」を、誰のホームからも除外するための一覧取得。
// 除外はサーバー側（API／loader の取得時）で行い、レスポンスは閲覧者非依存のまま保つ（CDN 共有キャッシュと矛盾しない）。
// 値が null（未設定）は既定の true 扱いなので、明示的に false の人だけを拾う。
// ホーム以外（/videos・/paces・プロフィール等）では使わない（設定文言が「ホーム画面に」であるため）。

import { eq, or } from "drizzle-orm";
import type { Database } from "./db";
import { users } from "./schema";

export interface HomeHiddenUsers {
  /** showPacemanOnHome=false の人の mcid（小文字）。ペース系の照合キー */
  pacemanMcids: Set<string>;
  /** showYoutubeOnHome=false の人の slug */
  youtubeSlugs: Set<string>;
  /** showTwitchOnHome=false の人の slug */
  twitchSlugs: Set<string>;
}

export async function getHomeHiddenUsers(db: Database): Promise<HomeHiddenUsers> {
  const rows = await db
    .select({
      slug: users.slug,
      mcid: users.mcid,
      showPaceman: users.showPacemanOnHome,
      showYoutube: users.showYoutubeOnHome,
      showTwitch: users.showTwitchOnHome,
    })
    .from(users)
    .where(
      or(
        eq(users.showPacemanOnHome, false),
        eq(users.showYoutubeOnHome, false),
        eq(users.showTwitchOnHome, false),
      ),
    );

  const hidden: HomeHiddenUsers = {
    pacemanMcids: new Set(),
    youtubeSlugs: new Set(),
    twitchSlugs: new Set(),
  };
  for (const r of rows) {
    if (r.showPaceman === false && r.mcid) hidden.pacemanMcids.add(r.mcid.toLowerCase());
    if (r.showYoutube === false) hidden.youtubeSlugs.add(r.slug);
    if (r.showTwitch === false) hidden.twitchSlugs.add(r.slug);
  }
  return hidden;
}
