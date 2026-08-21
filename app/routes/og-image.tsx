// OGP画像生成API
// 走者プロフィール用の動的OGP画像を生成 (PNG形式)
import { ImageResponse } from "@vercel/og";
import type { LoaderFunctionArgs } from "react-router";
import { eq } from "drizzle-orm";
import { users } from "@/lib/schema";
import { createDb } from "@/lib/db";
import { fetchSkinFaceDataUrl } from "@/lib/skin-face.server";

// OGP画像に入るブランド文字列（全画像で表記を統一する）
const OG_BRAND = "Minefolio";
const OG_TAGLINE = "Minecraft Speedrunning + Portfolio";
const OG_SITE = "minefolio.app";

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
 * Google Fonts から指定ウェイト・指定文字だけのサブセット TTF を取得する。
 * text= でサブセット化することで CJK フォント（Zen Kaku Gothic New）も軽量に読み込める。
 * UA を指定しない（woff2 非対応とみなされ ttf が返る）Next.js 公式の手法。
 * 失敗時は null（呼び出し側は @vercel/og のバンドル既定フォントにフォールバック）。
 */
async function fetchGoogleFont(
  family: string,
  weight: number,
  text: string,
): Promise<ArrayBuffer | null> {
  try {
    const cssUrl = `https://fonts.googleapis.com/css2?family=${family}:wght@${weight}&text=${encodeURIComponent(text)}`;
    const cssRes = await fetch(cssUrl);
    if (!cssRes.ok) return null;
    const css = await cssRes.text();
    const match = css.match(/src:\s*url\(([^)]+)\)\s*format\(['"]?(?:truetype|opentype)['"]?\)/);
    if (!match) return null;
    const fontRes = await fetch(match[1]);
    if (!fontRes.ok) return null;
    return await fontRes.arrayBuffer();
  } catch {
    return null;
  }
}

type OgFont = { name: string; data: ArrayBuffer; weight: 400 | 700; style: "normal" };

/**
 * OGP画像に使うアプリのフォント（Zen Kaku Gothic New）を、描画テキストのサブセットで読み込む。
 * アプリ本体と同じフォントで、ラテン・日本語の両方をカバーする。
 * 取得できたウェイトのみ返す（空配列ならバンドル既定フォントを使用）。
 */
async function loadAppFonts(text: string): Promise<OgFont[]> {
  const weights: Array<400 | 700> = [400, 700];
  const loaded = await Promise.all(
    weights.map(async (weight) => {
      const data = await fetchGoogleFont("Zen+Kaku+Gothic+New", weight, text);
      return data
        ? ({ name: "Zen Kaku Gothic New", data, weight, style: "normal" } as OgFont)
        : null;
    }),
  );
  return loaded.filter((f): f is OgFont => f !== null);
}

/** 全OGP共通の ImageResponse オプション（1200x630 + 1日キャッシュ + アプリフォント） */
function ogResponseOptions(fonts: OgFont[]) {
  return {
    width: 1200,
    height: 630,
    ...(fonts.length > 0 ? { fonts } : {}),
    headers: {
      "Cache-Control": "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800",
    },
  };
}

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const mcid = url.searchParams.get("mcid");
  const slug = url.searchParams.get("slug");
  const type = url.searchParams.get("type");

  // トップページ用のブランドOGP画像（summary_large_image 向けの横長バナー）
  if (type === "home") {
    const origin = new URL(request.url).origin;
    const iconDataUrl = await fetchImageAsDataUrl(`${origin}/icon.png`);
    return generateHomeOgp({ iconDataUrl });
  }

  // mcidもslugもない場合はデフォルトのOGP画像を生成
  if (!mcid && !slug) {
    const origin = new URL(request.url).origin;
    const iconDataUrl = await fetchImageAsDataUrl(`${origin}/icon.png`);
    return generateDefaultOgp({
      title: OG_BRAND,
      description: OG_TAGLINE,
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

  // 非公開プロフィールのPIIを公開OGP画像に含めない（本人判定不可のため常にデフォルト画像）
  if (user.profileVisibility === "private") {
    const origin = new URL(request.url).origin;
    const iconDataUrl = await fetchImageAsDataUrl(`${origin}/icon.png`);
    return generateDefaultOgp({
      title: OG_BRAND,
      description: OG_TAGLINE,
      iconDataUrl,
    });
  }

  // アプリの一覧と同じく、スキンPNGから顔（正面 + 帽子レイヤー）を合成する。
  // /api/skin がカスタムスキン > Mojang > Steve の順で解決するため、カスタムスキンも反映される。
  const origin = new URL(request.url).origin;
  const avatarDataUrl = await fetchSkinFaceDataUrl(origin, user.id, 180);

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
async function generateDefaultOgp(data: {
  title: string;
  description: string;
  iconDataUrl: string | null;
}) {
  const fonts = await loadAppFonts(`${data.title} ${data.description}`);
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
    ogResponseOptions(fonts)
  );
}

/**
 * トップページ用のブランドOGP画像を生成（summary_large_image 向けの横長バナー）
 * 1200x630px (Twitter/OGP標準サイズ)
 */
async function generateHomeOgp(data: { iconDataUrl: string | null }) {
  const fonts = await loadAppFonts(`${OG_BRAND} ${OG_TAGLINE} ${OG_SITE}`);
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

        {/* 青のアクセントグロー */}
        <div
          style={{
            position: "absolute",
            top: "-160px",
            left: "300px",
            width: "600px",
            height: "600px",
            display: "flex",
            backgroundImage:
              "radial-gradient(circle, rgba(59,130,246,0.20) 0%, rgba(59,130,246,0) 70%)",
          }}
        />

        {/* アイコン + ワードマーク */}
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            gap: "36px",
          }}
        >
          {data.iconDataUrl ? (
            <img
              src={data.iconDataUrl}
              width={148}
              height={148}
              style={{ borderRadius: "30px" }}
            />
          ) : (
            <div
              style={{
                display: "flex",
                width: "148px",
                height: "148px",
                background: "#334155",
                borderRadius: "30px",
              }}
            />
          )}
          <div
            style={{
              display: "flex",
              fontSize: "112px",
              fontWeight: "700",
              color: "#f8fafc",
              letterSpacing: "-2px",
            }}
          >
            {OG_BRAND}
          </div>
        </div>

        {/* タグライン */}
        <div
          style={{
            display: "flex",
            marginTop: "36px",
            padding: "12px 28px",
            borderRadius: "9999px",
            background: "rgba(59, 130, 246, 0.15)",
            border: "1px solid rgba(59, 130, 246, 0.4)",
            fontSize: "34px",
            fontWeight: "600",
            color: "#93c5fd",
          }}
        >
          {OG_TAGLINE}
        </div>

        {/* フッター URL */}
        <div
          style={{
            position: "absolute",
            bottom: "44px",
            display: "flex",
            fontSize: "24px",
            fontWeight: "600",
            color: "#64748b",
          }}
        >
          {OG_SITE}
        </div>
      </div>
    ),
    ogResponseOptions(fonts)
  );
}

/**
 * 走者用のOGP画像を生成
 * 1200x630px (Twitter/OGP標準サイズ)
 */
async function generatePlayerOgp(data: OgpData) {
  const roleLabel = data.role === "runner" ? "Speedrunner" : "Viewer";
  const editionLabel =
    data.mainEdition === "java"
      ? "Java Edition"
      : data.mainEdition === "bedrock"
        ? "Bedrock Edition"
        : "";

  const fonts = await loadAppFonts(
    `${data.displayName} @${data.mcid} ${data.bio} ${roleLabel} ${editionLabel} ${OG_BRAND} ${OG_TAGLINE}`,
  );

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
            {OG_BRAND}
          </div>
          <div
            style={{
              display: "flex",
              fontSize: "18px",
              color: "#64748b",
            }}
          >
            {OG_TAGLINE}
          </div>
        </div>
      </div>
    ),
    ogResponseOptions(fonts)
  );
}
