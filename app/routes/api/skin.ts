import type { LoaderFunctionArgs } from "react-router";
import { createDb } from "@/lib/db";
import { users } from "@/lib/schema";
import { eq } from "drizzle-orm";

// Steve's default skin URL (embedded as base64 fallback would be better, but using official URL)
const STEVE_SKIN_URL =
  "https://textures.minecraft.net/texture/31f477eb1a7beee631c2ca64d06f8f68fa93a3386d04452ab27f43acdf1b60cb";

interface MojangProfile {
  id: string;
  name: string;
  properties: Array<{
    name: string;
    value: string;
  }>;
}

interface TexturesProperty {
  textures: {
    SKIN?: {
      url: string;
    };
  };
}

/** https の URL のみ許可（SSRF 防止）。不正・非 https は null。 */
function toHttpsUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

// スキン画像のキャッシュヘッダー。
// s-maxage でCDN（Vercel Edge）にもキャッシュさせ、Mojang API 2連続fetch入りの
// 関数呼び出しが訪問者ごとに発生しないようにする。TTL切れ後は stale 配信しつつ再検証。
const SKIN_CACHE_CONTROL = "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400";

// Mojang API 失敗時のSteveフォールバック用（短TTL・長SWRなし）。
// 長期ヘッダーで返すと、一時的なMojang障害・レート制限による代替スキンが
// 共有CDNにキャッシュされ、全訪問者にSteveが配信され続けてしまうため区別する
const SKIN_FALLBACK_CACHE_CONTROL = "public, max-age=300, s-maxage=300";

// スキン取得の優先順位:
// 1. customSkinUrl（カスタムスキン）
// 2. Mojang API（UUID連携済み）
// 3. Steve（フォールバック）
export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const uuid = url.searchParams.get("uuid");
  const userId = url.searchParams.get("userId");

  // userIdが指定された場合はカスタムスキンを優先チェック
  if (userId) {
    try {
      const db = createDb();
      const user = await db.query.users.findFirst({
        where: eq(users.id, userId),
        columns: {
          customSkinUrl: true,
          uuid: true,
        },
      });

      // カスタムスキンがある場合はそれを返す（SSRF 防止のため https のみ許可）
      const safeCustomSkinUrl = toHttpsUrl(user?.customSkinUrl);
      if (safeCustomSkinUrl) {
        const skinResponse = await fetch(safeCustomSkinUrl);
        if (skinResponse.ok) {
          const skinData = await skinResponse.arrayBuffer();
          return new Response(skinData, {
            headers: {
              "Content-Type": "image/png",
              "Cache-Control": SKIN_CACHE_CONTROL,
              "Access-Control-Allow-Origin": "*",
            },
          });
        }
      }

      // カスタムスキンがない場合、ユーザーのUUIDでMojang APIを使用
      if (user?.uuid) {
        return fetchMojangSkin(user.uuid);
      }
    } catch (error) {
      console.error("Failed to fetch user skin:", error);
    }
  }

  // UUIDが直接指定された場合（従来の動作）
  if (!uuid) {
    return new Response("UUID or userId is required", { status: 400 });
  }

  return fetchMojangSkin(uuid);
}

// Mojang APIからスキンを取得
async function fetchMojangSkin(uuid: string): Promise<Response> {
  // UUIDからハイフンを除去
  const cleanUuid = uuid.replace(/-/g, "");

  try {
    // Mojang Session Server からプロフィールを取得
    const profileResponse = await fetch(
      `https://sessionserver.mojang.com/session/minecraft/profile/${cleanUuid}`
    );

    // プロフィール取得に失敗（429/5xx等）した場合のSteveは一時的な代替なので短TTL。
    // 取得成功時はテクスチャ未設定の正規Steveも含めて長期キャッシュでよい
    const cacheControl = profileResponse.ok ? SKIN_CACHE_CONTROL : SKIN_FALLBACK_CACHE_CONTROL;

    let skinUrl = STEVE_SKIN_URL;

    if (profileResponse.ok) {
      const profile: MojangProfile = await profileResponse.json();

      // textures プロパティを探す
      const texturesProperty = profile.properties.find(
        (p) => p.name === "textures"
      );

      if (texturesProperty) {
        // Base64デコードしてスキンURLを取得
        const texturesData: TexturesProperty = JSON.parse(
          atob(texturesProperty.value)
        );

        if (texturesData.textures.SKIN?.url) {
          skinUrl = texturesData.textures.SKIN.url;
        }
      }
    }

    // スキンテクスチャを取得
    const skinResponse = await fetch(skinUrl);

    if (!skinResponse.ok) {
      // フォールバック: Steveのスキンを取得
      const fallbackResponse = await fetch(STEVE_SKIN_URL);
      if (!fallbackResponse.ok) {
        return new Response("Failed to fetch skin", { status: 502 });
      }
      const fallbackData = await fallbackResponse.arrayBuffer();
      return new Response(fallbackData, {
        headers: {
          "Content-Type": "image/png",
          "Cache-Control": SKIN_FALLBACK_CACHE_CONTROL,
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    const skinData = await skinResponse.arrayBuffer();

    return new Response(skinData, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": cacheControl,
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (error) {
    console.error("Failed to fetch skin:", error);
    return new Response("Failed to fetch skin", { status: 500 });
  }
}
