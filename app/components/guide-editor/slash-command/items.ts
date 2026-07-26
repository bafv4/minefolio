// スラッシュコマンドの項目定義。挿入は lib/block-commands に委譲し、
// 入力を要する項目（画像/動画/リンク/埋め込み/ガイドリンク）は ctx 経由でダイアログを開く。
import {
  Type,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Quote,
  Terminal,
  Lightbulb,
  ChevronRight,
  Table2,
  Minus,
  Columns2,
  Columns3,
  ImageIcon,
  Film,
  Youtube as YoutubeIcon,
  Link as LinkIcon,
  FileText,
  Keyboard,
  Package,
} from "lucide-react";
import type { SlashItem, SlashItemDef } from "../types";
import type { MessageKey, Translator } from "@/lib/messages";
import {
  setBlockType,
  insertTable,
  insertHorizontalRule,
  insertColumns,
} from "../lib/block-commands";

/** グループ見出し（翻訳キー。表示時に解決する） */
const GROUP: Record<string, MessageKey> = {
  basic: "guideEditor.slash.groupBasic",
  list: "guideEditor.slash.groupList",
  advanced: "guideEditor.slash.groupAdvanced",
  media: "guideEditor.slash.groupMedia",
  embed: "guideEditor.slash.groupEmbed",
};

/**
 * 項目定義。文言はキーのまま持ち、`filterSlashItems` が描画用に解決する
 * （モジュール評価時点ではロケールが未確定のため）。
 */
