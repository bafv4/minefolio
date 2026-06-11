// テーブルセル / ヘッダー拡張。background-color / color の style 合成（順序維持）。
// 旧 index.tsx CustomTableCell / CustomTableHeader から逐語移植。
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";

export const CustomTableCell = TableCell.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      backgroundColor: {
        default: null,
        parseHTML: (element: HTMLElement) => element.style.backgroundColor || null,
        renderHTML: (attributes: Record<string, string | null>) => {
          if (!attributes.backgroundColor) return {};
          return { style: `background-color: ${attributes.backgroundColor}` };
        },
      },
      textColor: {
        default: null,
        parseHTML: (element: HTMLElement) => element.style.color || null,
        renderHTML: (attributes: Record<string, string | null>) => {
          const styles: string[] = [];
          if (attributes.backgroundColor) styles.push(`background-color: ${attributes.backgroundColor}`);
          if (attributes.textColor) styles.push(`color: ${attributes.textColor}`);
          return styles.length ? { style: styles.join("; ") } : {};
        },
      },
    };
  },
});

export const CustomTableHeader = TableHeader.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      backgroundColor: {
        default: null,
        parseHTML: (element: HTMLElement) => element.style.backgroundColor || null,
        renderHTML: (attributes: Record<string, string | null>) => {
          if (!attributes.backgroundColor) return {};
          return { style: `background-color: ${attributes.backgroundColor}` };
        },
      },
      textColor: {
        default: null,
        parseHTML: (element: HTMLElement) => element.style.color || null,
        renderHTML: (attributes: Record<string, string | null>) => {
          const styles: string[] = [];
          if (attributes.backgroundColor) styles.push(`background-color: ${attributes.backgroundColor}`);
          if (attributes.textColor) styles.push(`color: ${attributes.textColor}`);
          return styles.length ? { style: styles.join("; ") } : {};
        },
      },
    };
  },
});
