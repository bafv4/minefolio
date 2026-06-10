// ガイドエディタの共有型定義。
import type { Editor, Range } from "@tiptap/core";
import type { LucideIcon } from "lucide-react";

/** GuideEditor の props（旧 index.tsx と完全に同一 — ルート I/O 不変） */
export interface GuideEditorProps {
  guideId: string;
  userId: string;
  initialTitle: string;
  initialContent: string;
  initialSummary: string;
  initialTags: string[];
  initialIsPublished: boolean;
  initialCoverImageUrl: string | null;
  authorSlug: string;
  guideSlug: string;
}

/** オートセーブの状態 */
export type SaveStatus = "saved" | "saving" | "unsaved";

/** スラッシュコマンドの 1 項目 */
export interface SlashItem {
  /** 表示名 */
  title: string;
  /** 検索用キーワード（日英、前方一致） */
  keywords: string[];
  /** アイコン */
  icon: LucideIcon;
  /** グループ見出し（基本ブロック / 埋め込み 等） */
  group: string;
  /** 実行ハンドラ。range は "/" を含む挿入範囲 */
  run: (editor: Editor, range: Range) => void;
}
