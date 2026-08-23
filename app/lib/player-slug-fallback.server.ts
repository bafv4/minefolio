// /player/:slug 404時のフォールバックリダイレクト解決。2段構成:
//
// 1. slug_history（DB内で完結、確実）: set_mcid / remove_mcid で users.slug が変わるたびに
//    旧slugを記録している（app/lib/slug-history.server.ts）。404になった slug をそのまま
//    履歴から引き、現在の slug が見つかればそれを返す。改名後の旧MCID・`@discordId` 形式の
//    旧slugのどちらも救済対象（形状ガードは不要）。
// 2. Mojang API（履歴でヒットしなかった場合のフォールバック）: 意味論は「現在その名前を
//    持っているアカウント」を返すこと。ここで救済できるのは「Mojang側で改名済みだが
//    Minefolio側のプロフィールが（slug_history 導入前の変更、または未更新のまま）新しい
//    MCID（＝現在のMojang名）でアクセスされた」ケースのみ。旧名は既に別アカウントの持ち物か
//    誰の持ち物でもなくなっているため、旧MCIDへの永続的なリダイレクトはこの段では扱わない。
//
// 失敗時（形状不一致・Mojang API障害・該当ユーザーなし）は例外を投げず null を返し、
// 呼び出し側では従来どおり404にフォールバックする。

import { and, eq } from "drizzle-orm";
import type { Database } from "./db";
import { getCached, setCached, CacheTTL } from "./cache";
import { fetchUuidFromMcid, MojangError } from "./mojang";
import { users } from "./schema";
import { resolveSlugFromHistory } from "./slug-history.server";
import { publiclyReferencableCondition } from "./users-filter";

// MCIDとして解釈可能な形状（Mojangの命名規則: 3〜16文字の英数字とアンダースコア）。
// `@discordId` 形式の自動生成slugやランダムパスでの無差別アクセスを、Mojang API呼び出し前に弾く。
const MCID_SHAPE = /^[A-Za-z0-9_]{3,16}$/;

// Mojang APIへの問い合わせタイムアウト（404表示までの遅延を抑えるため既定より短くする）
const FALLBACK_TIMEOUT_MS = 3000;

function missCacheKey(mcid: string): string {
  return `mojang:mcid-miss:${mcid.toLowerCase()}`;
}

async function resolveViaMojang(db: Database, requestedSlug: string): Promise<string | null> {
  if (!MCID_SHAPE.test(requestedSlug)) {
    return null;
  }

  const missKey = missCacheKey(requestedSlug);
  const cachedMiss = await getCached<boolean>(missKey);
  if (cachedMiss) {
    return null;
  }

  let uuid: string;
  try {
    uuid = await fetchUuidFromMcid(requestedSlug, FALLBACK_TIMEOUT_MS);
  } catch (error) {
    if (error instanceof MojangError && error.code === "MCID_NOT_FOUND") {
      await setCached(missKey, true, CacheTTL.MEDIUM);
    }
    // API_ERROR・タイムアウト等の一時障害はキャッシュしない（次回再試行できるようにする）
    return null;
  }

  const match = await db.query.users.findFirst({
    where: and(eq(users.uuid, uuid), publiclyReferencableCondition),
    columns: { slug: true },
  });

  return match?.slug ?? null;
}

/**
 * 404になった slug を旧slugとみなして解決する。まず slug_history（DB内、確実）を引き、
 * ヒットしなければ Mojang API（MCID形状ガードあり）にフォールバックする。
 * 救済できない場合（履歴なし・形状不一致・Mojang側に存在しない・一時的なAPI障害・該当ユーザーなし）は null。
 */
export async function resolvePlayerSlugFallback(
  db: Database,
  requestedSlug: string
): Promise<string | null> {
  const fromHistory = await resolveSlugFromHistory(db, requestedSlug);
  if (fromHistory) {
    return fromHistory;
  }

  return resolveViaMojang(db, requestedSlug);
}
