import type { LoaderFunctionArgs } from "react-router";
import { createDb } from "@/lib/db";
import { createAuth } from "@/lib/auth";
import { getEnv } from "@/lib/env.server";
import { getOptionalSession } from "@/lib/session";
import { users, searchCraftTemplates } from "@/lib/schema";
import { eq, desc, and, or, sql } from "drizzle-orm";
import { resolveLocale } from "@/lib/locale";
import { pickDisplayName } from "@/lib/slug";
import { isValidTemplateId } from "@/lib/guide-embed-attrs";
import { publiclyReferencableCondition } from "@/lib/users-filter";

/**
 * ガイドエディタの「サーチクラフトテンプレート埋め込み」用の検索。
 * - `?q=`（任意）: タイトル部分一致。公開済み（作者が public）＋ 自分のテンプレート（非公開を含む）。
 *   q が空なら新着を返す。自分のテンプレートは先頭に出す（isOwn / isPublished を付ける）。
 * - `?id=`: ID 指定（URL 貼り付け用）。公開済み（作者が private でない）か自分のもの。他人の非公開は返さない。
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const db = createDb();
  const locale = resolveLocale(request);
  const auth = createAuth(db, getEnv());
  const session = await getOptionalSession(request, auth);
  const viewer = session
    ? await db.query.users.findFirst({
        where: eq(users.discordId, session.user.id),
        columns: { id: true },
      })
    : null;

  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim().slice(0, 100) || "";
  const id = url.searchParams.get("id")?.trim() || "";

  const ownCondition = viewer ? eq(searchCraftTemplates.userId, viewer.id) : undefined;

  let where;
  if (id) {
    if (!isValidTemplateId(id)) return Response.json({ templates: [] });
    where = and(
      eq(searchCraftTemplates.id, id),
      or(
        and(eq(searchCraftTemplates.isPublished, true), publiclyReferencableCondition),
        ownCondition,
      ),
    );
  } else {
    // LIKE のワイルドカード(%,_)とエスケープ文字(\)を無害化し、入力を部分一致リテラルとして扱う
    // （api/guides/search と同じ形）。
    const likePattern = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const titleCondition = q
      ? sql`${searchCraftTemplates.title} LIKE ${likePattern} ESCAPE '\\'`
      : undefined;
    where = and(
      titleCondition,
      or(
        // 非公開・限定公開の著者のテンプレートは検索結果（discovery）に出さない
        and(eq(searchCraftTemplates.isPublished, true), eq(users.profileVisibility, "public")),
        ownCondition,
      ),
    );
  }

  const rows = await db
    .select({
      id: searchCraftTemplates.id,
      title: searchCraftTemplates.title,
      gameLanguage: searchCraftTemplates.gameLanguage,
      craftCount: sql<number>`json_array_length(${searchCraftTemplates.craftsData})`,
      isPublished: searchCraftTemplates.isPublished,
      ownerId: searchCraftTemplates.userId,
      authorSlug: users.slug,
      authorDisplayName: users.displayName,
      authorDisplayNameAlphabet: users.displayNameAlphabet,
      authorMcid: users.mcid,
      authorUuid: users.uuid,
      authorCustomSkinUrl: users.customSkinUrl,
    })
    .from(searchCraftTemplates)
    .innerJoin(users, eq(searchCraftTemplates.userId, users.id))
    .where(where)
    // 自分のテンプレート（非公開を含む）を先頭へ。limit の前に効かせ、自分の分が押し出されないようにする
    // （未ログイン時はこの項を付けない。定数の ORDER BY 0 は SQLite で列番号として解釈され失敗する）
    .orderBy(
      ...(viewer
        ? [sql`case when ${searchCraftTemplates.userId} = ${viewer.id} then 0 else 1 end`]
        : []),
      desc(searchCraftTemplates.updatedAt),
    )
    .limit(20);

  const templates = rows.map((r) => ({
      id: r.id,
      title: r.title,
      gameLanguage: r.gameLanguage,
      craftCount: Number(r.craftCount) || 0,
      isPublished: r.isPublished,
      isOwn: !!viewer && r.ownerId === viewer.id,
      authorUuid: r.authorUuid,
      authorSkinUrl: r.authorCustomSkinUrl,
      authorName:
        pickDisplayName(
          { displayName: r.authorDisplayName, displayNameAlphabet: r.authorDisplayNameAlphabet },
          locale,
        ) ||
        r.authorMcid ||
        r.authorSlug,
  }));

  return Response.json({ templates });
}