export const SLASH_ITEM_DEFS: SlashItemDef[] = [
  // 基本ブロック
  {
    titleKey: "guideEditor.slash.text",
    keywords: ["text", "paragraph", "てきすと", "段落"],
    icon: Type,
    groupKey: GROUP.basic,
    run: (editor) => setBlockType(editor, "paragraph"),
  },
  {
    titleKey: "guideEditor.slash.heading1",
    keywords: ["h1", "heading", "みだし", "見出し"],
    icon: Heading1,
    groupKey: GROUP.basic,
    run: (editor) => setBlockType(editor, "heading1"),
  },
  {
    titleKey: "guideEditor.slash.heading2",
    keywords: ["h2", "heading", "みだし", "見出し"],
    icon: Heading2,
    groupKey: GROUP.basic,
    run: (editor) => setBlockType(editor, "heading2"),
  },
  {
    titleKey: "guideEditor.slash.heading3",
    keywords: ["h3", "heading", "みだし", "見出し"],
    icon: Heading3,
    groupKey: GROUP.basic,
    run: (editor) => setBlockType(editor, "heading3"),
  },
  {
    titleKey: "guideEditor.slash.quote",
    keywords: ["quote", "blockquote", "いんよう", "引用"],
    icon: Quote,
    groupKey: GROUP.basic,
    run: (editor) => setBlockType(editor, "blockquote"),
  },
  {
    titleKey: "guideEditor.slash.codeBlock",
    keywords: ["code", "codeblock", "こーど", "コード"],
    icon: Terminal,
    groupKey: GROUP.basic,
    run: (editor) => setBlockType(editor, "codeBlock"),
  },

  // リスト
  {
    titleKey: "guideEditor.slash.bulletList",
    keywords: ["bullet", "list", "ul", "かじょう", "箇条書き"],
    icon: List,
    groupKey: GROUP.list,
    run: (editor) => setBlockType(editor, "bulletList"),
  },
  {
    titleKey: "guideEditor.slash.orderedList",
    keywords: ["ordered", "number", "ol", "ばんごう", "番号"],
    icon: ListOrdered,
    groupKey: GROUP.list,
    run: (editor) => setBlockType(editor, "orderedList"),
  },

  // 高度なブロック
  {
    titleKey: "guideEditor.slash.callout",
    keywords: ["callout", "note", "tip", "こーるあうと", "注釈"],
    icon: Lightbulb,
    groupKey: GROUP.advanced,
    run: (editor) => setBlockType(editor, "callout"),
  },
  {
    titleKey: "guideEditor.slash.toggleList",
    keywords: ["toggle", "details", "とぐる", "折りたたみ"],
    icon: ChevronRight,
    groupKey: GROUP.advanced,
    run: (editor) => setBlockType(editor, "toggleList"),
  },
  {
    titleKey: "guideEditor.slash.table",
    keywords: ["table", "ひょう", "表", "テーブル"],
    icon: Table2,
    groupKey: GROUP.advanced,
    run: (editor) => insertTable(editor),
  },
  {
    titleKey: "guideEditor.slash.divider",
    keywords: ["divider", "hr", "rule", "くぎり", "区切り"],
    icon: Minus,
    groupKey: GROUP.advanced,
    run: (editor) => insertHorizontalRule(editor),
  },
  {
    titleKey: "guideEditor.slash.columns2",
    keywords: ["columns", "2col", "だんぐみ", "段組"],
    icon: Columns2,
    groupKey: GROUP.advanced,
    run: (editor) => insertColumns(editor, 2),
  },
  {
    titleKey: "guideEditor.slash.columns3",
    keywords: ["columns", "3col", "だんぐみ", "段組"],
    icon: Columns3,
    groupKey: GROUP.advanced,
    run: (editor) => insertColumns(editor, 3),
  },

  // メディア
  {
    titleKey: "guideEditor.slash.image",
    keywords: ["image", "picture", "がぞう", "画像"],
    icon: ImageIcon,
    groupKey: GROUP.media,
    run: (_editor, ctx) => ctx.openImagePicker(),
  },
  {
    titleKey: "guideEditor.slash.gifFromVideo",
    keywords: ["gif", "video", "movie", "じふ", "動画", "変換", "アニメ"],
    icon: Film,
    groupKey: GROUP.media,
    run: (_editor, ctx) => ctx.openVideoToGif(),
  },
  {
    titleKey: "guideEditor.slash.youtube",
    keywords: ["youtube", "video", "どうが", "動画"],
    icon: YoutubeIcon,
    groupKey: GROUP.media,
    run: (_editor, ctx) => ctx.insertYoutube(),
  },
  {
    titleKey: "guideEditor.slash.link",
    keywords: ["link", "url", "りんく", "リンク"],
    icon: LinkIcon,
    groupKey: GROUP.media,
    run: (_editor, ctx) => ctx.insertLink(),
  },

  // 埋め込み
  {
    titleKey: "guideEditor.slash.guideLink",
    keywords: ["guide", "link", "がいど", "ガイド"],
    icon: FileText,
    groupKey: GROUP.embed,
    run: (_editor, ctx) => ctx.openGuideLinkSearch(),
  },
  {
    titleKey: "guideEditor.slash.keybindEmbed",
    keywords: ["keybind", "remap", "きーばいんど", "リマップ"],
    icon: Keyboard,
    groupKey: GROUP.embed,
    run: (_editor, ctx) => ctx.openEmbedDialog("keybind"),
  },
  {
    titleKey: "guideEditor.slash.searchCraftEmbed",
    keywords: ["searchcraft", "search", "さーちくらふと"],
    icon: Package,
    groupKey: GROUP.embed,
    run: (_editor, ctx) => ctx.openEmbedDialog("searchcraft"),
  },
];

/** 定義を表示用（文言解決済み）に変換する */
function resolveItem(def: SlashItemDef, t: Translator): SlashItem {
  const { titleKey, groupKey, ...rest } = def;
  return { ...rest, title: t(titleKey), group: t(groupKey) };
}

/** クエリで項目を絞り込む（タイトル + キーワードの部分一致、大小無視） */
export function filterSlashItems(query: string, t: Translator): SlashItem[] {
  const items = SLASH_ITEM_DEFS.map((def) => resolveItem(def, t));
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter((item) => {
    if (item.title.toLowerCase().includes(q)) return true;
    return item.keywords.some((k) => k.toLowerCase().includes(q));
  });
}
