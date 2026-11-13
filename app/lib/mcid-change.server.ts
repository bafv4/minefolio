// MCID（Java 版）の設定・変更・解除で /me/edit と onboarding が共有する処理。
// 形式検証（validateMcidFormat）は呼び出し側で先に行う（/me/edit は他の欄の検証と一緒に集約するため）。
import { eq } from "drizzle-orm";
import type { MessageKey } from "@/lib/messages";
import type { Database } from "@/lib/db";
import { users } from "@/lib/schema";
import { fetchUuidFromMcid, MojangError } from "@/lib/mojang";
import { generateSlug } from "@/lib/slug";
import { recordSlugChange } from "@/lib/slug-history.server";
import { retargetFavoritesOnSlugChange } from "@/lib/favorites";

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * MCID の重複確認と Mojang 照合で uuid を導出する（DB は読むだけ。トランザクションの外で呼ぶ）。
 * 他ユーザーが同じ MCID を使用中、または Mojang 上の uuid が他ユーザーのものなら mcidTaken。
 * 大文字小文字違いの MCID は mcid 列の比較（BINARY）をすり抜けるが uuid は同じになるため、
 * users.uuid の UNIQUE 違反を DB に起こさせず MCID のエラーとして返す。
 */
export async function verifyMcidForUser(
  db: Database,
  user: { id: string },
  mcid: string,
): Promise<{ uuid: string } | { errorKey: MessageKey }> {
  const taken = await db.query.users.findFirst({ where: eq(users.mcid, mcid) });
  if (taken && taken.id !== user.id) return { errorKey: "meEdit.mcidTaken" };

  try {
    const uuid = await fetchUuidFromMcid(mcid);
    const uuidOwner = await db.query.users.findFirst({ where: eq(users.uuid, uuid) });
    if (uuidOwner && uuidOwner.id !== user.id) return { errorKey: "meEdit.mcidTaken" };
    return { uuid };
  } catch (error) {
    return {
      errorKey:
        error instanceof MojangError && error.code === "MCID_NOT_FOUND"
          ? "meEdit.mcidNotFound"
          : "meEdit.mcidVerifyFailed",
    };
  }
}

/**
 * MCID の設定・変更（mcid）または解除（null）に伴う slug 再生成・旧 slug 履歴・お気に入り追従。
 * users 行の更新は呼び出し側（同じトランザクション内）が行う。解除時の slug は @{discordId} に戻る。
 * 新しい slug を返す。
 */
export async function applyMcidSlugChange(
  tx: Tx,
  user: { id: string; slug: string; discordId: string },
  mcid: string | null,
): Promise<string> {
  const newSlug = generateSlug(mcid, user.discordId);
  await recordSlugChange(tx, { userId: user.id, oldSlug: user.slug, newSlug });
  await retargetFavoritesOnSlugChange(tx, { oldSlug: user.slug, newSlug });
  return newSlug;
}
