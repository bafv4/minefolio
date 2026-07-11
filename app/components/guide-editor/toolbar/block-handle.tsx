// ブロックハンドル。ブロック左に表示し、種別変更 / 削除 / テーブル行列操作を提供。
// デスクトップ: ポインタ位置から posAtCoords（マウスは高精度）。
// タッチ: selectionUpdate でアクティブブロックを追従（旧 posAtCoords のタッチ不安定を回避）。
import { useState, useEffect, useCallback, useRef } from "react";
import type { Editor } from "@tiptap/core";
import type { LucideIcon } from "lucide-react";
import {
  GripVertical,
  Trash2,
  AlignLeft,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Quote,
  Terminal,
  Lightbulb,
  ChevronRight,
} from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { setBlockType, applyTableOp, setCellBackground, type BlockType } from "../lib/block-commands";
import { CELL_COLORS } from "../constants";
import { EDITOR_Z } from "../constants";
import { MenuItem } from "./menu-item";

const BLOCK_TYPES: { type: BlockType; label: string; icon: LucideIcon }[] = [
  { type: "paragraph", label: "テキスト", icon: AlignLeft },
  { type: "heading1", label: "見出し 1", icon: Heading1 },
  { type: "heading2", label: "見出し 2", icon: Heading2 },
  { type: "heading3", label: "見出し 3", icon: Heading3 },
  { type: "bulletList", label: "箇条書き", icon: List },
  { type: "orderedList", label: "番号付きリスト", icon: ListOrdered },
  { type: "blockquote", label: "引用", icon: Quote },
  { type: "codeBlock", label: "コードブロック", icon: Terminal },
  { type: "callout", label: "コールアウト", icon: Lightbulb },
  { type: "toggleList", label: "トグルリスト", icon: ChevronRight },
];

interface HandleState {
  /** トップレベルブロックの開始位置 */
  pos: number;
  top: number;
  left: number;
  height: number;
  inTable: boolean;
}

