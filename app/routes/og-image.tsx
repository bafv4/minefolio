// OGP画像生成API
// プレイヤープロフィール用の動的OGP画像を生成 (PNG形式)
import { ImageResponse } from "@vercel/og";
import type { LoaderFunctionArgs } from "react-router";
import { eq } from "drizzle-orm";
import { users } from "@/lib/schema";
import { createDb } from "@/lib/db";

/**
 * ArrayBufferをBase64文字列に変換（Edge Runtime対応）
 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * 外部画像をフェッチしてBase64データURLに変換
 */
async function fetchImageAsDataUrl(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Minefolio/1.0",
      },
    });
    if (!response.ok) return null;

    const arrayBuffer = await response.arrayBuffer();
    const base64 = arrayBufferToBase64(arrayBuffer);
    const contentType = response.headers.get("content-type") || "image/png";
    return `data:${contentType};base64,${base64}`;
  } catch {
    return null;
  }
}

/**
 * DiscordアバターURLを生成
 */
function getDiscordAvatarUrl(
  discordId: string,
  discordAvatar: string,
  size: number = 256
): string {
  return `https://cdn.discordapp.com/avatars/${discordId}/${discordAvatar}.png?size=${size}`;
}

/**
 * アバター画像をBase64データURLとして取得
 * 優先順位: Discord → Crafatar → mc-heads.net → minotar
 */
async function fetchAvatarDataUrl(options: {
  discordId?: string | null;
  discordAvatar?: string | null;
  uuid?: string | null;
  size?: number;
}): Promise<string | null> {
  const { discordId, discordAvatar, uuid, size = 180 } = options;

  // 1. Discordアバターを優先
  if (discordId && discordAvatar) {
    const discordUrl = getDiscordAvatarUrl(discordId, discordAvatar, size);
    const dataUrl = await fetchImageAsDataUrl(discordUrl);
    if (dataUrl) return dataUrl;
  }

  // 2. Minecraftアバターサービスにフォールバック
  if (uuid) {
    const uuidClean = uuid.replace(/-/g, "");
    const services = [
      `https://crafatar.com/avatars/${uuidClean}?size=${size}&overlay=true`,
      `https://mc-heads.net/avatar/${uuidClean}/${size}`,
      `https://minotar.net/avatar/${uuidClean}/${size}`,
    ];

    for (const url of services) {
      const dataUrl = await fetchImageAsDataUrl(url);
      if (dataUrl) return dataUrl;
    }
  }

  return null;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const mcid = url.searchParams.get("mcid");
  const slug = url.searchParams.get("slug");
  const title = url.searchParams.get("title");
  const description = url.searchParams.get("description");

  // mcidもslugもない場合はデフォルトのOGP画像を生成
  if (!mcid && !slug) {
    const origin = new URL(request.url).origin;
    const iconDataUrl = await fetchImageAsDataUrl(`${origin}/icon.png`);
    return generateDefaultOgp({
      title: title || "Minefolio",
      description: description || "Minecraft Speedrunning Portfolio Platform",
      iconDataUrl,
    });
  }

  const db = createDb();

  // ユーザー情報を取得（mcidまたはslugで検索）
  const user = mcid
    ? await db.query.users.findFirst({ where: eq(users.mcid, mcid) })
    : await db.query.users.findFirst({ where: eq(users.slug, slug!) });

  if (!user) {
    return new Response("User not found", { status: 404 });
  }

  // アバター画像を事前にフェッチ（Discord優先、Minecraftアバターにフォールバック）
  const avatarDataUrl = await fetchAvatarDataUrl({
    discordId: user.discordId,
    discordAvatar: user.discordAvatar,
    uuid: user.uuid,
    size: 180,
  });

  return generatePlayerOgp({
    displayName: user.displayName || user.mcid || user.slug,
    mcid: user.mcid || user.slug,
    uuid: user.uuid || "",
    avatarDataUrl,
    bio: user.shortBio || user.bio || "Minecraft Speedrunner",
    mainEdition: user.mainEdition,
    role: user.role,
  });
}

interface OgpData {
  displayName: string;
  mcid: string;
  uuid: string;
  avatarDataUrl: string | null;
  bio: string;
  mainEdition: string | null;
  role: string | null;
}

/**
 * デフォルトのOGP画像を生成
 * 1200x630px (Twitter/OGP標準サイズ)
 */
