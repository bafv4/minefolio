// /random-player — 公開かつロールが「走者」のプレイヤーをランダムに1人選び、
// そのプロフィールへリダイレクトするリソースルート。該当者がいなければ /browse へ。
import { redirect, type LoaderFunctionArgs } from "react-router";
import { createDb } from "@/lib/db";
import { users } from "@/lib/schema";
import { and, eq, sql } from "drizzle-orm";

export async function loader(_args: LoaderFunctionArgs) {
  const db = createDb();
  const runner = await db.query.users.findFirst({
    where: and(
      eq(users.profileVisibility, "public"),
      eq(users.role, "runner"),
    ),
    orderBy: sql`RANDOM()`,
    columns: { slug: true },
  });

  if (!runner) return redirect("/browse");
  return redirect(`/player/${runner.slug}`);
}
