import {
  useState,
  useEffect,
  useCallback,
  useRef,
} from "react";
import { useFetcher, Link } from "react-router";
import {
  useEditor,
  EditorContent,
  NodeViewWrapper,
  NodeViewContent,
  ReactNodeViewRenderer,
} from "@tiptap/react";
import { Node as TiptapNode, mergeAttributes } from "@tiptap/core";
import { StarterKit } from "@tiptap/starter-kit";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { Image } from "@tiptap/extension-image";
import { Link as Link2 } from "@tiptap/extension-link";
import { CodeBlock } from "@tiptap/extension-code-block";
import { Placeholder } from "@tiptap/extension-placeholder";
import { Youtube } from "@tiptap/extension-youtube";
import { Color } from "@tiptap/extension-color";
import { TextStyle } from "@tiptap/extension-text-style";
import { Highlight } from "@tiptap/extension-highlight";
import { upload } from "@vercel/blob/client";
import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  Bold,
  Italic,
  Strikethrough,
  Code,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Link as LinkIcon,
  ImageIcon,
  Save,
  Loader2,
  Check,
  Globe,
  Lock,
  ArrowLeft,
  Table2,
  Quote,
  Minus,
  Undo2,
  Redo2,
  Youtube as YoutubeIcon,
  Trash2,
  AlertCircle,
  GripVertical,
  AlignLeft,
  Terminal,
  Palette,
  Lightbulb,
  Info,
  AlertTriangle,
  ChevronRight,
  Paintbrush,
  FileText,
  Search,
  X,
  Copy,
  ClipboardCheck,
  Scissors,
  ClipboardPaste,
  Columns2,
  Columns3,
  ImagePlus,
} from "lucide-react";
import { t } from "@/lib/messages";

interface GuideEditorProps {
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

// ─────────────────────────────────────────────
// Custom NodeViews (rendered inside ProseMirror)
// ─────────────────────────────────────────────

function ImageNodeView({
  node,
  deleteNode,
  updateAttributes,
  selected,
}: {
  node: { attrs: Record<string, string | number | null> };
  deleteNode: () => void;
  updateAttributes: (attrs: Record<string, unknown>) => void;
  selected: boolean;
}) {
  const [resizing, setResizing] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);

  const width = node.attrs.width ? Number(node.attrs.width) : undefined;

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!imgRef.current) return;
    setResizing(true);
    startXRef.current = e.clientX;
    startWidthRef.current = imgRef.current.offsetWidth;

    const onMove = (ev: MouseEvent) => {
      const diff = ev.clientX - startXRef.current;
      const newWidth = Math.max(100, startWidthRef.current + diff);
      updateAttributes({ width: newWidth });
    };
    const onUp = () => {
      setResizing(false);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [updateAttributes]);

  return (
    <NodeViewWrapper>
      <div className={cn("relative group my-2 inline-block", (selected || resizing) && "ring-2 ring-primary/50 rounded-lg")}>
        <img
          ref={imgRef}
          src={String(node.attrs.src)}
          alt={String(node.attrs.alt || "")}
          className="max-w-full rounded-lg"
          style={{ width: width ? `${width}px` : undefined }}
          draggable={false}
        />
        <button
          type="button"
          onMouseDown={(e) => {
            e.preventDefault();
            deleteNode();
          }}
          title="画像を削除"
          className="absolute top-2 right-2 h-7 w-7 flex items-center justify-center bg-black/60 text-white rounded-md opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
        {/* Resize handle */}
        <div
          onMouseDown={handleResizeStart}
          className="absolute right-0 bottom-0 w-4 h-4 cursor-se-resize opacity-0 group-hover:opacity-100 transition-opacity"
          style={{
            background: "linear-gradient(135deg, transparent 50%, var(--primary) 50%)",
            borderRadius: "0 0 0.5rem 0",
          }}
        />
        {width && (
          <span className="absolute bottom-1 left-1 text-[10px] text-white bg-black/50 rounded px-1 opacity-0 group-hover:opacity-100 transition-opacity">
            {width}px
          </span>
        )}
      </div>
    </NodeViewWrapper>
  );
}

