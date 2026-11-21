// /random-player — 一覧（/browse）と同じ母集団（公開プロフィール かつ 視聴者ロール以外。role 未設定は走者扱い）から
// ランダムに1人選び、そのプロフィールへリダイレクトするリソースルート。
// ログイン中は本人を除く。該当者がいなければ /browse?random=none へ（/browse が一文で知らせる。保存領域は使わない）。
import { redirect, type LoaderFunctionArgs } from "react-router";
import { createDb } from "@/lib/db";
import { getEnv } from "@/lib/env.server";
import { createAuth } from "@/lib/auth";
import { getOptionalSession } from "@/lib/session";
import { users } from "@/lib/schema";
import { listedRunnerCondition } from "@/lib/users-filter";
import { and, ne, sql } from "drizzle-orm";

export async function loader({ request }: LoaderFunctionArgs) {
  const env = getEnv();
  const db = createDb();
  const auth = createAuth(db, env);
  const session = await getOptionalSession(request, auth);

  // session.user.id は Discord ID（users.discordId）
  const excludeSelf = session?.user?.id ? ne(users.discordId, session.user.id) : undefined;
  const runner = await db.query.users.findFirst({
    where: and(listedRunnerCondition, excludeSelf),
    orderBy: sql`RANDOM()`,
    columns: { slug: true },
  });

  if (!runner) return redirect("/browse?random=none");
  return redirect(`/player/${runner.slug}`);
}
