import type { LoaderFunctionArgs } from "react-router";

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

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const uuid = url.searchParams.get("uuid");

  if (!uuid) {
    return new Response("UUID is required", { status: 400 });
  }

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
