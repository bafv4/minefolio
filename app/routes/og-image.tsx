// OGP画像生成API
// 走者プロフィール用の動的OGP画像を生成 (PNG形式)
import { ImageResponse } from "@vercel/og";
import type { LoaderFunctionArgs } from "react-router";
import { eq } from "drizzle-orm";
import { users } from "@/lib/schema";
import { createDb } from "@/lib/db";
import { fetchNoMcidFaceDataUrl, fetchSkinFaceDataUrl } from "@/lib/skin-face.server";

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

type OgFontWeight = 400 | 700;
type OgFont = { name: string; data: ArrayBuffer; weight: OgFontWeight; style: "normal" };

const OG_FONT_PATHS: Record<OgFontWeight, string> = {
  400: "/fonts/ZenKakuGothicNew-Regular.ttf",
  700: "/fonts/ZenKakuGothicNew-Bold.ttf",
};

// TTF（sfnt version 1.0）のマジックバイト。200応答でも中身がHTML（リライト誤設定・保護画面等）の
// 場合に弾くための検証に使う（そのまま通すと成功として恒久キャッシュされ、そのインスタンス上の
// 全OGP生成がsatoriのthrowで500固定になってしまう）。
const TTF_MAGIC_BYTES = [0x00, 0x01, 0x00, 0x00] as const;

// ウェイトごとに独立した取得 Promise のキャッシュ（同一関数インスタンスがウォームな間、成功した
// ウェイトのみ保持）。失敗したウェイトはキャッシュに残さず、次回リクエストで再取得する。
const weightFontPromises: Partial<Record<OgFontWeight, Promise<OgFont>>> = {};

// 両ウェイトとも成功したときの組み合わせ配列。satori 内部の WeakMap フォントキャッシュが fonts
// 配列の同一性をキーにしているため、使用した weightFontPromises の組み合わせが前回と同一なら
// 新しい配列を作らずそのまま返す。いずれかのウェイトが再取得された場合のみ作り直す。
let cachedFontsArray: {
  fromPromises: readonly [Promise<OgFont> | undefined, Promise<OgFont> | undefined];
  fonts: OgFont[];
} | null = null;

/**
 * フォントファイルを fetch し、TTF として妥当かをマジックバイトで検証する。
 * 非2xx応答、またはマジックバイトが sfnt version 1.0 (00 01 00 00) と一致しない場合は throw する
 * （後者は HTML 応答等の 200+非TTF を弾くためのガード）。
 */
async function fetchFontFile(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch OGP font ${url}: HTTP ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const head = new Uint8Array(arrayBuffer.slice(0, 4));
  const isTtf = TTF_MAGIC_BYTES.every((byte, i) => head[i] === byte);
  if (!isTtf) {
    const contentType = response.headers.get("content-type") ?? "unknown";
    throw new Error(
      `OGP font ${url} is not a TTF file (first bytes: [${Array.from(head).join(", ")}], content-type: ${contentType})`
    );
  }

  return arrayBuffer;
}

/**
 * OGP画像に使うアプリのフォント（Zen Kaku Gothic New）の1ウェイトを、自ホストの public/fonts から
 * 取得する。取得結果（成功時の Promise）はウェイト単位でキャッシュし、失敗時はキャッシュに残さず
 * 次回リクエストで再取得を試みる（一過性の取得失敗でウォームなインスタンス上の以後の生成が
 * 失敗し続けるのを防ぐ）。失敗は console.error に記録する。
 */
function loadOgFontWeight(origin: string, weight: OgFontWeight): Promise<OgFont> {
  const cached = weightFontPromises[weight];
  if (cached) return cached;

  const promise: Promise<OgFont> = fetchFontFile(`${origin}${OG_FONT_PATHS[weight]}`)
    .then((data): OgFont => ({ name: "Zen Kaku Gothic New", data, weight, style: "normal" }))
    .catch((error: unknown) => {
      console.error(`[og-image] Failed to load OGP font (weight ${weight}, origin ${origin}):`, error);
      if (weightFontPromises[weight] === promise) {
        delete weightFontPromises[weight];
      }
      throw error;
    });

  weightFontPromises[weight] = promise;
  return promise;
}

/**
 * OGP画像に使うアプリのフォント（Zen Kaku Gothic New）を、自ホストの public/fonts から取得する。
 * アプリ本体と同じフォントで、ラテン・日本語の両方をカバーする static TTF（unicode-range分割前の
 * 完全グリフセット、OFLライセンス）。外部（Google Fonts）へは一切通信しない。
 * Regular(400) / Bold(700) はウェイト単位で独立に取得し、**成功したウェイトだけ**を返す
 * （どちらか一方が一過性に失敗しても、もう一方は使える＝日本語が全滅しない）。両方成功した場合は
 * 配列オブジェクトの同一性を保ってキャッシュする（satori の WeakMap フォントキャッシュ対策。
 * 上記 `cachedFontsArray` 参照）。空配列なら呼び出し側で @vercel/og のバンドル既定フォントに
 * フォールバックする。
 */
async function loadOgFonts(origin: string): Promise<OgFont[]> {
  const regularPromise = loadOgFontWeight(origin, 400);
  const boldPromise = loadOgFontWeight(origin, 700);

  if (
    cachedFontsArray &&
    cachedFontsArray.fromPromises[0] === regularPromise &&
    cachedFontsArray.fromPromises[1] === boldPromise
  ) {
    return cachedFontsArray.fonts;
  }

  const results = await Promise.allSettled([regularPromise, boldPromise]);
  const fonts = results
    .filter((result): result is PromiseFulfilledResult<OgFont> => result.status === "fulfilled")
    .map((result) => result.value);

  cachedFontsArray = results.every((result) => result.status === "fulfilled")
    ? { fromPromises: [regularPromise, boldPromise], fonts }
    : null;

  return fonts;
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

  const origin = url.origin;

  // トップページ用のブランドOGP画像（summary_large_image 向けの横長バナー）
  if (type === "home") {
    const iconDataUrl = await fetchImageAsDataUrl(`${origin}/icon.png`);
    return generateHomeOgp({ origin, iconDataUrl });
  }

  // mcidもslugもない場合はデフォルトのOGP画像を生成
  if (!mcid && !slug) {
    const iconDataUrl = await fetchImageAsDataUrl(`${origin}/icon.png`);
    return generateDefaultOgp({
      origin,
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
    const iconDataUrl = await fetchImageAsDataUrl(`${origin}/icon.png`);
    return generateDefaultOgp({
      origin,
      title: OG_BRAND,
      description: OG_TAGLINE,
      iconDataUrl,
    });
  }

  // アプリの一覧と同じく、スキンPNGから顔（正面 + 帽子レイヤー）を合成する。
  // /api/skin がカスタムスキン > Mojang > Steve の順で解決するため、カスタムスキンも反映される。
  // MCID未登録（uuid も customSkinUrl も無い）は /api/skin では判別できない（Steve が返る）ため、
  // ここで判定してアプリ側と同じプレースホルダーの顔を使う。
  const avatarDataUrl = user.uuid || user.customSkinUrl
    ? await fetchSkinFaceDataUrl(origin, user.id, 180)
    : await fetchNoMcidFaceDataUrl(origin);

  return generatePlayerOgp({
    origin,
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
  origin: string;
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
  origin: string;
  title: string;
  description: string;
  iconDataUrl: string | null;
}) {
  const fonts = await loadOgFonts(data.origin);
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
async function generateHomeOgp(data: { origin: string; iconDataUrl: string | null }) {
  const fonts = await loadOgFonts(data.origin);
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

  const fonts = await loadOgFonts(data.origin);

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
