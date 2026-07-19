// YouTube URL の解析ユーティリティ（クライアント/サーバー共用）。
// 視聴ページURLをそのまま iframe に埋め込むと X-Frame-Options で
// ブラウザにブロックされる（Firefoxの「このページを開けません」）ため、
// 必ずここで /embed/ 形式へ変換し、変換できないURLは埋め込まないこと。

// YouTube動画IDは通常11文字の [A-Za-z0-9_-]。将来の変動に備えて幅を持たせる
const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{5,20}$/;

/**
 * YouTube URL から動画IDを抽出する。抽出できない場合は null。
 * 対応形式: watch?v= / youtu.be/ / live/ / shorts/ / embed/ / v/
 * （www. / m. / music. サブドメイン、youtube-nocookie.com を含む）
 */
export function getYouTubeVideoId(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;

  const host = parsed.hostname.toLowerCase().replace(/^(www|m|music)\./, "");
  let candidate: string | null = null;

  if (host === "youtu.be") {
    candidate = parsed.pathname.split("/").filter(Boolean)[0] ?? null;
  } else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    const segments = parsed.pathname.split("/").filter(Boolean);
    const vParam = parsed.searchParams.get("v");
    if (vParam) {
      candidate = vParam;
    } else if (segments.length >= 2 && ["live", "shorts", "embed", "v"].includes(segments[0])) {
      candidate = segments[1];
    }
  }

  return candidate && VIDEO_ID_PATTERN.test(candidate) ? candidate : null;
}

/** 埋め込み用URL。変換できないURLは null（生URLを iframe に渡してはならない） */
export function getYouTubeEmbedUrl(url: string): string | null {
  const videoId = getYouTubeVideoId(url);
  return videoId ? `https://www.youtube.com/embed/${videoId}` : null;
}

/** サムネイル画像URL。動画IDを解決できない場合は null */
export function getYouTubeThumbnailUrl(url: string): string | null {
  const videoId = getYouTubeVideoId(url);
  return videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : null;
}
