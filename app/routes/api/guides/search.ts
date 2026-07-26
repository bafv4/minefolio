import type { LoaderFunctionArgs } from "react-router";
import { createDb } from "@/lib/db";
import { getEnv } from "@/lib/env.server";
import { users, guides } from "@/lib/schema";
import { eq, desc, and, sql } from "drizzle-orm";
import { resolveLocale } from "@/lib/locale";
import { pickDisplayName } from "@/lib/slug";

export async function loader({ request }: LoaderFunctionArgs) {
  const env = getEnv();
  const db = createDb();
  const locale = resolveLocale(request);

  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim().slice(0, 100) || "";

  if (q.length < 1) {
    return Response.json({ guides: [] });
  }

  // LIKE のワイルドカード(%,_)をエスケープし、入力を部分一致リテラルとして扱う。
  const likePattern = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

  const results = await db
    .select({
      id: guides.id,
      title: guides.title,
      slug: guides.slug,
      summary: guides.summary,
      coverImageUrl: guides.coverImageUrl,
      authorSlug: users.slug,
      authorDisplayName: users.displayName,
      authorDisplayNameAlphabet: users.displayNameAlphabet,
      authorMcid: users.mcid,
    })
    .from(guides)
    .innerJoin(users, eq(guides.authorId, users.id))
    .where(
      and(
        eq(guides.isPublished, true),
        // 非公開・限定公開の著者のガイドは検索結果（discovery）に出さない
        eq(users.profileVisibility, "public"),
        sql`${guides.title} LIKE ${likePattern} ESCAPE '\\'`
      )
    )
    .orderBy(desc(guides.updatedAt))
    .limit(10);

  return Response.json({
    guides: results.map((r) => ({
      id: r.id,
      title: r.title,
      slug: r.slug,
      summary: r.summary,
      coverImageUrl: r.coverImageUrl,
      authorSlug: r.authorSlug,
      authorName:
        pickDisplayName(
          { displayName: r.authorDisplayName, displayNameAlphabet: r.authorDisplayNameAlphabet },
          locale,
        ) || r.authorMcid || r.authorSlug,
      url: `/guides/${r.authorSlug}/${r.slug}`,
    })),
  });
}
