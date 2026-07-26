// ガイドエディタの共有型定義。
import type { Editor } from "@tiptap/core";
import type { LucideIcon } from "lucide-react";
import type { CropRect } from "./lib/image-crop";

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
  /** 読み込み時に未コミットのドラフトが存在したか */
  initialHasDraft: boolean;
  /** 公開版のスナップショット（ドラフトを破棄して公開版へロールバックするのに使う） */
  publishedSnapshot: GuidePublishedSnapshot;
  authorSlug: string;
  guideSlug: string;
}

/** 公開版の各フィールド（ロールバック用） */
export interface GuidePublishedSnapshot {
  title: string;
  summary: string;
  content: string;
  coverImageUrl: string | null;
  tags: string[];
  isPublished: boolean;
}

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
  /** 動画から GIF を作るダイアログを開く */
  openVideoToGif: () => void;
}

/**
 * 画像 NodeView が必要とする宿主（index.tsx）側のメディア操作。
 * NodeView は Tiptap が描画するため props を直接渡せず、スラッシュコマンドと
 * 同じく editor.storage 経由で注入する（extensions/image.ts の setImageMediaContext）。
 */
export interface GuideMediaContext {
  /**
   * src の画像を rect で切り出してアップロードし、新しい公開 URL を返す。
   * 失敗時は null（エラー表示は実装側が行う）。
   */
  cropImage: (src: string, rect: CropRect) => Promise<string | null>;
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