function getYouTubeEmbedUrl(src: string): string {
  const match = src.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/))([^?&#]+)/);
  const id = match?.[1];
  if (id) return `https://www.youtube-nocookie.com/embed/${id}`;
  return src;
}

function YoutubeNodeView({
  node,
  deleteNode,
}: {
  node: { attrs: Record<string, string | number> };
  deleteNode: () => void;
}) {
  const embedUrl = getYouTubeEmbedUrl(String(node.attrs.src));

  return (
    <NodeViewWrapper>
      <div className="relative group my-4">
        <div className="relative pb-[56.25%] h-0 overflow-hidden rounded-lg">
          <iframe
            src={embedUrl}
            className="absolute top-0 left-0 w-full h-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            title="YouTube video"
          />
        </div>
        <button
          type="button"
          onMouseDown={(e) => {
            e.preventDefault();
            deleteNode();
          }}
          title="動画を削除"
          className="absolute top-2 right-2 h-7 w-7 flex items-center justify-center bg-black/60 text-white rounded-md opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </NodeViewWrapper>
  );
}

function CodeBlockNodeView({
  node,
  deleteNode,
  extension,
}: {
  node: { attrs: Record<string, string>; textContent: string };
  deleteNode: () => void;
  extension: { options: { exitOnTripleEnter: boolean } };
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(node.textContent).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [node.textContent]);

  return (
    <NodeViewWrapper>
      <div className="code-block-wrapper">
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={handleCopy}
          title="コピー"
          contentEditable={false}
          className="code-block-copy"
        >
          {copied ? (
            <ClipboardCheck className="h-3.5 w-3.5" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </button>
        <pre>
          {/* @ts-expect-error as="code" works at runtime */}
          <NodeViewContent as="code" />
        </pre>
      </div>
    </NodeViewWrapper>
  );
}

// ─────────────────────────────────────────────
// Color palette
// ─────────────────────────────────────────────

const TEXT_COLORS = [
  { name: "デフォルト", value: "" },
  { name: "グレー", value: "#787774" },
  { name: "赤", value: "#D44C47" },
  { name: "オレンジ", value: "#CB7B2C" },
  { name: "黄", value: "#998A2B" },
  { name: "緑", value: "#448361" },
  { name: "青", value: "#337EA9" },
  { name: "紫", value: "#9065B0" },
  { name: "ピンク", value: "#C14C8A" },
] as const;

const BG_COLORS = [
  { name: "なし", value: "" },
  { name: "グレー", value: "#F1F1EF" },
  { name: "赤", value: "#FDEBEC" },
  { name: "オレンジ", value: "#FBF3DB" },
  { name: "黄", value: "#FBF3DB" },
  { name: "緑", value: "#EDF3EC" },
  { name: "青", value: "#E7F3F8" },
  { name: "紫", value: "#F6F3F9" },
  { name: "ピンク", value: "#F9F0F5" },
] as const;

const CALLOUT_TYPES = [
  { type: "tip", icon: "💡", label: "ヒント" },
  { type: "info", icon: "ℹ️", label: "情報" },
  { type: "warning", icon: "⚠️", label: "警告" },
  { type: "danger", icon: "🚨", label: "危険" },
] as const;

const CALLOUT_ICONS: Record<string, string> = {
  tip: "💡", info: "ℹ️", warning: "⚠️", danger: "🚨",
};

// ─────────────────────────────────────────────
// Custom Tiptap Extensions
// ─────────────────────────────────────────────

// Callout Node
function CalloutNodeView({ node, updateAttributes }: {
  node: { attrs: Record<string, string> };
  updateAttributes: (attrs: Record<string, string>) => void;
}) {
  const calloutType = node.attrs.calloutType || "tip";
  const types = ["tip", "info", "warning", "danger"] as const;

  return (
    <NodeViewWrapper>
      <div className={`callout callout-${calloutType}`}>
        <button
          type="button"
          className="callout-icon"
          contentEditable={false}
          onMouseDown={(e) => {
            e.preventDefault();
            const idx = types.indexOf(calloutType as typeof types[number]);
            const next = types[(idx + 1) % types.length];
            updateAttributes({ calloutType: next });
          }}
          title="タイプ切替"
        >
          {CALLOUT_ICONS[calloutType] || "💡"}
        </button>
        <div className="callout-body">
          <NodeViewContent />
        </div>
      </div>
    </NodeViewWrapper>
  );
}

const CalloutExtension = TiptapNode.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,

  addAttributes() {
    return {
      calloutType: {
        default: "tip",
        parseHTML: (element: HTMLElement) => element.getAttribute("data-callout-type") || "tip",
        renderHTML: (attributes: Record<string, string>) => ({
          "data-callout": "",
          "data-callout-type": attributes.calloutType,
          class: `callout callout-${attributes.calloutType}`,
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-callout]" }];
  },

  renderHTML({ HTMLAttributes }: { HTMLAttributes: Record<string, unknown> }) {
    return ["div", mergeAttributes(HTMLAttributes), 0];
  },

  addNodeView() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return ReactNodeViewRenderer(CalloutNodeView as any);
  },

  // @ts-expect-error custom commands not in RawCommands
  addCommands() {
    return {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setCallout: (attrs?: { calloutType?: string }) => ({ commands }: any) => {
        return commands.wrapIn(this.name, attrs);
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      toggleCallout: (attrs?: { calloutType?: string }) => ({ commands, editor }: any) => {
        if (editor.isActive(this.name)) {
          return commands.lift(this.name);
        }
        return commands.wrapIn(this.name, attrs);
      },
    };
  },
});

// Toggle list (details/summary)
function ToggleListNodeView({ node, updateAttributes }: {
  node: { attrs: Record<string, string> };
  updateAttributes: (attrs: Record<string, string>) => void;
}) {
  const summaryText = node.attrs.summaryText || "トグル";

  return (
    <NodeViewWrapper>
      <details open>
        <summary contentEditable={false}>
          <input
            type="text"
            value={summaryText}
            onChange={(e) => updateAttributes({ summaryText: e.target.value })}
            className="toggle-summary-input"
            placeholder="トグル"
          />
        </summary>
        <div className="toggle-content">
          <NodeViewContent />
        </div>
      </details>
    </NodeViewWrapper>
  );
}

const ToggleListExtension = TiptapNode.create({
  name: "toggleList",
  group: "block",
  content: "block+",
  defining: true,

  addAttributes() {
    return {
      summaryText: {
        default: "トグル",
        parseHTML: (element: HTMLElement) => {
          const summary = element.querySelector("summary");
          return summary?.textContent || "トグル";
        },
      },
    };
  },

  parseHTML() {
    return [{ tag: "details" }];
  },

  renderHTML({ HTMLAttributes }: { HTMLAttributes: Record<string, unknown> }) {
    const { summaryText, ...rest } = HTMLAttributes;
    return [
      "details",
      mergeAttributes(rest as Record<string, unknown>),
      ["summary", {}, (summaryText as string) || "トグル"],
      ["div", { class: "toggle-content" }, 0],
    ];
  },

  addNodeView() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return ReactNodeViewRenderer(ToggleListNodeView as any);
  },

  // @ts-expect-error custom commands not in RawCommands
  addCommands() {
    return {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setToggleList: () => ({ commands }: any) => {
        return commands.wrapIn(this.name);
      },
    };
  },
});

// Guide link embed
function GuideLinkNodeView({
  node,
  deleteNode,
}: {
  node: { attrs: Record<string, string> };
  deleteNode: () => void;
}) {
  return (
    <NodeViewWrapper>
      <div className="guide-link-card" contentEditable={false}>
        <a
          href={node.attrs.guideUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="guide-link-inner"
        >
          {node.attrs.coverImageUrl && (
            <img
              src={node.attrs.coverImageUrl}
              alt=""
              className="guide-link-cover"
            />
          )}
          <div className="guide-link-body">
            <div className="guide-link-icon">
              <FileText className="h-4 w-4" />
            </div>
            <div className="guide-link-text">
              <span className="guide-link-title">{node.attrs.guideTitle}</span>
              {node.attrs.authorName && (
                <span className="guide-link-author">{node.attrs.authorName}</span>
              )}
            </div>
          </div>
        </a>
        <button
          type="button"
          onMouseDown={(e) => {
            e.preventDefault();
            deleteNode();
          }}
          title="リンクを削除"
          className="absolute top-2 right-2 h-6 w-6 flex items-center justify-center bg-black/60 text-white rounded-md opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
    </NodeViewWrapper>
  );
}

const GuideLinkExtension = TiptapNode.create({
  name: "guideLink",
  group: "block",
  atom: true,

  addAttributes() {
    return {
      guideUrl: { default: "" },
      guideTitle: { default: "" },
      authorName: { default: "" },
      coverImageUrl: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-guide-link]" }];
  },

  renderHTML({ HTMLAttributes }: { HTMLAttributes: Record<string, unknown> }) {
    const { guideUrl, guideTitle, authorName, coverImageUrl, ...rest } = HTMLAttributes;
    const children: unknown[] = [];

    if (coverImageUrl) {
      children.push(["img", { src: coverImageUrl, alt: "", class: "guide-link-cover" }]);
    }

    children.push([
      "div",
      { class: "guide-link-body" },
      ["span", { class: "guide-link-icon" }, "📄"],
      [
        "div",
        { class: "guide-link-text" },
        ["span", { class: "guide-link-title" }, guideTitle as string],
        ...(authorName ? [["span", { class: "guide-link-author" }, authorName as string]] : []),
      ],
    ]);

    return [
      "div",
      mergeAttributes(rest as Record<string, unknown>, {
        "data-guide-link": "",
        class: "guide-link-card",
      }),
      [
        "a",
        {
          href: guideUrl as string,
          class: "guide-link-inner",
          rel: "noopener noreferrer",
        },
        ...children,
      ],
    ];
  },

  addNodeView() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return ReactNodeViewRenderer(GuideLinkNodeView as any);
  },
});

// Columns layout
function ColumnsNodeView({
  node,
  deleteNode,
}: {
  node: { attrs: Record<string, unknown> };
  deleteNode: () => void;
}) {
  const cols = (node.attrs.cols as number) || 2;
  return (
    <NodeViewWrapper>
      <div className={`columns-editor columns-editor-${cols}`}>
        <div className="columns-editor-label" contentEditable={false}>
          <span>{cols}カラム</span>
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              deleteNode();
            }}
            title="段組を削除"
            className="columns-editor-delete"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
        <NodeViewContent className="columns-content" />
      </div>
    </NodeViewWrapper>
  );
}

function ColumnNodeView() {
  return (
    <NodeViewWrapper>
      <NodeViewContent className="column-editor" />
    </NodeViewWrapper>
  );
}

const ColumnsExtension = TiptapNode.create({
  name: "columns",
  group: "block",
  content: "column+",
  defining: true,

  addAttributes() {
    return {
      cols: {
        default: 2,
        parseHTML: (element: HTMLElement) => parseInt(element.getAttribute("data-columns") || "2"),
        renderHTML: (attributes: Record<string, unknown>) => ({
          "data-columns": String(attributes.cols),
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-columns]" }];
  },

  renderHTML({ HTMLAttributes }: { HTMLAttributes: Record<string, unknown> }) {
    return ["div", mergeAttributes(HTMLAttributes), 0];
  },

  addNodeView() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return ReactNodeViewRenderer(ColumnsNodeView as any);
  },
});

const ColumnExtension = TiptapNode.create({
  name: "column",
  content: "block+",
  isolating: true,

  parseHTML() {
    return [{ tag: "div[data-column]" }];
  },

  renderHTML() {
    return ["div", { "data-column": "" }, 0];
  },

  addNodeView() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return ReactNodeViewRenderer(ColumnNodeView as any);
  },
});

// Extended TableCell with background/text color
const CustomTableCell = TableCell.extend({
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

const CustomTableHeader = TableHeader.extend({
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

// ─────────────────────────────────────────────
// Debounce hook
// ─────────────────────────────────────────────

function useDebounced<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debouncedValue;
}

// ─────────────────────────────────────────────
// Main Editor component
// ─────────────────────────────────────────────

export function GuideEditor({
  guideId,
  userId,
  initialTitle,
  initialContent,
  initialSummary,
  initialTags,
  initialIsPublished,
  initialCoverImageUrl,
  authorSlug,
  guideSlug,
}: GuideEditorProps) {
  const [title, setTitle] = useState(initialTitle);
  const [content, setContent] = useState(initialContent);
  const [summary, setSummary] = useState(initialSummary);
  const [tags, setTags] = useState<string[]>(initialTags);
  const [tagInput, setTagInput] = useState("");
  const [isPublished, setIsPublished] = useState(initialIsPublished);
  const [coverImageUrl, setCoverImageUrl] = useState<string | null>(initialCoverImageUrl);
  const [isUploadingCover, setIsUploadingCover] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "unsaved">("saved");
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Floating selection menu (position: fixed, shows on text selection)
  const [floatingMenu, setFloatingMenu] = useState<{
    show: boolean;
    x: number;
    y: number;
  }>({ show: false, x: 0, y: 0 });

  const imageInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);

  // ── Block handle state ──────────────────────
  const [blockHandle, setBlockHandle] = useState<{
    top: number;
    left: number;
    height: number;
    nodeType: string;
    domEl: HTMLElement | null;
    rowEl: HTMLElement | null; // non-null when inside a table row
  } | null>(null);
  const [blockMenuOpen, setBlockMenuOpen] = useState(false);
  const blockHandleRef = useRef<HTMLDivElement>(null);
  const blockHideTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // ── Context menu state ──────────────────────
  const [contextMenu, setContextMenu] = useState<{
    show: boolean;
    x: number;
    y: number;
    nodeType: string;
    domEl: HTMLElement | null;
    rowEl: HTMLElement | null;
    hasSelection: boolean;
  } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  const fetcher = useFetcher();
  const isFirstRender = useRef(true);
  const lastSavedRef = useRef({ title, content, summary, tags, isPublished });

  // Color dropdown state
  const [colorMenuOpen, setColorMenuOpen] = useState(false);
  const [cellColorMenuOpen, setCellColorMenuOpen] = useState(false);
  const colorMenuRef = useRef<HTMLDivElement>(null);
  const cellColorMenuRef = useRef<HTMLDivElement>(null);

  // Guide link search state
  const [guideLinkOpen, setGuideLinkOpen] = useState(false);
  const [guideLinkQuery, setGuideLinkQuery] = useState("");
  const [guideLinkResults, setGuideLinkResults] = useState<
    { id: string; title: string; url: string; authorName: string; coverImageUrl: string | null }[]
  >([]);
  const [guideLinkLoading, setGuideLinkLoading] = useState(false);
  const guideLinkRef = useRef<HTMLDivElement>(null);
  const guideLinkSearchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ codeBlock: false }),
      CodeBlock.extend({
        addNodeView() {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return ReactNodeViewRenderer(CodeBlockNodeView as any);
        },
      }),
      Table.configure({ resizable: true }),
      TableRow,
      CustomTableCell,
      CustomTableHeader,
      Image.configure({ inline: false, allowBase64: true }).extend({
        addAttributes() {
          return {
            ...this.parent?.(),
            width: {
              default: null,
              parseHTML: (element: HTMLElement) => element.getAttribute("width"),
              renderHTML: (attributes: Record<string, unknown>) => {
                if (!attributes.width) return {};
                return { width: attributes.width };
              },
            },
          };
        },
        addNodeView() {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return ReactNodeViewRenderer(ImageNodeView as any);
        },
      }),
      Link2.configure({ openOnClick: false, autolink: true }),
      Placeholder.configure({ placeholder: t("guideEditor.contentPlaceholder") }),
      Youtube.configure({ nocookie: true }).extend({
        addNodeView() {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return ReactNodeViewRenderer(YoutubeNodeView as any);
        },
      }),
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      CalloutExtension,
      ToggleListExtension,
      GuideLinkExtension,
      ColumnsExtension,
      ColumnExtension,
    ],
    immediatelyRender: false,
    content: initialContent,
    onUpdate: ({ editor }) => {
      setContent(editor.getHTML());
    },
    editorProps: {
      attributes: {
        class: "outline-none min-h-100",
      },
    },
  });

  // Track text selection to show floating menu
  useEffect(() => {
    if (!editor) return;

    const showMenu = () => {
      const { empty } = editor.state.selection;
      if (empty) {
        setFloatingMenu((prev) => ({ ...prev, show: false }));
        return;
      }
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      if (!rect.width && !rect.height) return;
      setFloatingMenu({ show: true, x: rect.left + rect.width / 2, y: rect.top });
    };

    const hideMenu = () => setFloatingMenu((prev) => ({ ...prev, show: false }));

    editor.on("selectionUpdate", showMenu);
    editor.on("blur", hideMenu);

    const handleScroll = () => hideMenu();
    window.addEventListener("scroll", handleScroll, true);

    return () => {
      editor.off("selectionUpdate", showMenu);
      editor.off("blur", hideMenu);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [editor]);

  // ── Block handle: track hovered block ───────
  useEffect(() => {
    if (!editor) return;
    const pmEl = editor.view.dom as HTMLElement;

    const onMove = (e: MouseEvent) => {
      clearTimeout(blockHideTimer.current);
      if (blockHandleRef.current?.contains(e.target as Node)) return;

      // Find the table row (tr) if hovering inside a table
      let rowEl: HTMLElement | null = null;
      let check: HTMLElement | null = e.target as HTMLElement;
      while (check && check !== pmEl) {
        if (check.tagName === "TR") { rowEl = check; break; }
        check = check.parentElement;
      }

      // Walk up to the direct child of .ProseMirror
      let el: HTMLElement | null = e.target as HTMLElement;
      while (el && el.parentElement !== pmEl) {
        if (!el.parentElement) { el = null; break; }
        el = el.parentElement;
      }
      if (!el) return;

      // Determine ProseMirror node type at this position
      let nodeType = "paragraph";
      try {
        const rect0 = el.getBoundingClientRect();
        const res = editor.view.posAtCoords({ left: rect0.left + 4, top: rect0.top + 4 });
        if (res) {
          const $p = editor.state.doc.resolve(res.pos);
          nodeType = $p.node(Math.min($p.depth, 1)).type.name;
        }
      } catch { /* ignore */ }

      const displayEl = rowEl ?? el;
      const rect = displayEl.getBoundingClientRect();
      setBlockHandle({ top: rect.top, left: rect.left, height: rect.height, nodeType, domEl: el, rowEl });
    };

    const onLeave = (e: MouseEvent) => {
      if (blockHandleRef.current?.contains(e.relatedTarget as Node)) return;
      blockHideTimer.current = setTimeout(() => {
        if (!blockHandleRef.current?.matches(":hover")) {
          setBlockHandle(null);
          setBlockMenuOpen(false);
        }
      }, 300);
    };

    pmEl.addEventListener("mousemove", onMove);
    pmEl.addEventListener("mouseleave", onLeave);
    return () => {
      pmEl.removeEventListener("mousemove", onMove);
      pmEl.removeEventListener("mouseleave", onLeave);
      clearTimeout(blockHideTimer.current);
    };
  }, [editor]);

  // ── Context menu: right-click on editor ───────
  // Capture selection state on right-mousedown (before ProseMirror moves cursor)
  const hadSelectionOnRightClick = useRef(false);
  useEffect(() => {
    if (!editor) return;
    const pmEl = editor.view.dom as HTMLElement;

    const onRightMouseDown = (e: MouseEvent) => {
      if (e.button !== 2) return;
      hadSelectionOnRightClick.current = !editor.state.selection.empty;
    };

    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();

      // Find the table row (tr) if right-clicking inside a table
      let rowEl: HTMLElement | null = null;
      let check: HTMLElement | null = e.target as HTMLElement;
      while (check && check !== pmEl) {
        if (check.tagName === "TR") { rowEl = check; break; }
        check = check.parentElement;
      }

      // Walk up to the direct child of .ProseMirror
      let el: HTMLElement | null = e.target as HTMLElement;
      while (el && el.parentElement !== pmEl) {
        if (!el.parentElement) { el = null; break; }
        el = el.parentElement;
      }
      if (!el) return;

      // Determine ProseMirror node type
      let nodeType = "paragraph";
      try {
        const rect0 = el.getBoundingClientRect();
        const res = editor.view.posAtCoords({ left: rect0.left + 4, top: rect0.top + 4 });
        if (res) {
          const $p = editor.state.doc.resolve(res.pos);
          nodeType = $p.node(Math.min($p.depth, 1)).type.name;
        }
      } catch { /* ignore */ }

      const hasSelection = hadSelectionOnRightClick.current || !editor.state.selection.empty;
      setContextMenu({ show: true, x: e.clientX, y: e.clientY, nodeType, domEl: el, rowEl, hasSelection });
    };

    pmEl.addEventListener("mousedown", onRightMouseDown, true);
    pmEl.addEventListener("contextmenu", onContextMenu);
    return () => {
      pmEl.removeEventListener("mousedown", onRightMouseDown, true);
      pmEl.removeEventListener("contextmenu", onContextMenu);
    };
  }, [editor]);

  // Close context menu on outside click or scroll
  useEffect(() => {
    if (!contextMenu?.show) return;
    const handler = (e: MouseEvent) => {
      if (!contextMenuRef.current?.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };
    const scrollHandler = () => setContextMenu(null);
    document.addEventListener("mousedown", handler);
    window.addEventListener("scroll", scrollHandler, true);
    return () => {
      document.removeEventListener("mousedown", handler);
      window.removeEventListener("scroll", scrollHandler, true);
    };
  }, [contextMenu?.show]);

  // Close block menu on outside click
  useEffect(() => {
    if (!blockMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (!blockHandleRef.current?.contains(e.target as Node)) {
        setBlockMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [blockMenuOpen]);

  // Close color menu on outside click
  useEffect(() => {
    if (!colorMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (!colorMenuRef.current?.contains(e.target as Node)) {
        setColorMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [colorMenuOpen]);

  // Close cell color menu on outside click
  useEffect(() => {
    if (!cellColorMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (!cellColorMenuRef.current?.contains(e.target as Node)) {
        setCellColorMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [cellColorMenuOpen]);

  // Close guide link popup on outside click
  useEffect(() => {
    if (!guideLinkOpen) return;
    const handler = (e: MouseEvent) => {
      if (!guideLinkRef.current?.contains(e.target as Node)) {
        setGuideLinkOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [guideLinkOpen]);

  // Guide link search with debounce
  useEffect(() => {
    clearTimeout(guideLinkSearchTimer.current);
    if (!guideLinkQuery.trim()) {
      setGuideLinkResults([]);
      return;
    }
    setGuideLinkLoading(true);
    guideLinkSearchTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/guides/search?q=${encodeURIComponent(guideLinkQuery.trim())}`);
        if (res.ok) {
          const data = await res.json();
          setGuideLinkResults(data.guides);
        }
      } catch { /* ignore */ }
      setGuideLinkLoading(false);
    }, 300);
    return () => clearTimeout(guideLinkSearchTimer.current);
  }, [guideLinkQuery]);

  const handleInsertGuideLink = useCallback(
    (guide: { url: string; title: string; authorName: string; coverImageUrl: string | null }) => {
      if (!editor) return;
      editor
        .chain()
        .focus()
        .insertContent({
          type: "guideLink",
          attrs: {
            guideUrl: guide.url,
            guideTitle: guide.title,
            authorName: guide.authorName,
            coverImageUrl: guide.coverImageUrl,
          },
        })
        .run();
      setGuideLinkOpen(false);
      setGuideLinkQuery("");
      setGuideLinkResults([]);
    },
    [editor]
  );

  // Apply block type change via handle
  const applyBlockType = useCallback((type: string) => {
    if (!editor || !blockHandle?.domEl) return;
    setBlockMenuOpen(false);
    try {
      const rect = blockHandle.domEl.getBoundingClientRect();
      const res = editor.view.posAtCoords({ left: rect.left + 4, top: rect.top + 4 });
      if (!res) return;
      const chain = editor.chain().focus().setTextSelection(res.pos);
      switch (type) {
        case "paragraph": chain.setParagraph(); break;
        case "heading1": chain.toggleHeading({ level: 1 }); break;
        case "heading2": chain.toggleHeading({ level: 2 }); break;
        case "heading3": chain.toggleHeading({ level: 3 }); break;
        case "bulletList": chain.toggleBulletList(); break;
        case "orderedList": chain.toggleOrderedList(); break;
        case "blockquote": chain.toggleBlockquote(); break;
        case "codeBlock": chain.toggleCodeBlock(); break;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        case "callout": chain.run(); (editor.commands as any).toggleCallout({ calloutType: "tip" }); return;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        case "toggleList": chain.run(); (editor.commands as any).setToggleList(); return;
      }
      chain.run();
    } catch { /* ignore */ }
  }, [editor, blockHandle]);

  // Delete hovered block via handle
  const deleteHoveredBlock = useCallback(() => {
    if (!editor || !blockHandle?.domEl) return;
    setBlockHandle(null);
    setBlockMenuOpen(false);
    try {
      const rect = blockHandle.domEl.getBoundingClientRect();
      const res = editor.view.posAtCoords({ left: rect.left + 4, top: rect.top + 4 });
      if (!res) return;
      const $p = editor.state.doc.resolve(res.pos);
      editor.chain().focus().deleteRange({ from: $p.before(1), to: $p.after(1) }).run();
    } catch { /* ignore */ }
  }, [editor, blockHandle]);

  // Table row/column operations via handle
  const applyTableOp = useCallback((op: string) => {
    if (!editor || !blockHandle?.rowEl) return;
    setBlockMenuOpen(false);
    try {
      const rect = blockHandle.rowEl.getBoundingClientRect();
      const res = editor.view.posAtCoords({ left: rect.left + 4, top: rect.top + 4 });
      if (!res) return;
      const chain = editor.chain().focus().setTextSelection(res.pos);
      switch (op) {
        case "addRowBefore": chain.addRowBefore(); break;
        case "addRowAfter": chain.addRowAfter(); break;
        case "deleteRow": chain.deleteRow(); break;
        case "addColBefore": chain.addColumnBefore(); break;
        case "addColAfter": chain.addColumnAfter(); break;
        case "deleteCol": chain.deleteColumn(); break;
        case "deleteTable": chain.deleteTable(); break;
      }
      chain.run();
    } catch { /* ignore */ }
  }, [editor, blockHandle]);

  // Apply background color to all cells in a row
  const applyRowColor = useCallback((color: string | null) => {
    if (!editor || !blockHandle?.rowEl) return;
    setBlockMenuOpen(false);
    try {
      const trEl = blockHandle.rowEl;
      const cells = trEl.querySelectorAll("td, th");
      cells.forEach((cell) => {
        const rect = cell.getBoundingClientRect();
        const res = editor.view.posAtCoords({ left: rect.left + 2, top: rect.top + 2 });
        if (res) {
          editor.chain().setTextSelection(res.pos).setCellAttribute("backgroundColor", color).run();
        }
      });
      editor.commands.focus();
    } catch { /* ignore */ }
  }, [editor, blockHandle]);

  // Apply background color to all cells in a column
  const applyColumnColor = useCallback((color: string | null, cellEl: HTMLElement) => {
    if (!editor) return;
    setBlockMenuOpen(false);
    try {
      // Find the column index of the clicked cell
      const row = cellEl.closest("tr");
      if (!row) return;
      const cells = Array.from(row.children);
      const colIdx = cells.indexOf(cellEl);
      if (colIdx < 0) return;

      // Find the table and iterate through all rows
      const table = cellEl.closest("table");
      if (!table) return;
      const rows = table.querySelectorAll("tr");
      rows.forEach((tr) => {
        const td = tr.children[colIdx] as HTMLElement | undefined;
        if (!td) return;
        const rect = td.getBoundingClientRect();
        const res = editor.view.posAtCoords({ left: rect.left + 2, top: rect.top + 2 });
        if (res) {
          editor.chain().setTextSelection(res.pos).setCellAttribute("backgroundColor", color).run();
        }
      });
      editor.commands.focus();
    } catch { /* ignore */ }
  }, [editor]);

  // Context menu actions (reuse block handle logic with contextMenu state)
  const applyContextBlockType = useCallback((type: string) => {
    if (!editor || !contextMenu?.domEl) return;
    setContextMenu(null);
    try {
      const rect = contextMenu.domEl.getBoundingClientRect();
      const res = editor.view.posAtCoords({ left: rect.left + 4, top: rect.top + 4 });
      if (!res) return;
      const chain = editor.chain().focus().setTextSelection(res.pos);
      switch (type) {
        case "paragraph": chain.setParagraph(); break;
        case "heading1": chain.toggleHeading({ level: 1 }); break;
        case "heading2": chain.toggleHeading({ level: 2 }); break;
        case "heading3": chain.toggleHeading({ level: 3 }); break;
        case "bulletList": chain.toggleBulletList(); break;
        case "orderedList": chain.toggleOrderedList(); break;
        case "blockquote": chain.toggleBlockquote(); break;
        case "codeBlock": chain.toggleCodeBlock(); break;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        case "callout": chain.run(); (editor.commands as any).toggleCallout({ calloutType: "tip" }); return;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        case "toggleList": chain.run(); (editor.commands as any).setToggleList(); return;
      }
      chain.run();
    } catch { /* ignore */ }
  }, [editor, contextMenu]);

  const deleteContextBlock = useCallback(() => {
    if (!editor || !contextMenu?.domEl) return;
    setContextMenu(null);
    try {
      const rect = contextMenu.domEl.getBoundingClientRect();
      const res = editor.view.posAtCoords({ left: rect.left + 4, top: rect.top + 4 });
      if (!res) return;
      const $p = editor.state.doc.resolve(res.pos);
      editor.chain().focus().deleteRange({ from: $p.before(1), to: $p.after(1) }).run();
    } catch { /* ignore */ }
  }, [editor, contextMenu]);

  const applyContextTableOp = useCallback((op: string) => {
    if (!editor || !contextMenu?.rowEl) return;
    setContextMenu(null);
    try {
      const rect = contextMenu.rowEl.getBoundingClientRect();
      const res = editor.view.posAtCoords({ left: rect.left + 4, top: rect.top + 4 });
      if (!res) return;
      const chain = editor.chain().focus().setTextSelection(res.pos);
      switch (op) {
        case "addRowBefore": chain.addRowBefore(); break;
        case "addRowAfter": chain.addRowAfter(); break;
        case "deleteRow": chain.deleteRow(); break;
        case "addColBefore": chain.addColumnBefore(); break;
        case "addColAfter": chain.addColumnAfter(); break;
        case "deleteCol": chain.deleteColumn(); break;
        case "deleteTable": chain.deleteTable(); break;
      }
      chain.run();
    } catch { /* ignore */ }
  }, [editor, contextMenu]);

  const applyContextRowColor = useCallback((color: string | null) => {
    if (!editor || !contextMenu?.rowEl) return;
    setContextMenu(null);
    try {
      const cells = contextMenu.rowEl.querySelectorAll("td, th");
      cells.forEach((cell) => {
        const rect = cell.getBoundingClientRect();
        const res = editor.view.posAtCoords({ left: rect.left + 2, top: rect.top + 2 });
        if (res) {
          editor.chain().setTextSelection(res.pos).setCellAttribute("backgroundColor", color).run();
        }
      });
      editor.commands.focus();
    } catch { /* ignore */ }
  }, [editor, contextMenu]);

  const debouncedTitle = useDebounced(title, 2000);
  const debouncedContent = useDebounced(content, 2000);
  const debouncedSummary = useDebounced(summary, 2000);

  // Auto-save when debounced values change
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    const last = lastSavedRef.current;
    const hasChanges =
      debouncedTitle !== last.title ||
      debouncedContent !== last.content ||
      debouncedSummary !== last.summary;

    if (hasChanges) {
      const formData = new FormData();
      formData.append("title", debouncedTitle);
      formData.append("content", debouncedContent);
      formData.append("summary", debouncedSummary);
      formData.append("tags", JSON.stringify(tags));
      formData.append("isPublished", String(isPublished));
      formData.append("coverImageUrl", coverImageUrl ?? "");
      fetcher.submit(formData, { method: "post" });
      lastSavedRef.current = {
        title: debouncedTitle,
        content: debouncedContent,
        summary: debouncedSummary,
        tags,
        isPublished,
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedTitle, debouncedContent, debouncedSummary]);

  // Save status based on content changes
  useEffect(() => {
    const last = lastSavedRef.current;
    if (
      title !== last.title ||
      content !== last.content ||
      summary !== last.summary
    ) {
      setSaveStatus("unsaved");
    }
  }, [title, content, summary]);

  // Save status based on fetcher state
  useEffect(() => {
    if (fetcher.state === "submitting") {
      setSaveStatus("saving");
    } else if (fetcher.state === "idle" && saveStatus === "saving") {
      setSaveStatus("saved");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state]);

  const handleManualSave = useCallback(() => {
    const formData = new FormData();
    formData.append("title", title);
    formData.append("content", content);
    formData.append("summary", summary);
    formData.append("tags", JSON.stringify(tags));
    formData.append("isPublished", String(isPublished));
    formData.append("coverImageUrl", coverImageUrl ?? "");
    fetcher.submit(formData, { method: "post" });
    lastSavedRef.current = { title, content, summary, tags, isPublished };
  }, [title, content, summary, tags, isPublished, coverImageUrl, fetcher]);

  const handleSetPublished = useCallback(
    (newPublished: boolean) => {
      if (newPublished === isPublished) return;
      setIsPublished(newPublished);
      const formData = new FormData();
      formData.append("title", title);
      formData.append("content", content);
      formData.append("summary", summary);
      formData.append("tags", JSON.stringify(tags));
      formData.append("isPublished", String(newPublished));
      formData.append("coverImageUrl", coverImageUrl ?? "");
      fetcher.submit(formData, { method: "post" });
      lastSavedRef.current = { ...lastSavedRef.current, isPublished: newPublished };
    },
    [isPublished, title, content, summary, tags, coverImageUrl, fetcher]
  );

  const handleTagAdd = useCallback(() => {
    const trimmed = tagInput.trim().slice(0, 30);
    if (trimmed && !tags.includes(trimmed) && tags.length < 10) {
      setTags([...tags, trimmed]);
      setTagInput("");
      setSaveStatus("unsaved");
    }
  }, [tagInput, tags]);

  const handleTagRemove = useCallback(
    (tag: string) => {
      setTags(tags.filter((t) => t !== tag));
      setSaveStatus("unsaved");
    },
    [tags]
  );

  const handleImageUpload = useCallback(
    async (file: File) => {
      if (!editor) return;
      setIsUploadingImage(true);
      setUploadError(null);
      try {
        const ext = file.name.split(".").pop()?.toLowerCase() || "png";
        const blob = await upload(
          `guides/${userId}/${guideId}/images/${crypto.randomUUID()}.${ext}`,
          file,
          {
            access: "public",
            handleUploadUrl: "/api/me/guides/upload-image",
          }
        );
        editor
          .chain()
          .focus()
          .setImage({ src: blob.url, alt: file.name.replace(/\.[^.]+$/, "") })
          .run();
      } catch (e) {
        console.error("Image upload failed:", e);
        setUploadError("画像のアップロードに失敗しました");
        setTimeout(() => setUploadError(null), 4000);
      } finally {
        setIsUploadingImage(false);
      }
    },
    [editor, userId, guideId]
  );

  const handleCoverUpload = useCallback(
    async (file: File) => {
      setIsUploadingCover(true);
      setUploadError(null);
      try {
        const ext = file.name.split(".").pop()?.toLowerCase() || "png";
        const blob = await upload(
          `guides/${userId}/${guideId}/cover.${ext}`,
          file,
          {
            access: "public",
            handleUploadUrl: "/api/me/guides/upload-image",
          }
        );
        setCoverImageUrl(blob.url);
        setSaveStatus("unsaved");
      } catch (e) {
        console.error("Cover upload failed:", e);
        setUploadError("サムネイルのアップロードに失敗しました");
        setTimeout(() => setUploadError(null), 4000);
      } finally {
        setIsUploadingCover(false);
      }
    },
    [userId, guideId]
  );

  const handleLinkInsert = useCallback(() => {
    if (!editor) return;
    const href = window.prompt("URLを入力してください", "https://");
    if (!href) return;
    if (editor.state.selection.empty) {
      const text = window.prompt("リンクテキストを入力してください", href) || href;
      editor.chain().focus().insertContent(`<a href="${href}">${text}</a>`).run();
    } else {
      editor.chain().focus().setLink({ href }).run();
    }
  }, [editor]);

  const handleYoutubeInsert = useCallback(() => {
    if (!editor) return;
    const url = window.prompt(
      "YouTube URLを入力してください",
      "https://www.youtube.com/watch?v="
    );
    if (!url) return;
    editor.commands.setYoutubeVideo({ src: url });
  }, [editor]);

  const handleDeleteBlock = useCallback(() => {
    if (!editor) return;
    if (editor.isActive("table")) {
      editor.chain().focus().deleteTable().run();
    } else {
      editor.chain().focus().selectParentNode().deleteSelection().run();
    }
  }, [editor]);

  if (!editor) return null;

  // ── Shared toolbar button ──────────────────
  const TB = ({
    onClick,
    active,
    disabled,
    title: ttl,
    children,
    sm,
  }: {
    onClick: () => void;
    active?: boolean;
    disabled?: boolean;
    title: string;
    children: React.ReactNode;
    sm?: boolean;
  }) => (
    <Toggle
      size="sm"
      pressed={active ?? false}
      onPressedChange={() => onClick()}
      onMouseDown={(e: React.MouseEvent) => e.preventDefault()}
      disabled={disabled}
      title={ttl}
      className={cn(
        sm ? "h-7 w-7 min-w-7 px-0" : "h-8 w-8 min-w-8 px-0",
      )}
    >
      {children}
    </Toggle>
  );

  const Sep = () => <div className="w-px h-5 bg-border mx-0.5 shrink-0" />;

  // Block type options for the handle menu
  const blockTypeOptions = [
    { type: "paragraph", label: "テキスト", icon: <AlignLeft className="h-3.5 w-3.5" /> },
    { type: "heading1", label: "見出し 1", icon: <Heading1 className="h-3.5 w-3.5" /> },
    { type: "heading2", label: "見出し 2", icon: <Heading2 className="h-3.5 w-3.5" /> },
    { type: "heading3", label: "見出し 3", icon: <Heading3 className="h-3.5 w-3.5" /> },
    { type: "bulletList", label: "箇条書き", icon: <List className="h-3.5 w-3.5" /> },
    { type: "orderedList", label: "番号付きリスト", icon: <ListOrdered className="h-3.5 w-3.5" /> },
    { type: "blockquote", label: "引用", icon: <Quote className="h-3.5 w-3.5" /> },
    { type: "codeBlock", label: "コードブロック", icon: <Terminal className="h-3.5 w-3.5" /> },
    { type: "callout", label: "コールアウト", icon: <Lightbulb className="h-3.5 w-3.5" /> },
    { type: "toggleList", label: "トグルリスト", icon: <ChevronRight className="h-3.5 w-3.5" /> },
  ];

  return (
    <div className="flex flex-col">
      {/* ── Block handle (position:fixed, left of hovered block) ── */}
      {blockHandle && (
        <div
          ref={blockHandleRef}
          style={{
            position: "fixed",
            left: blockHandle.left - 28,
            top: blockHandle.top + blockHandle.height / 2,
            transform: "translateY(-50%)",
            zIndex: 200,
          }}
          onMouseEnter={() => clearTimeout(blockHideTimer.current)}
          onMouseLeave={() => {
            blockHideTimer.current = setTimeout(() => {
              setBlockHandle(null);
              setBlockMenuOpen(false);
            }, 300);
          }}
        >
          <button
            type="button"
            onMouseDown={(e) => { e.preventDefault(); setBlockMenuOpen((v) => !v); }}
            title="ブロック操作"
            className="h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground transition-colors opacity-50 hover:opacity-100"
          >
            <GripVertical className="h-4 w-4" />
          </button>

          {/* ── Block menu ── */}
          {blockMenuOpen && (
            <div
              className="absolute left-7 top-0 bg-popover border rounded-lg shadow-xl py-1 w-48"
              onMouseDown={(e) => e.preventDefault()}
            >
              {/* Type picker — not shown for tables */}
              {!blockHandle.rowEl && (
                <>
                  <p className="px-3 py-1 text-xs font-medium text-muted-foreground">ブロックタイプ</p>
                  {blockTypeOptions.map((opt) => (
                    <button
                      key={opt.type}
                      type="button"
                      onMouseDown={(e) => { e.preventDefault(); applyBlockType(opt.type); }}
                      className="w-full flex items-center gap-2.5 px-3 py-1.5 text-sm hover:bg-muted transition-colors text-left"
                    >
                      {opt.icon}
                      {opt.label}
                    </button>
                  ))}
                  <div className="border-t my-1" />
                </>
              )}

              {/* Table row / column ops */}
              {blockHandle.rowEl && (
                <>
                  <p className="px-3 py-1 text-xs font-medium text-muted-foreground">行</p>
                  {[
                    { op: "addRowBefore", label: "上に行を追加" },
                    { op: "addRowAfter", label: "下に行を追加" },
                    { op: "deleteRow", label: "行を削除", danger: true },
                  ].map(({ op, label, danger }) => (
                    <button key={op} type="button"
                      onMouseDown={(e) => { e.preventDefault(); applyTableOp(op); }}
                      className={cn("w-full flex items-center gap-2.5 px-3 py-1.5 text-sm transition-colors text-left",
                        danger ? "text-destructive hover:bg-destructive/10" : "hover:bg-muted")}
                    >{label}</button>
                  ))}
                  <p className="px-3 py-1 text-xs font-medium text-muted-foreground">行の背景色</p>
                  <div className="flex gap-1 px-3 py-1">
                    {[
                      { name: "なし", value: "" },
                      { name: "グレー", value: "#F1F1EF" },
                      { name: "赤", value: "#FDEBEC" },
                      { name: "黄", value: "#FBF3DB" },
                      { name: "緑", value: "#EDF3EC" },
                      { name: "青", value: "#E7F3F8" },
                    ].map((c) => (
                      <button
                        key={c.name}
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          applyRowColor(c.value || null);
                        }}
                        title={c.name}
                        className="h-5 w-5 rounded border border-border hover:ring-2 hover:ring-ring transition-all"
                        style={{ backgroundColor: c.value || "transparent" }}
                      >
                        {!c.value && <span className="text-[10px]">✕</span>}
                      </button>
                    ))}
                  </div>
                  <div className="border-t my-1" />
                  <p className="px-3 py-1 text-xs font-medium text-muted-foreground">列</p>
                  {[
                    { op: "addColBefore", label: "左に列を追加" },
                    { op: "addColAfter", label: "右に列を追加" },
                    { op: "deleteCol", label: "列を削除", danger: true },
                  ].map(({ op, label, danger }) => (
                    <button key={op} type="button"
                      onMouseDown={(e) => { e.preventDefault(); applyTableOp(op); }}
                      className={cn("w-full flex items-center gap-2.5 px-3 py-1.5 text-sm transition-colors text-left",
                        danger ? "text-destructive hover:bg-destructive/10" : "hover:bg-muted")}
                    >{label}</button>
                  ))}
                  <p className="px-3 py-1 text-xs font-medium text-muted-foreground">列の背景色</p>
                  <div className="flex gap-1 px-3 py-1">
                    {[
                      { name: "なし", value: "" },
                      { name: "グレー", value: "#F1F1EF" },
                      { name: "赤", value: "#FDEBEC" },
                      { name: "黄", value: "#FBF3DB" },
                      { name: "緑", value: "#EDF3EC" },
                      { name: "青", value: "#E7F3F8" },
                    ].map((c) => (
                      <button
                        key={c.name}
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          // Find the first cell in this row to get column reference
                          if (blockHandle?.rowEl) {
                            const firstCell = blockHandle.rowEl.querySelector("td, th") as HTMLElement | null;
                            if (firstCell) applyColumnColor(c.value || null, firstCell);
                          }
                        }}
                        title={c.name}
                        className="h-5 w-5 rounded border border-border hover:ring-2 hover:ring-ring transition-all"
                        style={{ backgroundColor: c.value || "transparent" }}
                      >
                        {!c.value && <span className="text-[10px]">✕</span>}
                      </button>
                    ))}
                  </div>
                  <div className="border-t my-1" />
                  <button type="button"
                    onMouseDown={(e) => { e.preventDefault(); applyTableOp("deleteTable"); }}
                    className="w-full flex items-center gap-2.5 px-3 py-1.5 text-sm text-destructive hover:bg-destructive/10 transition-colors text-left"
                  >テーブルを削除</button>
                  <div className="border-t my-1" />
                </>
              )}

              {/* Delete block */}
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); deleteHoveredBlock(); }}
                className="w-full flex items-center gap-2.5 px-3 py-1.5 text-sm text-destructive hover:bg-destructive/10 transition-colors text-left"
              >
                <Trash2 className="h-3.5 w-3.5" />
                ブロックを削除
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Floating selection menu (position:fixed, above selection) ── */}
      {floatingMenu.show && (
        <div
          style={{
            position: "fixed",
            left: floatingMenu.x,
            top: floatingMenu.y - 8,
            transform: "translate(-50%, -100%)",
            zIndex: 9999,
          }}
          onMouseDown={(e) => e.preventDefault()}
          className="flex items-center gap-0.5 bg-popover border rounded-lg shadow-xl px-1 py-1"
        >
          <TB
            onClick={() => editor.chain().focus().toggleBold().run()}
            active={editor.isActive("bold")}
            title="太字"
            sm
          >
            <Bold className="h-3.5 w-3.5" />
          </TB>
          <TB
            onClick={() => editor.chain().focus().toggleItalic().run()}
            active={editor.isActive("italic")}
            title="斜体"
            sm
          >
            <Italic className="h-3.5 w-3.5" />
          </TB>
          <TB
            onClick={() => editor.chain().focus().toggleStrike().run()}
            active={editor.isActive("strike")}
            title="打ち消し線"
            sm
          >
            <Strikethrough className="h-3.5 w-3.5" />
          </TB>
          <TB
            onClick={() => editor.chain().focus().toggleCode().run()}
            active={editor.isActive("code")}
            title="コード"
            sm
          >
            <Code className="h-3.5 w-3.5" />
          </TB>
          <TB onClick={handleLinkInsert} active={editor.isActive("link")} title="リンク" sm>
            <LinkIcon className="h-3.5 w-3.5" />
          </TB>
          <Sep />
          {/* Quick color buttons in floating menu */}
          {TEXT_COLORS.slice(0, 5).map((c) => (
            <button
              key={c.name}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                if (c.value) {
                  editor.chain().focus().setColor(c.value).run();
                } else {
                  editor.chain().focus().unsetColor().run();
                }
              }}
              title={`文字色: ${c.name}`}
              className="h-7 w-5 flex items-center justify-center text-xs font-bold rounded hover:bg-muted transition-colors"
              style={{ color: c.value || "var(--foreground)" }}
            >
              A
            </button>
          ))}
          <Sep />
          <TB
            onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
            active={editor.isActive("heading", { level: 1 })}
            title="見出し1"
            sm
          >
            <Heading1 className="h-3.5 w-3.5" />
          </TB>
          <TB
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            active={editor.isActive("heading", { level: 2 })}
            title="見出し2"
            sm
          >
            <Heading2 className="h-3.5 w-3.5" />
          </TB>
          <TB
            onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
            active={editor.isActive("heading", { level: 3 })}
            title="見出し3"
            sm
          >
            <Heading3 className="h-3.5 w-3.5" />
          </TB>
          <Sep />
          <TB onClick={handleDeleteBlock} title="ブロックを削除" sm>
            <Trash2 className="h-3.5 w-3.5 text-destructive" />
          </TB>
        </div>
      )}

      {/* ── Context menu (right-click) ── */}
      {contextMenu?.show && (
        <div
          ref={contextMenuRef}
          style={{
            position: "fixed",
            left: contextMenu.x,
            top: contextMenu.y,
            zIndex: 9999,
          }}
          onMouseDown={(e) => e.preventDefault()}
          className="bg-popover border rounded-lg shadow-xl py-1 w-48"
        >
          {/* Clipboard actions */}
          {contextMenu.hasSelection && (
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                document.execCommand("cut");
                setContextMenu(null);
              }}
              className="w-full flex items-center gap-2.5 px-3 py-1.5 text-sm hover:bg-muted transition-colors text-left"
            >
              <Scissors className="h-3.5 w-3.5" />
              切り取り
            </button>
          )}
          {contextMenu.hasSelection && (
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                document.execCommand("copy");
                setContextMenu(null);
              }}
              className="w-full flex items-center gap-2.5 px-3 py-1.5 text-sm hover:bg-muted transition-colors text-left"
            >
              <Copy className="h-3.5 w-3.5" />
              コピー
            </button>
          )}
          <button
            type="button"
            onMouseDown={async (e) => {
              e.preventDefault();
              setContextMenu(null);
              try {
                const text = await navigator.clipboard.readText();
                editor?.commands.insertContent(text);
              } catch {
                document.execCommand("paste");
              }
            }}
            className="w-full flex items-center gap-2.5 px-3 py-1.5 text-sm hover:bg-muted transition-colors text-left"
          >
            <ClipboardPaste className="h-3.5 w-3.5" />
            貼り付け
          </button>
          <div className="border-t my-1" />

          {/* Type picker — not shown for tables */}
          {!contextMenu.rowEl && (
            <>
              <p className="px-3 py-1 text-xs font-medium text-muted-foreground">ブロックタイプ</p>
              {blockTypeOptions.map((opt) => (
                <button
                  key={opt.type}
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); applyContextBlockType(opt.type); }}
                  className="w-full flex items-center gap-2.5 px-3 py-1.5 text-sm hover:bg-muted transition-colors text-left"
                >
                  {opt.icon}
                  {opt.label}
                </button>
              ))}
              <div className="border-t my-1" />
            </>
          )}

          {/* Table row / column ops */}
          {contextMenu.rowEl && (
            <>
              <p className="px-3 py-1 text-xs font-medium text-muted-foreground">行</p>
              {[
                { op: "addRowBefore", label: "上に行を追加" },
                { op: "addRowAfter", label: "下に行を追加" },
                { op: "deleteRow", label: "行を削除", danger: true },
              ].map(({ op, label, danger }) => (
                <button key={op} type="button"
                  onMouseDown={(e) => { e.preventDefault(); applyContextTableOp(op); }}
                  className={cn("w-full flex items-center gap-2.5 px-3 py-1.5 text-sm transition-colors text-left",
                    danger ? "text-destructive hover:bg-destructive/10" : "hover:bg-muted")}
                >{label}</button>
              ))}
              <p className="px-3 py-1 text-xs font-medium text-muted-foreground">行の背景色</p>
              <div className="flex gap-1 px-3 py-1">
                {[
                  { name: "なし", value: "" },
                  { name: "グレー", value: "#F1F1EF" },
                  { name: "赤", value: "#FDEBEC" },
                  { name: "黄", value: "#FBF3DB" },
                  { name: "緑", value: "#EDF3EC" },
                  { name: "青", value: "#E7F3F8" },
                ].map((c) => (
                  <button
                    key={c.name}
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); applyContextRowColor(c.value || null); }}
                    title={c.name}
                    className="h-5 w-5 rounded border border-border hover:ring-2 hover:ring-ring transition-all"
                    style={{ backgroundColor: c.value || "transparent" }}
                  >
                    {!c.value && <span className="text-[10px]">✕</span>}
                  </button>
                ))}
              </div>
              <div className="border-t my-1" />
              <p className="px-3 py-1 text-xs font-medium text-muted-foreground">列</p>
              {[
                { op: "addColBefore", label: "左に列を追加" },
                { op: "addColAfter", label: "右に列を追加" },
                { op: "deleteCol", label: "列を削除", danger: true },
              ].map(({ op, label, danger }) => (
                <button key={op} type="button"
                  onMouseDown={(e) => { e.preventDefault(); applyContextTableOp(op); }}
                  className={cn("w-full flex items-center gap-2.5 px-3 py-1.5 text-sm transition-colors text-left",
                    danger ? "text-destructive hover:bg-destructive/10" : "hover:bg-muted")}
                >{label}</button>
              ))}
              <div className="border-t my-1" />
              <button type="button"
                onMouseDown={(e) => { e.preventDefault(); applyContextTableOp("deleteTable"); }}
                className="w-full flex items-center gap-2.5 px-3 py-1.5 text-sm text-destructive hover:bg-destructive/10 transition-colors text-left"
              >テーブルを削除</button>
              <div className="border-t my-1" />
            </>
          )}

          {/* Delete block */}
          <button
            type="button"
            onMouseDown={(e) => { e.preventDefault(); deleteContextBlock(); }}
            className="w-full flex items-center gap-2.5 px-3 py-1.5 text-sm text-destructive hover:bg-destructive/10 transition-colors text-left"
          >
            <Trash2 className="h-3.5 w-3.5" />
            ブロックを削除
          </button>
        </div>
      )}

      {/* ── Sticky header: top bar + metadata + toolbar ── */}
      <div className="sticky top-0 z-40 bg-background pb-1 -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 pt-3 space-y-3">

        {/* ── Top bar ── */}
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="ghost" size="sm" asChild className="-ml-1">
            <Link to="/me/guides">
              <ArrowLeft className="h-4 w-4 mr-1" />
              ガイド一覧
            </Link>
          </Button>
          <div className="flex-1" />

          {/* Save status */}
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            {saveStatus === "saving" || fetcher.state === "submitting" ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" />
                {t("guideEditor.saving")}
              </>
            ) : saveStatus === "saved" ? (
              <>
                <Check className="h-3 w-3 text-green-500" />
                {t("guideEditor.saved")}
              </>
            ) : (
              <span>{t("guideEditor.unsaved")}</span>
            )}
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={handleManualSave}
            disabled={fetcher.state !== "idle"}
          >
            <Save className="h-4 w-4 mr-1" />
            {t("guideEditor.save")}
          </Button>

          {/* Publish toggle */}
          <div className="flex items-center rounded-md border overflow-hidden">
            <button
              type="button"
              onClick={() => handleSetPublished(false)}
              disabled={fetcher.state !== "idle"}
              className={cn(
                "flex items-center gap-1 px-3 py-1.5 text-sm transition-colors",
                !isPublished
                  ? "bg-secondary text-secondary-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              )}
            >
              <Lock className="h-3.5 w-3.5" />
              {t("guideEditor.draft")}
            </button>
            <div className="w-px self-stretch bg-border" />
            <button
              type="button"
              onClick={() => handleSetPublished(true)}
              disabled={fetcher.state !== "idle"}
              className={cn(
                "flex items-center gap-1 px-3 py-1.5 text-sm transition-colors",
                isPublished
                  ? "bg-primary text-primary-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              )}
            >
              <Globe className="h-3.5 w-3.5" />
              {t("guideEditor.published")}
            </button>
          </div>

          {isPublished && (
            <Button variant="ghost" size="sm" asChild>
              <Link to={`/guides/${authorSlug}/${guideSlug}`} target="_blank">
                <Globe className="h-4 w-4" />
              </Link>
            </Button>
          )}
        </div>

        {/* ── Toolbar ── */}
        <div className="flex items-center gap-0.5 flex-wrap border rounded-lg px-2 py-1.5 bg-muted/30">
          <TB
            onClick={() => editor.chain().focus().toggleBold().run()}
            active={editor.isActive("bold")}
            title={t("guideEditor.bold")}
          >
            <Bold className="h-4 w-4" />
          </TB>
          <TB
            onClick={() => editor.chain().focus().toggleItalic().run()}
            active={editor.isActive("italic")}
            title={t("guideEditor.italic")}
          >
            <Italic className="h-4 w-4" />
          </TB>
          <TB
            onClick={() => editor.chain().focus().toggleStrike().run()}
            active={editor.isActive("strike")}
            title={t("guideEditor.strike")}
          >
            <Strikethrough className="h-4 w-4" />
          </TB>
          <TB
            onClick={() => editor.chain().focus().toggleCode().run()}
            active={editor.isActive("code")}
            title={t("guideEditor.code")}
          >
            <Code className="h-4 w-4" />
          </TB>

          <Sep />

          <TB
            onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
            active={editor.isActive("heading", { level: 1 })}
            title={t("guideEditor.heading1")}
          >
            <Heading1 className="h-4 w-4" />
          </TB>
          <TB
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            active={editor.isActive("heading", { level: 2 })}
            title={t("guideEditor.heading2")}
          >
            <Heading2 className="h-4 w-4" />
          </TB>
          <TB
            onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
            active={editor.isActive("heading", { level: 3 })}
            title={t("guideEditor.heading3")}
          >
            <Heading3 className="h-4 w-4" />
          </TB>

          <Sep />

          <TB
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            active={editor.isActive("bulletList")}
            title={t("guideEditor.unorderedList")}
          >
            <List className="h-4 w-4" />
          </TB>
          <TB
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            active={editor.isActive("orderedList")}
            title={t("guideEditor.orderedList")}
          >
            <ListOrdered className="h-4 w-4" />
          </TB>
          <TB
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
            active={editor.isActive("blockquote")}
            title={t("guideEditor.blockquote")}
          >
            <Quote className="h-4 w-4" />
          </TB>

          {/* Callout */}
          <TB
            onClick={() => (editor.commands as Record<string, Function>).toggleCallout({ calloutType: "tip" })}
            active={editor.isActive("callout")}
            title="コールアウト"
          >
            <Lightbulb className="h-4 w-4" />
          </TB>

          {/* Toggle list */}
          <TB
            onClick={() => (editor.commands as Record<string, Function>).setToggleList()}
            title="トグルリスト"
          >
            <ChevronRight className="h-4 w-4" />
          </TB>

          {/* Columns */}
          <TB
            onClick={() => {
              editor.chain().focus().insertContent({
                type: "columns",
                attrs: { cols: 2 },
                content: [
                  { type: "column", content: [{ type: "paragraph" }] },
                  { type: "column", content: [{ type: "paragraph" }] },
                ],
              }).run();
            }}
            title="2カラム"
          >
            <Columns2 className="h-4 w-4" />
          </TB>
          <TB
            onClick={() => {
              editor.chain().focus().insertContent({
                type: "columns",
                attrs: { cols: 3 },
                content: [
                  { type: "column", content: [{ type: "paragraph" }] },
                  { type: "column", content: [{ type: "paragraph" }] },
                  { type: "column", content: [{ type: "paragraph" }] },
                ],
              }).run();
            }}
            title="3カラム"
          >
            <Columns3 className="h-4 w-4" />
          </TB>

          <Sep />

          {/* Text color dropdown */}
          <div className="relative" ref={colorMenuRef}>
            <TB
              onClick={() => setColorMenuOpen((v) => !v)}
              active={colorMenuOpen}
              title="文字色・背景色"
            >
              <Palette className="h-4 w-4" />
            </TB>
            {colorMenuOpen && (
              <div
                className="absolute top-full left-0 mt-1 bg-popover border rounded-lg shadow-xl p-2 w-52 z-50"
                onMouseDown={(e) => e.preventDefault()}
              >
                <p className="text-xs font-medium text-muted-foreground px-1 mb-1">文字色</p>
                <div className="flex flex-wrap gap-1 mb-2">
                  {TEXT_COLORS.map((c) => (
                    <button
                      key={c.name}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        if (c.value) {
                          editor.chain().focus().setColor(c.value).run();
                        } else {
                          editor.chain().focus().unsetColor().run();
                        }
                        setColorMenuOpen(false);
                      }}
                      title={c.name}
                      className="h-6 w-6 rounded border border-border flex items-center justify-center text-xs font-bold hover:ring-2 hover:ring-ring transition-all"
                      style={{ color: c.value || "var(--foreground)" }}
                    >
                      A
                    </button>
                  ))}
                </div>
                <p className="text-xs font-medium text-muted-foreground px-1 mb-1">背景色</p>
                <div className="flex flex-wrap gap-1">
                  {BG_COLORS.map((c) => (
                    <button
                      key={c.name}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        if (c.value) {
                          editor.chain().focus().toggleHighlight({ color: c.value }).run();
                        } else {
                          editor.chain().focus().unsetHighlight().run();
                        }
                        setColorMenuOpen(false);
                      }}
                      title={c.name}
                      className="h-6 w-6 rounded border border-border flex items-center justify-center text-xs hover:ring-2 hover:ring-ring transition-all"
                      style={{ backgroundColor: c.value || "transparent" }}
                    >
                      {c.value ? "" : "✕"}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <Sep />

          <TB
            onClick={() =>
              editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
            }
            title={t("guideEditor.table")}
          >
            <Table2 className="h-4 w-4" />
          </TB>
          <TB
            onClick={() => editor.chain().focus().setHorizontalRule().run()}
            title={t("guideEditor.horizontalRule")}
          >
            <Minus className="h-4 w-4" />
          </TB>

          <Sep />

          <TB onClick={handleLinkInsert} active={editor.isActive("link")} title={t("guideEditor.link")}>
            <LinkIcon className="h-4 w-4" />
          </TB>
          <TB
            onClick={() => imageInputRef.current?.click()}
            disabled={isUploadingImage}
            title={t("guideEditor.image")}
          >
            {isUploadingImage ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ImageIcon className="h-4 w-4" />
            )}
          </TB>
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleImageUpload(file);
              e.target.value = "";
            }}
          />
          <TB onClick={handleYoutubeInsert} title={t("guideEditor.youtube")}>
            <YoutubeIcon className="h-4 w-4" />
          </TB>

          {/* Guide link */}
          <div className="relative" ref={guideLinkRef}>
            <TB
              onClick={() => {
                setGuideLinkOpen((v) => !v);
                if (!guideLinkOpen) {
                  setGuideLinkQuery("");
                  setGuideLinkResults([]);
                }
              }}
              active={guideLinkOpen}
              title="ガイドリンク"
            >
              <FileText className="h-4 w-4" />
            </TB>
            {guideLinkOpen && (
              <div
                className="absolute top-full left-0 mt-1 bg-popover border rounded-lg shadow-xl w-80 z-50"
                onMouseDown={(e) => e.stopPropagation()}
              >
                <div className="flex items-center gap-2 px-3 py-2 border-b">
                  <Search className="h-4 w-4 text-muted-foreground shrink-0" />
                  <input
                    type="text"
                    value={guideLinkQuery}
                    onChange={(e) => setGuideLinkQuery(e.target.value)}
                    placeholder="ガイドを検索..."
                    className="flex-1 text-sm bg-transparent border-none outline-none"
                    autoFocus
                  />
                  {guideLinkQuery && (
                    <button
                      type="button"
                      onClick={() => {
                        setGuideLinkQuery("");
                        setGuideLinkResults([]);
                      }}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <div className="max-h-60 overflow-y-auto">
                  {guideLinkLoading ? (
                    <div className="flex items-center justify-center py-4">
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    </div>
                  ) : guideLinkResults.length > 0 ? (
                    guideLinkResults.map((g) => (
                      <button
                        key={g.id}
                        type="button"
                        onClick={() => handleInsertGuideLink(g)}
                        className="w-full flex items-start gap-2.5 px-3 py-2 text-left hover:bg-muted transition-colors"
                      >
                        <FileText className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{g.title}</p>
                          <p className="text-xs text-muted-foreground">{g.authorName}</p>
                        </div>
                      </button>
                    ))
                  ) : guideLinkQuery.trim() ? (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      ガイドが見つかりません
                    </p>
                  ) : (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      タイトルで検索
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>

          <Sep />

          <TB
            onClick={() => editor.chain().focus().undo().run()}
            disabled={!editor.can().undo()}
            title="元に戻す"
          >
            <Undo2 className="h-4 w-4" />
          </TB>
          <TB
            onClick={() => editor.chain().focus().redo().run()}
            disabled={!editor.can().redo()}
            title="やり直す"
          >
            <Redo2 className="h-4 w-4" />
          </TB>

          {/* Table controls — only shown when cursor is inside a table */}
          {editor.isActive("table") && (
            <>
              <Sep />
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().addRowAfter().run(); }}
                title="行を後ろに追加"
                className="px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground rounded transition-colors"
              >
                +行
              </button>
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().deleteRow().run(); }}
                title="行を削除"
                className="px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground rounded transition-colors"
              >
                -行
              </button>
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().addColumnAfter().run(); }}
                title="列を後ろに追加"
                className="px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground rounded transition-colors"
              >
                +列
              </button>
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().deleteColumn().run(); }}
                title="列を削除"
                className="px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground rounded transition-colors"
              >
                -列
              </button>
              {/* Cell/Row/Column color */}
              <div className="relative" ref={cellColorMenuRef}>
                <button
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); setCellColorMenuOpen((v) => !v); }}
                  title="セル・行・列の色"
                  className={cn(
                    "px-2 py-1 text-xs rounded transition-colors flex items-center gap-1",
                    cellColorMenuOpen
                      ? "bg-secondary text-secondary-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  <Paintbrush className="h-3 w-3" />
                  色
                </button>
                {cellColorMenuOpen && (
                  <div
                    className="absolute top-full right-0 mt-1 bg-popover border rounded-lg shadow-xl p-2 w-52 z-50"
                    onMouseDown={(e) => e.preventDefault()}
                  >
                    <p className="text-xs font-medium text-muted-foreground px-1 mb-1">セル背景色</p>
                    <div className="flex flex-wrap gap-1 mb-2">
                      {[
                        { name: "なし", value: "" },
                        { name: "グレー", value: "#F1F1EF" },
                        { name: "赤", value: "#FDEBEC" },
                        { name: "黄", value: "#FBF3DB" },
                        { name: "緑", value: "#EDF3EC" },
                        { name: "青", value: "#E7F3F8" },
                        { name: "紫", value: "#F6F3F9" },
                      ].map((c) => (
                        <button
                          key={c.name}
                          type="button"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            editor.chain().focus().setCellAttribute("backgroundColor", c.value || null).run();
                            setCellColorMenuOpen(false);
                          }}
                          title={c.name}
                          className="h-6 w-6 rounded border border-border hover:ring-2 hover:ring-ring transition-all"
                          style={{ backgroundColor: c.value || "transparent" }}
                        >
                          {!c.value && <span className="text-xs">✕</span>}
                        </button>
                      ))}
                    </div>
                    <p className="text-xs font-medium text-muted-foreground px-1 mb-1">セル文字色</p>
                    <div className="flex flex-wrap gap-1 mb-2">
                      {TEXT_COLORS.map((c) => (
                        <button
                          key={c.name}
                          type="button"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            editor.chain().focus().setCellAttribute("textColor", c.value || null).run();
                            setCellColorMenuOpen(false);
                          }}
                          title={c.name}
                          className="h-6 w-6 rounded border border-border flex items-center justify-center text-xs font-bold hover:ring-2 hover:ring-ring transition-all"
                          style={{ color: c.value || "var(--foreground)" }}
                        >
                          A
                        </button>
                      ))}
                    </div>
                    <div className="border-t my-1.5" />
                    <p className="text-xs font-medium text-muted-foreground px-1 mb-1">行の背景色</p>
                    <div className="flex flex-wrap gap-1 mb-2">
                      {[
                        { name: "なし", value: "" },
                        { name: "グレー", value: "#F1F1EF" },
                        { name: "赤", value: "#FDEBEC" },
                        { name: "黄", value: "#FBF3DB" },
                        { name: "緑", value: "#EDF3EC" },
                        { name: "青", value: "#E7F3F8" },
                        { name: "紫", value: "#F6F3F9" },
                      ].map((c) => (
                        <button
                          key={`row-${c.name}`}
                          type="button"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            const sel = window.getSelection();
                            const anchor = sel?.anchorNode;
                            const trEl = (anchor instanceof HTMLElement ? anchor : anchor?.parentElement)?.closest("tr") as HTMLElement | null;
                            if (trEl) {
                              const cells = trEl.querySelectorAll("td, th");
                              cells.forEach((cell) => {
                                const rect = cell.getBoundingClientRect();
                                const res = editor.view.posAtCoords({ left: rect.left + 2, top: rect.top + 2 });
                                if (res) {
                                  editor.chain().setTextSelection(res.pos).setCellAttribute("backgroundColor", c.value || null).run();
                                }
                              });
                              editor.commands.focus();
                            }
                            setCellColorMenuOpen(false);
                          }}
                          title={c.name}
                          className="h-6 w-6 rounded border border-border hover:ring-2 hover:ring-ring transition-all"
                          style={{ backgroundColor: c.value || "transparent" }}
                        >
                          {!c.value && <span className="text-xs">✕</span>}
                        </button>
                      ))}
                    </div>
                    <p className="text-xs font-medium text-muted-foreground px-1 mb-1">列の背景色</p>
                    <div className="flex flex-wrap gap-1">
                      {[
                        { name: "なし", value: "" },
                        { name: "グレー", value: "#F1F1EF" },
                        { name: "赤", value: "#FDEBEC" },
                        { name: "黄", value: "#FBF3DB" },
                        { name: "緑", value: "#EDF3EC" },
                        { name: "青", value: "#E7F3F8" },
                        { name: "紫", value: "#F6F3F9" },
                      ].map((c) => (
                        <button
                          key={`col-${c.name}`}
                          type="button"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            const sel = window.getSelection();
                            const anchor = sel?.anchorNode;
                            const cellEl = (anchor instanceof HTMLElement ? anchor : anchor?.parentElement)?.closest("td, th") as HTMLElement | null;
                            if (cellEl) {
                              const row = cellEl.closest("tr");
                              if (!row) return;
                              const colIdx = Array.from(row.children).indexOf(cellEl);
                              const table = cellEl.closest("table");
                              if (!table) return;
                              table.querySelectorAll("tr").forEach((tr) => {
                                const td = tr.children[colIdx] as HTMLElement | undefined;
                                if (!td) return;
                                const rect = td.getBoundingClientRect();
                                const res = editor.view.posAtCoords({ left: rect.left + 2, top: rect.top + 2 });
                                if (res) {
                                  editor.chain().setTextSelection(res.pos).setCellAttribute("backgroundColor", c.value || null).run();
                                }
                              });
                              editor.commands.focus();
                            }
                            setCellColorMenuOpen(false);
                          }}
                          title={c.name}
                          className="h-6 w-6 rounded border border-border hover:ring-2 hover:ring-ring transition-all"
                          style={{ backgroundColor: c.value || "transparent" }}
                        >
                          {!c.value && <span className="text-xs">✕</span>}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().deleteTable().run(); }}
                title="テーブルを削除"
                className="px-2 py-1 text-xs text-destructive hover:bg-destructive/10 rounded transition-colors"
              >
                表削除
              </button>
            </>
          )}
        </div>

      </div>{/* end sticky header */}

      <div className="space-y-3 mt-4">

        {/* ── Title ── */}
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t("guideEditor.titlePlaceholder")}
          className="w-full text-2xl font-bold bg-transparent border-none outline-none focus:ring-0 p-0"
        />

        {/* ── Cover image ── */}
        <div className="flex items-center gap-3">
          {coverImageUrl ? (
            <div className="relative group">
              <img
                src={coverImageUrl}
                alt="サムネイル"
                className="h-20 rounded-lg object-cover aspect-2/1"
              />
              <div className="absolute inset-0 flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity bg-black/40 rounded-lg">
                <button
                  type="button"
                  onClick={() => coverInputRef.current?.click()}
                  className="h-7 w-7 flex items-center justify-center bg-white/90 text-gray-700 rounded-md text-xs"
                  title="変更"
                >
                  <ImagePlus className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCoverImageUrl(null);
                    setSaveStatus("unsaved");
                  }}
                  className="h-7 w-7 flex items-center justify-center bg-white/90 text-destructive rounded-md text-xs"
                  title="削除"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => coverInputRef.current?.click()}
              disabled={isUploadingCover}
              className="flex items-center gap-2 px-3 py-1.5 text-sm text-muted-foreground border border-dashed rounded-lg hover:bg-muted/50 transition-colors"
            >
              {isUploadingCover ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ImagePlus className="h-4 w-4" />
              )}
              サムネイル画像を追加
            </button>
          )}
          <input
            ref={coverInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleCoverUpload(file);
              e.target.value = "";
            }}
          />
        </div>

        {/* ── Summary ── */}
        <Input
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          placeholder={t("guideEditor.summaryPlaceholder")}
          className="text-sm"
        />

        {/* ── Tags ── */}
        <div className="flex flex-wrap items-center gap-1.5">
          {tags.map((tag) => (
            <Badge
              key={tag}
              variant="secondary"
              className="cursor-pointer select-none"
              onClick={() => handleTagRemove(tag)}
            >
              {tag} ×
            </Badge>
          ))}
          {tags.length < 10 && (
            <input
              type="text"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === ",") {
                  e.preventDefault();
                  handleTagAdd();
                }
              }}
              placeholder={t("guideEditor.tagPlaceholder")}
              className="text-sm bg-transparent border-none outline-none focus:ring-0 min-w-24"
            />
          )}
        </div>

        {/* Upload error */}
        {uploadError && (
          <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {uploadError}
          </div>
        )}

      </div>{/* end metadata section */}

      {/* ── Editor area ── */}
      <div className="py-3 min-h-100">
        <div className="guide-content prose prose-neutral dark:prose-invert max-w-none">
          <EditorContent editor={editor} />
        </div>
      </div>
    </div>
  );
}
