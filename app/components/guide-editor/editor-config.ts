// エディタ拡張セットの組み立て（純関数）。
// useEditor と round-trip テストの双方から同一の拡張配列を得るための単一ソース。
// 旧 index.tsx useEditor.extensions を逐語移植し、外出しした各拡張を import で合成する。
import type { Extensions } from "@tiptap/core";
import { StarterKit } from "@tiptap/starter-kit";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { Link as Link2 } from "@tiptap/extension-link";
import { Placeholder } from "@tiptap/extension-placeholder";
import { Color } from "@tiptap/extension-color";
import { TextStyle } from "@tiptap/extension-text-style";
import { Highlight } from "@tiptap/extension-highlight";
import { CustomCodeBlock } from "./extensions/code-block";
import { CustomTableCell, CustomTableHeader } from "./extensions/table";
import { CustomImage } from "./extensions/image";
import { CustomYoutube } from "./extensions/youtube";
import { CalloutExtension } from "./extensions/callout";
import { ToggleListExtension } from "./extensions/toggle-list";
import { GuideLinkExtension } from "./extensions/guide-link";
import { KeybindEmbedExtension } from "./extensions/keybind-embed";
import { SearchCraftEmbedExtension } from "./extensions/searchcraft-embed";
import { ColumnsExtension, ColumnExtension } from "./extensions/columns";

/**
 * エディタの拡張配列を構築する。
 * @param placeholder プレースホルダー文言。テスト等で省略時は空文字。
 */
export function buildExtensions(placeholder = ""): Extensions {
  return [
    // StarterKit 3 は link を内包する。独自設定の Link2 を権威とするため無効化
    // （旧実装の "Duplicate extension names: link" 警告を解消。出力は不変）。
    StarterKit.configure({ codeBlock: false, link: false }),
    CustomCodeBlock,
    Table.configure({ resizable: true }),
    TableRow,
    CustomTableCell,
    CustomTableHeader,
    CustomImage,
    Link2.configure({ openOnClick: false, autolink: true }),
    Placeholder.configure({ placeholder }),
    CustomYoutube,
    TextStyle,
    Color,
    Highlight.configure({ multicolor: true }),
    CalloutExtension,
    ToggleListExtension,
    GuideLinkExtension,
    KeybindEmbedExtension,
    SearchCraftEmbedExtension,
    ColumnsExtension,
    ColumnExtension,
  ];
}
