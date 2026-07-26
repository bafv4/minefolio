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
import type { SlashItem } from "../types";
import {
  setBlockType,
  insertTable,
  insertHorizontalRule,
  insertColumns,
} from "../lib/block-commands";

/** グループ見出し */
const GROUP = {
  basic: "基本ブロック",
  list: "リスト",
  advanced: "高度なブロック",
  media: "メディア",
  embed: "埋め込み",
} as const;

export const SLASH_ITEMS: SlashItem[] = [
  // 基本ブロック
  {
    title: "テキスト",
    keywords: ["text", "paragraph", "てきすと", "段落"],
    icon: Type,
    group: GROUP.basic,
    run: (editor) => setBlockType(editor, "paragraph"),
  },
  {
    title: "見出し 1",
    keywords: ["h1", "heading", "みだし", "見出し"],
    icon: Heading1,
    group: GROUP.basic,
    run: (editor) => setBlockType(editor, "heading1"),
  },
  {
    title: "見出し 2",
    keywords: ["h2", "heading", "みだし", "見出し"],
    icon: Heading2,
    group: GROUP.basic,
    run: (editor) => setBlockType(editor, "heading2"),
  },
  {
    title: "見出し 3",
    keywords: ["h3", "heading", "みだし", "見出し"],
    icon: Heading3,
    group: GROUP.basic,
    run: (editor) => setBlockType(editor, "heading3"),
  },
  {
    title: "引用",
    keywords: ["quote", "blockquote", "いんよう", "引用"],
    icon: Quote,
    group: GROUP.basic,
    run: (editor) => setBlockType(editor, "blockquote"),
  },
  {
    title: "コードブロック",
    keywords: ["code", "codeblock", "こーど", "コード"],
    icon: Terminal,
    group: GROUP.basic,
    run: (editor) => setBlockType(editor, "codeBlock"),
  },

  // リスト
  {
    title: "箇条書き",
    keywords: ["bullet", "list", "ul", "かじょう", "箇条書き"],
    icon: List,
    group: GROUP.list,
    run: (editor) => setBlockType(editor, "bulletList"),
  },
  {
    title: "番号付きリスト",
    keywords: ["ordered", "number", "ol", "ばんごう", "番号"],
    icon: ListOrdered,
    group: GROUP.list,
    run: (editor) => setBlockType(editor, "orderedList"),
  },

  // 高度なブロック
  {
    title: "コールアウト",
    keywords: ["callout", "note", "tip", "こーるあうと", "注釈"],
    icon: Lightbulb,
    group: GROUP.advanced,
    run: (editor) => setBlockType(editor, "callout"),
  },
  {
    title: "トグルリスト",
    keywords: ["toggle", "details", "とぐる", "折りたたみ"],
    icon: ChevronRight,
    group: GROUP.advanced,
    run: (editor) => setBlockType(editor, "toggleList"),
  },
  {
    title: "表",
    keywords: ["table", "ひょう", "表", "テーブル"],
    icon: Table2,
    group: GROUP.advanced,
    run: (editor) => insertTable(editor),
  },
  {
    title: "区切り線",
    keywords: ["divider", "hr", "rule", "くぎり", "区切り"],
    icon: Minus,
    group: GROUP.advanced,
    run: (editor) => insertHorizontalRule(editor),
  },
  {
    title: "2 カラム",
    keywords: ["columns", "2col", "だんぐみ", "段組"],
    icon: Columns2,
    group: GROUP.advanced,
    run: (editor) => insertColumns(editor, 2),
  },
  {
    title: "3 カラム",
    keywords: ["columns", "3col", "だんぐみ", "段組"],
    icon: Columns3,
    group: GROUP.advanced,
    run: (editor) => insertColumns(editor, 3),
  },

  // メディア
  {
    title: "画像",
    keywords: ["image", "picture", "がぞう", "画像"],
    icon: ImageIcon,
    group: GROUP.media,
    run: (_editor, ctx) => ctx.openImagePicker(),
  },
  {
    title: "GIF（動画から変換）",
    keywords: ["gif", "video", "movie", "じふ", "動画", "変換", "アニメ"],
    icon: Film,
    group: GROUP.media,
    run: (_editor, ctx) => ctx.openVideoToGif(),
  },
  {
    title: "YouTube",
    keywords: ["youtube", "video", "どうが", "動画"],
    icon: YoutubeIcon,
    group: GROUP.media,
    run: (_editor, ctx) => ctx.insertYoutube(),
  },
  {
    title: "リンク",
    keywords: ["link", "url", "りんく", "リンク"],
    icon: LinkIcon,
    group: GROUP.media,
    run: (_editor, ctx) => ctx.insertLink(),
  },

  // 埋め込み
  {
    title: "ガイドリンク",
    keywords: ["guide", "link", "がいど", "ガイド"],
    icon: FileText,
    group: GROUP.embed,
    run: (_editor, ctx) => ctx.openGuideLinkSearch(),
  },
  {
    title: "キーバインド埋め込み",
    keywords: ["keybind", "remap", "きーばいんど", "リマップ"],
    icon: Keyboard,
    group: GROUP.embed,
    run: (_editor, ctx) => ctx.openEmbedDialog("keybind"),
  },
  {
    title: "サーチクラフト埋め込み",
    keywords: ["searchcraft", "search", "さーちくらふと"],
    icon: Package,
    group: GROUP.embed,
    run: (_editor, ctx) => ctx.openEmbedDialog("searchcraft"),
  },
];

/** クエリで項目を絞り込む（タイトル + キーワードの部分一致、大小無視） */
export function filterSlashItems(query: string): SlashItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return SLASH_ITEMS;
  return SLASH_ITEMS.filter((item) => {
    if (item.title.toLowerCase().includes(q)) return true;
    return item.keywords.some((k) => k.toLowerCase().includes(q));
  });
}