function generateDefaultOgp(data: {
  title: string;
  description: string;
  iconDataUrl: string | null;
}) {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        {/* グリッドパターン背景 */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px)",
            backgroundSize: "40px 40px",
          }}
        />

        {/* ロゴ部分 */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "24px",
          }}
        >
          {/* ページアイコン */}
          {data.iconDataUrl ? (
            <img
              src={data.iconDataUrl}
              width={120}
              height={120}
              style={{ borderRadius: "24px" }}
            />
          ) : (
            <div
              style={{
                display: "flex",
                width: "120px",
                height: "120px",
                background: "#334155",
                borderRadius: "24px",
              }}
            />
          )}

          {/* タイトル */}
          <div
            style={{
              display: "flex",
              fontSize: "72px",
              fontWeight: "700",
              color: "#f1f5f9",
            }}
          >
            {data.title}
          </div>

          {/* 説明 */}
          <div
            style={{
              display: "flex",
              fontSize: "28px",
              color: "#94a3b8",
            }}
          >
            {data.description.slice(0, 120)}
          </div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      headers: {
        "Cache-Control": "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800",
      },
    }
  );
}

/**
 * プレイヤー用のOGP画像を生成
 * 1200x630px (Twitter/OGP標準サイズ)
 */
function generatePlayerOgp(data: OgpData) {
  const roleLabel = data.role === "runner" ? "Speedrunner" : "Viewer";
  const editionLabel =
    data.mainEdition === "java"
      ? "Java Edition"
      : data.mainEdition === "bedrock"
        ? "Bedrock Edition"
        : "";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          background: "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)",
          fontFamily: "system-ui, sans-serif",
          padding: "60px",
        }}
      >
        {/* グリッドパターン背景 */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px)",
            backgroundSize: "40px 40px",
          }}
        />

        {/* メインカード */}
        <div
          style={{
            display: "flex",
            width: "100%",
            height: "100%",
            background: "rgba(30, 41, 59, 0.8)",
            borderRadius: "16px",
            padding: "40px",
            gap: "40px",
          }}
        >
          {/* アバター */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <div
              style={{
                width: "200px",
                height: "200px",
                borderRadius: "100px",
                background: "#334155",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                overflow: "hidden",
              }}
            >
              {data.avatarDataUrl ? (
                <img
                  src={data.avatarDataUrl}
                  width={180}
                  height={180}
                  style={{ borderRadius: "90px" }}
                />
              ) : (
                <div
                  style={{
                    display: "flex",
                    width: "80px",
                    height: "80px",
                    background: "#64748b",
                    borderRadius: "8px",
                  }}
                />
              )}
            </div>
          </div>

          {/* テキストエリア */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              flex: 1,
              gap: "16px",
            }}
          >
            {/* 表示名 */}
            <div
              style={{
                display: "flex",
                fontSize: "56px",
                fontWeight: "700",
                color: "#f1f5f9",
                lineHeight: 1.2,
              }}
            >
              {data.displayName.slice(0, 20)}
            </div>

            {/* MCID */}
            <div
              style={{
                display: "flex",
                fontSize: "28px",
                color: "#94a3b8",
              }}
            >
              @{data.mcid}
            </div>

            {/* バッジ */}
            <div
              style={{
                display: "flex",
                gap: "12px",
                marginTop: "8px",
              }}
            >
              {data.role && (
                <div
                  style={{
                    display: "flex",
                    background: "#3b82f6",
                    color: "white",
                    padding: "8px 16px",
                    borderRadius: "16px",
                    fontSize: "18px",
                    fontWeight: "600",
                  }}
                >
                  {roleLabel}
                </div>
              )}
              {data.mainEdition && (
                <div
                  style={{
                    display: "flex",
                    background: "#64748b",
                    color: "white",
                    padding: "8px 16px",
                    borderRadius: "16px",
                    fontSize: "18px",
                    fontWeight: "600",
                  }}
                >
                  {editionLabel}
                </div>
              )}
            </div>

            {/* Bio */}
            <div
              style={{
                display: "flex",
                fontSize: "24px",
                color: "#cbd5e1",
                marginTop: "8px",
                lineHeight: 1.4,
              }}
            >
              {data.bio.slice(0, 100)}
            </div>
          </div>
        </div>

        {/* フッター */}
        <div
          style={{
            position: "absolute",
            bottom: "24px",
            left: "80px",
            right: "80px",
            display: "flex",
            justifyContent: "space-between",
          }}
        >
          <div
            style={{
              display: "flex",
              fontSize: "20px",
              fontWeight: "600",
              color: "#64748b",
            }}
          >
            MINEFOLIO
          </div>
          <div
            style={{
              display: "flex",
              fontSize: "18px",
              color: "#64748b",
            }}
          >
            Minecraft Speedrunning Portfolio
          </div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      headers: {
        "Cache-Control": "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800",
      },
    }
  );
}
