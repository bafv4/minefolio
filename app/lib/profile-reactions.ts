// プロフィール絵文字リアクションの定数・型（非 .server）。
//
// クライアント（パレット描画・aria ラベル生成）とサーバー（許可リスト検証）の
// 両方から import されるため、Request/DB に依存しないモジュールに置く
// （app/lib/game-languages.ts などと同じ立て付け）。
//
// 8種は Discord の定番リアクションに合わせた固定セット。❤️ は Unicode の
// バリエーションセレクタ16（U+FE0F）付きで定数化する。VS16 なしの "❤"（U+2764 単体）は
// 別バイト列として扱い、許可リスト外＝400 にする（絵文字の正規化揺れを
// 「完全一致のみ許可」で構造的に排除する。docs/profile-reactions.md 参照）。
export const PROFILE_REACTION_EMOJIS = [
  "👍",
  "❤️",
  "😂",
  "😮",
  "😢",
  "🎉",
  "🔥",
  "💯",
] as const;

export type ProfileReactionEmoji = (typeof PROFILE_REACTION_EMOJIS)[number];

/**
 * aria-label 等の i18n キー接尾辞（emoji.<key>）。PROFILE_REACTION_EMOJIS と同じ並び順で対応する。
 */
export const PROFILE_REACTION_EMOJI_KEYS = [
  "thumbsUp",
  "heart",
  "joy",
  "wow",
  "cry",
  "tada",
  "fire",
  "hundred",
] as const;

const PROFILE_REACTION_EMOJI_SET: ReadonlySet<string> = new Set(PROFILE_REACTION_EMOJIS);

/**
 * 許可リストとの完全一致判定。NFC 正規化などは行わない
 * （DB に入ってよいのはこの8種の正確なバイト列のみという方針のため、
 * 揺れを許容せずそのまま Set 比較する）。
 */
export function isProfileReactionEmoji(value: string): value is ProfileReactionEmoji {
  return PROFILE_REACTION_EMOJI_SET.has(value);
}

/** プロフィール1件の絵文字別カウント（0件の絵文字は含まない）。 */
export interface ProfileReactionCount {
  emoji: ProfileReactionEmoji;
  count: number;
}
