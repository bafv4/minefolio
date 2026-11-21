// プロフィールの「未設定（NULL）」は既定値として扱う。既定値は全員同じで識別情報にならないため、
// カード（profile-feed-card.tsx）は表示せず、/browse の検索（browse-query.server.ts）は NULL も含めて絞る。
// 両者の解釈をそろえるため、既定値はここを単一情報源にする。
export const DEFAULT_PROFILE_ROLE = "runner";
export const DEFAULT_PROFILE_EDITION = "java";
export const DEFAULT_PROFILE_PLATFORM = "pc_windows";
export const DEFAULT_PROFILE_INPUT_METHOD = "keyboard_mouse";
