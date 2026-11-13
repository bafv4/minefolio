import type { LoaderFunctionArgs } from "react-router";
import { eq } from "drizzle-orm";
import { createDb } from "@/lib/db";
import { createAuth } from "@/lib/auth";
import { getEnv } from "@/lib/env.server";
import { fetchUuidFromMcid, MojangError } from "@/lib/mojang";
import { validateMcidFormat } from "@/lib/profile-edit-validation";
import { users } from "@/lib/schema";

// GET /api/me/mcid-check?mcid=... - /me/edit の MCID 変更ダイアログ用の事前照合（認証必須・DB は変更しない）。
// 形式 → 他ユーザーとの重複 → Mojang 照合の順に確認し、結果を status で返す。
// 保存時（action）でも同じ照合を必ず再実行するため、この結果は信用されない（プレビュー専用）。
// Mojang 呼び出しは fetchUuidFromMcid のキャッシュ（インスタンス内メモリ）を共有する。
export type McidCheckResult =
  | { status: "ok"; mcid: string; uuid: string }
  | { status: "invalid" | "taken" | "not_found" | "error" };

function json(body: McidCheckResult, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" },
  });
}

export async function loader({ request }: LoaderFunctionArgs) {
  const env = getEnv();
  const db = createDb();
  const auth = createAuth(db, env);

  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const user = await db.query.users.findFirst({ where: eq(users.discordId, session.user.id) });
  if (!user) {
    return new Response(JSON.stringify({ error: "User not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const mcid = (new URL(request.url).searchParams.get("mcid") ?? "").trim();
  if (validateMcidFormat(mcid)) return json({ status: "invalid" });

  const taken = await db.query.users.findFirst({ where: eq(users.mcid, mcid) });
  if (taken && taken.id !== user.id) return json({ status: "taken" });

  try {
    const uuid = await fetchUuidFromMcid(mcid);
    // 大文字小文字違いの MCID は上の mcid 比較（BINARY）をすり抜けるが、uuid は同じになる
    const uuidOwner = await db.query.users.findFirst({ where: eq(users.uuid, uuid) });
    if (uuidOwner && uuidOwner.id !== user.id) return json({ status: "taken" });
    return json({ status: "ok", mcid, uuid });
  } catch (error) {
    if (error instanceof MojangError && error.code === "MCID_NOT_FOUND") {
      return json({ status: "not_found" });
    }
    return json({ status: "error" });
  }
}
