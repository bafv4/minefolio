// ガイドエディタの共有型定義。
import type { Editor } from "@tiptap/core";
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

/**
 * スラッシュコマンドが必要とする宿主（index.tsx）側のダイアログ操作。
 * 即時挿入できない項目（画像 / YouTube / リンク / 埋め込み / ガイドリンク）が利用する。
 */
export interface SlashCommandContext {
  /** 画像ファイル選択を開く */
  openImagePicker: () => void;
  /** YouTube URL を入力して挿入 */
  insertYoutube: () => void;
  /** リンクを入力して挿入 */
  insertLink: () => void;
  /** 埋め込み入力ダイアログを開く */
  openEmbedDialog: (kind: "keybind" | "searchcraft") => void;
  /** ガイドリンク検索ダイアログを開く */
  openGuideLinkSearch: () => void;
}

/** スラッシュコマンドの 1 項目 */
export interface SlashItem {
  /** 表示名 */
  title: string;
  /** 検索用キーワード（日英、部分一致） */
  keywords: string[];
  /** アイコン */
  icon: LucideIcon;
  /** グループ見出し（基本ブロック / 埋め込み 等） */
  group: string;
  /**
   * 実行ハンドラ。スラッシュ範囲は呼び出し側で削除済み。
   * 即時挿入は editor を、ダイアログ起動は ctx を使う。
   */
  run: (editor: Editor, ctx: SlashCommandContext) => void;
}
