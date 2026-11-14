// ホームの「お気に入りの動き」（お気に入りの人のペース・動画・プロフィール更新・ガイド公開を新しい順に10件）。
// ログイン済みはサーバーのお気に入り、未ログインはブラウザのお気に入り（POST 本文の slug）を呼び出し側が渡す。
// 対象は公開プロフィール（視聴者除外）のみ。各種別を1クエリずつ（お気に入りの userId 群に対して）取得する。

import { and, desc, eq, gte, inArray, ne } from "drizzle-orm";
import type { Database } from "./db";
import { users, pacemanPaces, guides } from "./schema";
import { excludeViewersCondition } from "./users-filter";
import { getPublicVideoFeed } from "./videos-feed.server";
import { getPaceRetentionStart } from "./paceman-cache";
import { splitStage } from "./home-live";

export const FAVORITE_ACTIVITY_LIMIT = 10;
const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** 1回の問い合わせで扱うお気に入りの上限（POST 本文の肥大化対策） */
export const FAVORITE_SLUGS_MAX = 100;

export type FavoriteActivityKind = "pace" | "video" | "profile" | "guide";

export interface FavoriteActivityItem {
  kind: FavoriteActivityKind;
  /** 出来事の時刻（ms） */
  at: number;
  slug: string;
  mcid: string | null;
  uuid: string | null;
  displayName: string | null;
  displayNameAlphabet: string | null;
  customSkinUrl: string | null;
  /** 遷移先（アプリ内パス） */
  href: string;
  /** pace: 到達区間名 / video・guide: タイトル */
  label: string | null;
  /** pace: 区間IGT（ミリ秒） */
  timeMs: number | null;
}

export interface FavoriteActivityResult {
  /** 公開プロフィールとして解決できたお気に入りの人数 */
  favoritesCount: number;
  items: FavoriteActivityItem[];
}

export async function getFavoriteActivity(
  db: Database,
  slugs: string[],
  now: number = Date.now(),
): Promise<FavoriteActivityResult> {
  const unique = [...new Set(slugs.filter((s) => typeof s === "string" && s.length > 0 && s.length <= 100))].slice(
    0,
    FAVORITE_SLUGS_MAX,
  );
  if (unique.length === 0) return { favoritesCount: 0, items: [] };

  const people = await db
    .select({
      id: users.id,
      slug: users.slug,
      mcid: users.mcid,
      uuid: users.uuid,
      displayName: users.displayName,
      displayNameAlphabet: users.displayNameAlphabet,
      customSkinUrl: users.customSkinUrl,
      updatedAt: users.updatedAt,
      showPacemanOnHome: users.showPacemanOnHome,
    })
    .from(users)
    .where(and(inArray(users.slug, unique), eq(users.profileVisibility, "public"), excludeViewersCondition));
  if (people.length === 0) return { favoritesCount: 0, items: [] };

  const since = new Date(now - WINDOW_MS);
  const ids = people.map((p) => p.id);
  const bySlug = new Map(people.map((p) => [p.slug, p]));
  const byId = new Map(people.map((p) => [p.id, p]));
  const base = (p: (typeof people)[number]) => ({
    slug: p.slug,
    mcid: p.mcid,
    uuid: p.uuid,
    displayName: p.displayName,
    displayNameAlphabet: p.displayNameAlphabet,
    customSkinUrl: p.customSkinUrl,
  });

  const [paceRows, guideRows, videos] = await Promise.all([
    db
      .select({
        userId: pacemanPaces.userId,
        runId: pacemanPaces.pacemanRunId,
        timeline: pacemanPaces.timeline,
        rta: pacemanPaces.rta,
        date: pacemanPaces.date,
      })
      .from(pacemanPaces)
      .where(
        and(
          inArray(pacemanPaces.userId, ids),
          ne(pacemanPaces.timeline, "Enter Nether"),
          gte(pacemanPaces.date, new Date(Math.max(since.getTime(), getPaceRetentionStart().getTime()))),
        ),
      )
      .orderBy(desc(pacemanPaces.date))
      .limit(300),
    db
      .select({ authorId: guides.authorId, slug: guides.slug, title: guides.title, updatedAt: guides.updatedAt })
      .from(guides)
      .where(and(inArray(guides.authorId, ids), eq(guides.isPublished, true), gte(guides.updatedAt, since)))
      .orderBy(desc(guides.updatedAt))
      .limit(30),
    getPublicVideoFeed(db, {}, { forHome: true }).catch(() => []),
  ]);

  const items: FavoriteActivityItem[] = [];

  // ペース: 同じランは最も進んだ区間だけ。1人あたり2件まで
  const bestPerRun = new Map<string, (typeof paceRows)[number]>();
  for (const r of paceRows) {
    if (!r.userId) continue;
    const key = `${r.userId}:${r.runId}`;
    const cur = bestPerRun.get(key);
    if (!cur || splitStage(r.timeline) > splitStage(cur.timeline) || (splitStage(r.timeline) === splitStage(cur.timeline) && r.rta > cur.rta)) {
      bestPerRun.set(key, r);
    }
  }
  const paceCount = new Map<string, number>();
  for (const r of [...bestPerRun.values()].sort((a, b) => b.date.getTime() - a.date.getTime())) {
    const p = byId.get(r.userId as string);
    if (!p) continue;
    if (p.showPacemanOnHome === false) continue; // 「ホーム画面にPaceManのペースを表示」オフの人は全員のホームから除く
    const c = paceCount.get(p.id) ?? 0;
    if (c >= 2) continue;
    paceCount.set(p.id, c + 1);
    items.push({
      ...base(p),
      kind: "pace",
      at: r.date.getTime(),
      href: `/player/${p.slug}`,
      label: r.timeline,
      timeMs: r.rta,
    });
  }

  for (const v of videos) {
    const at = new Date(v.publishedAt).getTime();
    if (at < since.getTime()) break;
    const p = v.slug ? bySlug.get(v.slug) : null;
    if (!p) continue;
    items.push({
      ...base(p),
      kind: "video",
      at,
      href: `/player/${p.slug}`,
      label: v.title,
      timeMs: null,
    });
  }

  for (const g of guideRows) {
    const p = byId.get(g.authorId);
    if (!p) continue;
    items.push({
      ...base(p),
      kind: "guide",
      at: g.updatedAt.getTime(),
      href: `/guides/${p.slug}/${g.slug}`,
      label: g.title,
      timeMs: null,
    });
  }

  for (const p of people) {
    if (p.updatedAt.getTime() < since.getTime()) continue;
    items.push({
      ...base(p),
      kind: "profile",
      at: p.updatedAt.getTime(),
      href: `/player/${p.slug}`,
      label: null,
      timeMs: null,
    });
  }

  items.sort((a, b) => b.at - a.at);
  return { favoritesCount: people.length, items: items.slice(0, FAVORITE_ACTIVITY_LIMIT) };
}
