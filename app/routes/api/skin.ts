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

      // カスタムスキンがある場合はそれを返す
      if (user?.customSkinUrl) {
        const skinResponse = await fetch(user.customSkinUrl);
        if (skinResponse.ok) {
          const skinData = await skinResponse.arrayBuffer();
          return new Response(skinData, {
            headers: {
              "Content-Type": "image/png",
              "Cache-Control": "public, max-age=3600",
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
      const fallbackData = await fallbackResponse.arrayBuffer();
      return new Response(fallbackData, {
        headers: {
          "Content-Type": "image/png",
          "Cache-Control": "public, max-age=3600",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    const skinData = await skinResponse.arrayBuffer();

    return new Response(skinData, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=3600", // 1時間キャッシュ
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (error) {
    console.error("Failed to fetch skin:", error);
    return new Response("Failed to fetch skin", { status: 500 });
  }
}
