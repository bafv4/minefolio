// OGP画像生成API
// プレイヤープロフィール用の動的OGP画像を生成
import { eq } from "drizzle-orm";
import { users } from "@/lib/schema";
import { getCraftarAvatarUrl } from "@/lib/mojang";
import { createDb } from "@/lib/db";

export async function loader({ request, context }: { request: Request; context: any }) {
  const url = new URL(request.url);
  const mcid = url.searchParams.get("mcid");

  if (!mcid) {
    return new Response("Missing mcid parameter", { status: 400 });
  }

  const db = createDb();

  // ユーザー情報を取得
  const user = await db
    .select()
    .from(users)
    .where(eq(users.mcid, mcid))
    .get();

  if (!user) {
    return new Response("User not found", { status: 404 });
  }

  // SVG形式でOGP画像を生成
  const svg = generateOgpSvg({
    displayName: user.displayName || user.mcid,
    mcid: user.mcid,
    uuid: user.uuid,
    bio: user.shortBio || user.bio || "Minecraft Speedrunner",
    mainEdition: user.mainEdition,
    role: user.role,
  });

  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "public, max-age=3600", // 1時間キャッシュ
    },
  });
}

interface OgpData {
  displayName: string;
  mcid: string;
  uuid: string;
  bio: string;
  mainEdition: string | null;
  role: string | null;
}

/**
 * SVG形式のOGP画像を生成
 * 1200x630px (Twitter/OGP標準サイズ)
 */
function generateOgpSvg(data: OgpData): string {
  const avatarUrl = getCraftarAvatarUrl(data.uuid, 128, true);

  // エスケープ処理
  const displayName = escapeXml(data.displayName);
  const bio = escapeXml(data.bio.slice(0, 100)); // 最大100文字
  const mcid = escapeXml(data.mcid);

  // ロールのラベル
  const roleLabel = data.role === "runner" ? "Speedrunner" : "Viewer";
  const editionLabel = data.mainEdition === "java" ? "Java Edition" :
                       data.mainEdition === "bedrock" ? "Bedrock Edition" : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
  <defs>
    <linearGradient id="bg-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#0f172a;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#1e293b;stop-opacity:1" />
    </linearGradient>
    <filter id="shadow">
      <feDropShadow dx="0" dy="2" stdDeviation="4" flood-opacity="0.3"/>
    </filter>
  </defs>

  <!-- 背景 -->
  <rect width="1200" height="630" fill="url(#bg-gradient)"/>

  <!-- グリッドパターン（装飾） -->
  <defs>
    <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
      <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(255,255,255,0.02)" stroke-width="1"/>
    </pattern>
  </defs>
  <rect width="1200" height="630" fill="url(#grid)"/>

  <!-- メインカード -->
  <rect x="80" y="80" width="1040" height="470" rx="16" fill="#1e293b" opacity="0.8" filter="url(#shadow)"/>

  <!-- アバター背景 -->
  <circle cx="180" cy="315" r="100" fill="#334155"/>

  <!-- アバター画像 -->
  <clipPath id="avatar-clip">
    <circle cx="180" cy="315" r="90"/>
  </clipPath>
  <image
    href="${avatarUrl}"
    x="90"
    y="225"
    width="180"
    height="180"
    clip-path="url(#avatar-clip)"
  />

  <!-- テキストエリア -->
  <g transform="translate(320, 200)">
    <!-- 表示名 -->
    <text
      x="0"
      y="0"
      font-family="system-ui, -apple-system, sans-serif"
      font-size="56"
      font-weight="700"
      fill="#f1f5f9"
    >${displayName}</text>

    <!-- MCID -->
    <text
      x="0"
      y="50"
      font-family="system-ui, -apple-system, sans-serif"
      font-size="28"
      fill="#94a3b8"
    >@${mcid}</text>

    <!-- バッジ -->
    <g transform="translate(0, 90)">
      ${data.role ? `
      <rect x="0" y="0" width="${roleLabel.length * 12 + 24}" height="32" rx="16" fill="#3b82f6"/>
      <text
        x="${roleLabel.length * 6 + 12}"
        y="22"
        font-family="system-ui, -apple-system, sans-serif"
        font-size="16"
        font-weight="600"
        fill="white"
        text-anchor="middle"
      >${roleLabel}</text>
      ` : ''}

      ${data.mainEdition ? `
      <rect x="${data.role ? roleLabel.length * 12 + 36 : 0}" y="0" width="${editionLabel.length * 10 + 24}" height="32" rx="16" fill="#64748b"/>
      <text
        x="${(data.role ? roleLabel.length * 12 + 36 : 0) + editionLabel.length * 5 + 12}"
        y="22"
        font-family="system-ui, -apple-system, sans-serif"
        font-size="16"
        font-weight="600"
        fill="white"
        text-anchor="middle"
      >${editionLabel}</text>
      ` : ''}
    </g>

    <!-- Bio -->
    <text
      x="0"
      y="160"
      font-family="system-ui, -apple-system, sans-serif"
      font-size="24"
      fill="#cbd5e1"
    >${bio}</text>
  </g>

  <!-- フッター -->
  <g transform="translate(80, 580)">
    <text
      x="0"
      y="0"
      font-family="system-ui, -apple-system, sans-serif"
      font-size="20"
      font-weight="600"
      fill="#64748b"
    >MINEFOLIO</text>

    <text
      x="1040"
      y="0"
      font-family="system-ui, -apple-system, sans-serif"
      font-size="18"
      fill="#64748b"
      text-anchor="end"
    >Minecraft Speedrunning Portfolio</text>
  </g>
</svg>`;
}

/**
 * XML/SVG用のエスケープ処理
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
