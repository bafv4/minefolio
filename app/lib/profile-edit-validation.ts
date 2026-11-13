// /me/edit の入力検証（クライアントのダイアログ確定時とサーバー action の両方が同じ規則を使う）。
// 純関数のみ。文言は翻訳キーで返し、呼び出し側が自分の Translator で解決する。
import type { MessageKey } from "@/lib/messages";
import { getYouTubeVideoId } from "@/lib/youtube-url";
import { isHttpUrl } from "@/lib/safe-url";

// schema.ts（drizzle）をクライアントバンドルへ入れないため、schema の socialLinks.platform の enum と同じ値を持つ。
// 一致はテスト（profile-edit-draft.test.ts）で保証する
export const SOCIAL_PLATFORMS: readonly string[] = ["speedruncom", "youtube", "twitch", "twitter", "custom"];

/** 動画欄の最大件数 */
export const MAX_PROFILE_VIDEOS = 10;

/** 新規動画を order 配列で参照するときのプレフィックス（`new:<clientKey>`） */
export const NEW_VIDEO_ORDER_PREFIX = "new:";

export type LinkPayload = {
  platform: string;
  identifier: string;
  customLabel: string | null;
  customUrl: string | null;
};

export type VideoPayload = {
  url: string;
  title: string | null;
  isPinned: boolean;
};

export type McidOp = { op: "set"; value: string } | { op: "remove" };

/** 保存バーの一括保存で action へ送る差分（FormData の `changes` に JSON で載せる） */
export type ProfileChanges = {
  mcid?: McidOp;
  bedrockMcid?: McidOp;
  links?: {
    create?: ({ key: string } & LinkPayload)[];
    update?: ({ id: string } & LinkPayload)[];
    delete?: string[];
  };
  videos?: {
    create?: ({ key: string } & VideoPayload)[];
    update?: ({ id: string } & VideoPayload)[];
    delete?: string[];
    /** 最終的な並び。既存は id、新規は `new:<key>`。未掲載の既存は元の順で後ろへ */
    order?: string[];
  };
};

/** 一括保存の検証エラー（キーはドラフト項目の key。既存項目は id と同じ） */
export type ProfileFieldErrors = {
  mcid?: string;
  bedrockMcid?: string;
  links?: Record<string, string>;
  videos?: Record<string, string>;
};

/** ソーシャルリンク1件の検証。問題が無ければ null */
export function validateLinkInput(input: LinkPayload): MessageKey | null {
  const { platform, identifier, customLabel, customUrl } = input;

  if (!platform || !identifier) return "meEdit.platformAndIdRequired";
  if (!SOCIAL_PLATFORMS.includes(platform)) return "meEdit.invalidOption";
  if (identifier.length > 100) return "meEdit.idMaxLength";

  if (platform === "custom") {
    // カスタムSNSはラベルとURLが必須
    if (!customLabel) return "meEdit.customLabelRequired";
    if (!customUrl) return "meEdit.customUrlRequired";
    try {
      new URL(customUrl);
    } catch {
      return "meEdit.customUrlInvalid";
    }
    // javascript: / data: 等の実行可能スキームを拒否（stored XSS 対策。http/https のみ許可）
    if (!isHttpUrl(customUrl)) return "meEdit.customUrlScheme";
  } else if (platform === "youtube") {
    // YouTubeハンドルは日本語などUnicode文字を許可。空白、@、URL特殊文字は禁止
    if (/[\s@#$%^&*()+=\[\]{}|\\;:'",<>/?]/.test(identifier)) return "meEdit.idInvalidChars";
  } else {
    // 英数字、ハイフン、アンダースコアのみ許可（@と.は除外）
    if (!/^[\w\-]+$/.test(identifier)) return "meEdit.idAllowedChars";
  }
  return null;
}

/** 動画1件の検証。問題が無ければ null */
export function validateVideoInput(input: VideoPayload): MessageKey | null {
  if (!input.url) return "meEdit.videoUrlRequired";
  // 動画IDを解決できないURLは登録不可（埋め込み時の X-Frame-Options ブロック防止）
  if (!getYouTubeVideoId(input.url)) return "meEdit.videoUrlInvalid";
  if (input.title && input.title.length > 100) return "meEdit.videoTitleMaxLength";
  return null;
}

/** Java 版 MCID の形式検証（Mojang 照合の前段） */
export function validateMcidFormat(mcid: string): MessageKey | null {
  if (!mcid) return "meEdit.mcidRequired";
  if (mcid.length < 3 || mcid.length > 16) return "meEdit.mcidLength";
  return null;
}

/** Bedrock 版 MCID（自己申告）の形式検証 */
export function validateBedrockMcidFormat(value: string): MessageKey | null {
  if (!value) return "meEdit.bedrockMcidRequired";
  // Xboxゲーマータグは最大12文字だが、新形式の `#1234` サフィックスまで許容する
  if (value.length < 3 || value.length > 24) return "meEdit.bedrockMcidLength";
  // 制御文字（改行・タブ等）のみ拒否し、それ以外の文字種は制限しない
  if (/[\u0000-\u001f\u007f]/.test(value)) return "meEdit.bedrockMcidInvalid";
  return null;
}
