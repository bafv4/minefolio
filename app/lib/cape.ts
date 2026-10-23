// マント表示の共有ヘルパー（MinecraftFullBody に渡す props の解決）。
// クライアント・サーバー双方から import されるため `.server` にはしない。

/** users.capeDisplay の値（schema.ts の enum と対。サーバー側の検証は `users.capeDisplay.enumValues` から導出する） */
export type CapeDisplay = "cape" | "elytra" | "hidden";

/** UI（3択トグル）で並べる順序 */
export const CAPE_DISPLAY_OPTIONS: readonly CapeDisplay[] = ["cape", "elytra", "hidden"];

export interface CapeProps {
  capeUrl?: string;
  backEquipment?: "cape" | "elytra";
}

/**
 * 表示するマントを解決する。優先順位: カスタムマント → Mojang のマント（uuid がある場合）→ なし。
 * カスタムスキンを設定していても uuid があれば Mojang のマントを出す。
 *
 * `capeDisplay` は出所に関係なく適用する（cape=マント / elytra=同じテクスチャでエリトラ / hidden=非表示）。
 * `hidden` やマントの出所が無い場合は `{}`（マント無し）。Mojang 側にマントが無い場合は
 * `/api/cape` が 404 を返し、MinecraftFullBody がマント無しで続行する。
 */
export function resolveCapeProps({
  uuid,
  customCapeUrl,
  capeDisplay,
}: {
  uuid?: string | null;
  customCapeUrl?: string | null;
  capeDisplay?: string | null;
}): CapeProps {
  if (capeDisplay === "hidden") return {};

  const capeUrl = customCapeUrl || (uuid ? `/api/cape?uuid=${encodeURIComponent(uuid)}` : undefined);
  if (!capeUrl) return {};

  return { capeUrl, backEquipment: capeDisplay === "elytra" ? "elytra" : "cape" };
}