export function BlockHandle({
  editor,
  touch,
  suppressInTable = false,
}: {
  editor: Editor;
  touch: boolean;
  /**
   * テーブルブロック上ではハンドルを出さない（デスクトップで指定）。
   * テーブル操作は行・列ハンドル（table-handles.tsx）へ委譲する。
   * 旧メニューは選択をテーブル先頭セルへ移すため、常に 1 行目 / 1 列目にしか
   * 作用しなかった — ホバー中の行・列に作用する新ハンドルが正確な代替。
   */
  suppressInTable?: boolean;
}) {
  const [state, setState] = useState<HandleState | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  // ハンドルは編集領域の外（ブロック左）に出るため、マウスが領域を離れた瞬間に
  // 消すとハンドルへ到達できない。遅延して消し、ハンドル上では取り消す。
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const menuOpenRef = useRef(menuOpen);
  menuOpenRef.current = menuOpen;

  const cancelHide = useCallback(() => clearTimeout(hideTimer.current), []);
  const scheduleHide = useCallback(() => {
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      if (!menuOpenRef.current) setState(null);
    }, 400);
  }, []);

  // 同じブロック・同じ位置なら再レンダリングしない（マウス移動での setState 連発を抑制）
  const applyState = useCallback((next: HandleState | null) => {
    setState((prev) => {
      if (prev === next) return prev;
      if (
        prev &&
        next &&
        prev.pos === next.pos &&
        prev.inTable === next.inTable &&
        Math.abs(prev.top - next.top) < 0.5 &&
        Math.abs(prev.left - next.left) < 0.5 &&
        Math.abs(prev.height - next.height) < 0.5
      ) {
        return prev;
      }
      return next;
    });
  }, []);

  /** 指定位置のトップレベルブロックの矩形を求める */
  const computeAt = useCallback(
    (pos: number): HandleState | null => {
      try {
        const safePos = Math.max(0, Math.min(pos, editor.state.doc.content.size));
        const $pos = editor.state.doc.resolve(safePos);
        const topPos = $pos.depth >= 1 ? $pos.before(1) : safePos;
        const dom = editor.view.nodeDOM(topPos) as HTMLElement | null;
        if (!dom || typeof dom.getBoundingClientRect !== "function") return null;
        const rect = dom.getBoundingClientRect();
        const node = editor.state.doc.nodeAt(topPos);
        return {
          pos: topPos,
          top: rect.top,
          left: rect.left,
          height: rect.height,
          inTable: node?.type.name === "table",
        };
      } catch {
        return null;
      }
    },
    [editor],
  );

  // デスクトップ: マウス移動でブロックを追従（rAF スロットル + 変化時のみ更新）
  useEffect(() => {
    if (touch) return;
    const dom = editor.view.dom as HTMLElement;
    let raf: number | null = null;
    const onMove = (e: MouseEvent) => {
      if (menuOpenRef.current) return;
      cancelHide();
      const x = e.clientX;
      const y = e.clientY;
      if (raf != null) return;
      raf = requestAnimationFrame(() => {
        raf = null;
        const res = editor.view.posAtCoords({ left: x, top: y });
        if (!res) return;
        const next = computeAt(res.pos);
        applyState(suppressInTable && next?.inTable ? null : next);
      });
    };
    dom.addEventListener("mousemove", onMove);
    dom.addEventListener("mouseleave", scheduleHide);
    return () => {
      dom.removeEventListener("mousemove", onMove);
      dom.removeEventListener("mouseleave", scheduleHide);
      if (raf != null) cancelAnimationFrame(raf);
      cancelHide();
    };
  }, [editor, touch, suppressInTable, computeAt, cancelHide, scheduleHide, applyState]);

  // タッチ: 選択変更でアクティブブロックを追従
  useEffect(() => {
    if (!touch) return;
    const update = () => {
      if (menuOpenRef.current) return;
      applyState(computeAt(editor.state.selection.from));
    };
    update();
    editor.on("selectionUpdate", update);
    return () => {
      editor.off("selectionUpdate", update);
    };
  }, [editor, touch, computeAt, applyState]);

  if (!state) return null;

  const selectBlock = () => {
    editor.chain().focus().setTextSelection(state.pos + 1).run();
  };

  const applyType = (type: BlockType) => {
    selectBlock();
    setBlockType(editor, type);
    setMenuOpen(false);
  };

  type TableOpKind = Parameters<typeof applyTableOp>[1];
  const runTableOp = (op: TableOpKind) => {
    selectBlock();
    applyTableOp(editor, op);
    setMenuOpen(false);
  };

  const ROW_OPS: { op: TableOpKind; label: string; danger?: boolean }[] = [
    { op: "addRowBefore", label: "上に行を追加" },
    { op: "addRowAfter", label: "下に行を追加" },
    { op: "deleteRow", label: "行を削除", danger: true },
  ];
  const COL_OPS: { op: TableOpKind; label: string; danger?: boolean }[] = [
    { op: "addColBefore", label: "左に列を追加" },
    { op: "addColAfter", label: "右に列を追加" },
    { op: "deleteCol", label: "列を削除", danger: true },
  ];

  const applyCellColor = (color: string | null) => {
    selectBlock();
    setCellBackground(editor, color);
  };

  const deleteBlock = () => {
    const node = editor.state.doc.nodeAt(state.pos);
    if (node) {
      editor
        .chain()
        .focus()
        .deleteRange({ from: state.pos, to: state.pos + node.nodeSize })
        .run();
    }
    setState(null);
    setMenuOpen(false);
  };

  return (
    <Popover open={menuOpen} onOpenChange={setMenuOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="ブロック操作"
          aria-haspopup="menu"
          onMouseDown={(e) => e.preventDefault()}
          onMouseEnter={cancelHide}
          onMouseMove={cancelHide}
          onMouseLeave={scheduleHide}
          style={{
            position: "fixed",
            // ブロック左端からハンドルまでを padding-right で埋め、移動時の dead zone を無くす。
            // 狭い画面ではコンテンツが端に寄るため、画面外へ出ないよう左端をクランプ。
            left: Math.max(4, state.left - 30),
            top: state.top + state.height / 2,
            transform: "translateY(-50%)",
            zIndex: EDITOR_Z.handle,
          }}
          className="h-6 w-8 pr-2 flex items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground transition-colors opacity-60 hover:opacity-100"
        >
          <GripVertical className="h-4 w-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="right"
        className="w-52 p-1"
        role="menu"
        onMouseDown={(e) => e.preventDefault()}
      >
        {state.inTable ? (
          <>
            <p className="px-2 py-1 text-xs font-medium text-muted-foreground">行</p>
            {ROW_OPS.map(({ op, label, danger }) => (
              <MenuItem key={op} label={label} danger={danger} onClick={() => runTableOp(op)} />
            ))}
            <p className="px-2 py-1 text-xs font-medium text-muted-foreground">列</p>
            {COL_OPS.map(({ op, label, danger }) => (
              <MenuItem key={op} label={label} danger={danger} onClick={() => runTableOp(op)} />
            ))}
            <p className="px-2 py-1 text-xs font-medium text-muted-foreground">セル背景色</p>
            <div className="flex flex-wrap gap-1 px-2 py-1">
              {CELL_COLORS.map((c) => (
                <Tooltip key={c.name}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        applyCellColor(c.value || null);
                      }}
                      aria-label={c.name}
                      className="h-5 w-5 rounded border border-border hover:ring-2 hover:ring-ring transition-all flex items-center justify-center"
                      style={{ backgroundColor: c.value || "transparent" }}
                    >
                      {!c.value && <span className="text-[10px]">✕</span>}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent showArrow={false}>{c.name}</TooltipContent>
                </Tooltip>
              ))}
            </div>
            <div className="border-t my-1" />
            <MenuItem label="テーブルを削除" danger icon={Trash2} onClick={() => runTableOp("deleteTable")} />
          </>
        ) : (
          <>
            <p className="px-2 py-1 text-xs font-medium text-muted-foreground">ブロックタイプ</p>
            {BLOCK_TYPES.map((opt) => (
              <MenuItem key={opt.type} label={opt.label} icon={opt.icon} onClick={() => applyType(opt.type)} />
            ))}
            <div className="border-t my-1" />
            <MenuItem label="ブロックを削除" danger icon={Trash2} onClick={deleteBlock} />
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
