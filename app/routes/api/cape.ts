import type { LoaderFunctionArgs } from "react-router";
import { fetchCapeTextureUrl } from "@/lib/mojang";

// GET /api/cape?uuid=<uuid> - Mojang のマント画像を中継して配信する。
// プライバシーポリシーの方針（閲覧者の端末から Mojang へ直接通信しない）に合わせ、
// ブラウザには textures.minecraft.net を直接読ませず、サーバーが取得して返す（/api/skin と同じ構成）。

// マント有無が確定した応答（200 / 404）用。s-maxage で CDN にもキャッシュさせ、
// マント無しのユーザーでも関数呼び出しが訪問者ごとに発生しないようにする
const CAPE_CACHE_CONTROL = "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400";

// Mojang 側の一時障害（502）用。長期ヘッダーで返すと、障害・レート制限による失敗応答が
// 共有 CDN にキャッシュされ続けてしまうため短 TTL・SWR なしにする
const CAPE_FALLBACK_CACHE_CONTROL = "public, max-age=300, s-maxage=300";

// マントは 64x32〜512x256 程度の小さな PNG。想定外に大きい応答は中継しない
const MAX_CAPE_BYTES = 1024 * 1024;

// ハイフンなし 32桁 hex、または標準形式 8-4-4-4-12 のハイフン付き
const UUID_PATTERN =
  /^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export async function loader({ request }: LoaderFunctionArgs) {
  const uuid = new URL(request.url).searchParams.get("uuid");

  if (!uuid || !UUID_PATTERN.test(uuid)) {
    return new Response("Valid uuid is required", { status: 400 });
  }

  try {
    // 検証・https 正規化済みの URL（ホストは textures.minecraft.net のみ）。マント無しは null
    const capeUrl = await fetchCapeTextureUrl(uuid);
    if (!capeUrl) {
      return new Response("Cape not found", {
        status: 404,
        headers: {
          "Cache-Control": CAPE_CACHE_CONTROL,
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    // リダイレクトは辿らない（検証済みホスト以外へ飛ばされる SSRF を防ぐ）
    const capeResponse = await fetch(capeUrl, {
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
    if (!capeResponse.ok) {
      return failedResponse();
    }

    const capeData = await capeResponse.arrayBuffer();
    if (capeData.byteLength > MAX_CAPE_BYTES) {
      return failedResponse();
    }

    return new Response(capeData, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": CAPE_CACHE_CONTROL,
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (error) {
    console.error("Failed to fetch cape:", error);
    return failedResponse();
  }
}

function failedResponse(): Response {
  return new Response("Failed to fetch cape", {
    status: 502,
    headers: {
      "Cache-Control": CAPE_FALLBACK_CACHE_CONTROL,
      "Access-Control-Allow-Origin": "*",
    },
  });
}
