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

/** ソーシャルリンクの最大件数（画面に上限は無い。悪用防止の水準で、1回の保存で作成できる件数の上限と揃える） */
export const MAX_SOCIAL_LINKS = 50;

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

/** プロフィール文字列欄の最大文字数・MCID 長（入力欄の maxLength とサーバー検証の単一情報源） */
export const PROFILE_FIELD_LIMITS = {
  displayName: 50,
  displayNameAlphabet: 50,
  bio: 500,
  location: 100,
  shortBio: 50,
  pronouns: 20,
  speedruncomUsername: 50,
  linkIdentifier: 100,
  /** カスタムリンクの表示名（画面に上限は無い。悪用防止の水準） */
  customLabel: 100,
  /** カスタムリンクの URL / 記録の動画 URL（画面に上限は無い。悪用防止の水準） */
  customUrl: 2000,
  recordVideoUrl: 2000,
  videoTitle: 100,
  mcidMin: 3,
  mcidMax: 16,
  bedrockMcidMin: 3,
  bedrockMcidMax: 24,
} as const;

/** 印字可能な ASCII のみ（英数字・空白・基本記号）。アルファベット表記の表示名の規則 */
export const PRINTABLE_ASCII_RE = /^[\x20-\x7E]+$/;

/** プロフィール文字列欄（trim・空→null 済み）の検証。問題が無ければ null。エラーキーは onboarding と /me/edit で共通 */
export function validateProfileTextFields(fields: {
  displayName: string | null;
  displayNameAlphabet: string | null;
  bio: string | null;
  location: string | null;
  shortBio: string | null;
  pronouns: string | null;
}): MessageKey | null {
  const { displayName, displayNameAlphabet, bio, location, shortBio, pronouns } = fields;
  const limits = PROFILE_FIELD_LIMITS;
  if (displayName && displayName.length > limits.displayName) return "meEdit.displayNameMax";
  if (displayNameAlphabet && displayNameAlphabet.length > limits.displayNameAlphabet) {
    return "meEdit.displayNameAlphabetMax";
  }
  if (displayNameAlphabet && !PRINTABLE_ASCII_RE.test(displayNameAlphabet)) {
    return "meEdit.displayNameAlphabetInvalid";
  }
  if (bio && bio.length > limits.bio) return "meEdit.bioMax";
  if (location && location.length > limits.location) return "meEdit.locationMax";
  if (shortBio && shortBio.length > limits.shortBio) return "meEdit.shortBioMax";
  if (pronouns && pronouns.length > limits.pronouns) return "meEdit.pronounsMax";
  return null;
}

/**
 * 今回の保存で speedrun.com リンクに触れるか（作成 / 更新 / 削除。更新は旧・新どちらかが speedruncom）。
 * クライアント（下書き）とサーバーが同じ判定を使う。食い違うと speedruncomUsername が逆向きに同期される。
 * `platformOf` は既存リンク id → 保存済みの platform
 */
export function linksTouchSpeedrun(
  links: {
    create?: { platform: string }[];
    update?: { id: string; platform: string }[];
    delete?: string[];
  },
  platformOf: (id: string) => string | undefined,
): boolean {
  return (
    (links.create ?? []).some((l) => l.platform === "speedruncom") ||
    (links.update ?? []).some((l) => l.platform === "speedruncom" || platformOf(l.id) === "speedruncom") ||
    (links.delete ?? []).some((id) => platformOf(id) === "speedruncom")
  );
}

/** ソーシャルリンク1件の検証。問題が無ければ null */
export function validateLinkInput(input: LinkPayload): MessageKey | null {
  const { platform, identifier, customLabel, customUrl } = input;

  if (!platform || !identifier) return "meEdit.platformAndIdRequired";
  if (!SOCIAL_PLATFORMS.includes(platform)) return "meEdit.invalidOption";
  if (identifier.length > PROFILE_FIELD_LIMITS.linkIdentifier) return "meEdit.idMaxLength";

  if (platform === "custom") {
    // カスタムSNSはラベルとURLが必須
    if (!customLabel) return "meEdit.customLabelRequired";
    if (!customUrl) return "meEdit.customUrlRequired";
    if (customLabel.length > PROFILE_FIELD_LIMITS.customLabel) return "meEdit.customLabelMax";
    if (customUrl.length > PROFILE_FIELD_LIMITS.customUrl) return "meEdit.customUrlMax";
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
  if (input.title && input.title.length > PROFILE_FIELD_LIMITS.videoTitle) return "meEdit.videoTitleMaxLength";
  return null;
}

/** Java 版 MCID の形式検証（Mojang 照合の前段） */
export function validateMcidFormat(mcid: string): MessageKey | null {
  if (!mcid) return "meEdit.mcidRequired";
  if (mcid.length < PROFILE_FIELD_LIMITS.mcidMin || mcid.length > PROFILE_FIELD_LIMITS.mcidMax) return "meEdit.mcidLength";
  return null;
}

/** Bedrock 版 MCID（自己申告）の形式検証 */
export function validateBedrockMcidFormat(value: string): MessageKey | null {
  if (!value) return "meEdit.bedrockMcidRequired";
  // Xboxゲーマータグは最大12文字だが、新形式の `#1234` サフィックスまで許容する
  if (value.length < PROFILE_FIELD_LIMITS.bedrockMcidMin || value.length > PROFILE_FIELD_LIMITS.bedrockMcidMax) {
    return "meEdit.bedrockMcidLength";
  }
  // 制御文字（改行・タブ等）のみ拒否し、それ以外の文字種は制限しない
  if (/[\u0000-\u001f\u007f]/.test(value)) return "meEdit.bedrockMcidInvalid";
  return null;
}
