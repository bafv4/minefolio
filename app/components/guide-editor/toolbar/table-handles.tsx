// テーブルの行・列ハンドル（Notion 風）。ホバー中のセルから行 / 列を検出し、
// 行は左端・列は上端にピル型ハンドルを表示する。クリックで行 / 列全体を
// CellSelection で選択し、追加・削除・スタイル（背景色 / 文字色 / 文字揃え）の
// メニューを開く。ホバー前提のためデスクトップ専用
// （タッチはブロックハンドル + ツールバー「テーブル」タブで操作）。
import { useState, useEffect, useCallback, useRef } from "react";
import type { Editor } from "@tiptap/core";
import type { LucideIcon } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import {
  ArrowUpToLine,
  ArrowDownToLine,
  ArrowLeftToLine,
  ArrowRightToLine,
  Trash2,
} from "lucide-react";
import {
  applyTableOp,
  selectTableLine,
  collapseCellSelection,
  setTableCellsStyle,
  type TableOp,
  type TableLineAxis,
  type TableCellStyleAttr,
} from "../lib/block-commands";
import { ColorSwatchGrid, TableAlignRow } from "../panels/color-picker";
import { MenuItem } from "./menu-item";
import { CELL_COLORS, TEXT_COLORS, EDITOR_Z } from "../constants";
import { cn } from "@/lib/utils";

/**
 * ホバー中のセルの参照。DOM 要素を直接持たず table + 行・列インデックスで持つ。
 * スタイル適用等で ProseMirror がセルの DOM を再生成しても、table 要素が
 * 生きていれば table.rows[r].cells[c] で再解決できる（メニューが閉じない）。
 */
interface HoverTarget {
  table: HTMLTableElement;
  rowIndex: number;
  cellIndex: number;
}

function resolveCell(target: HoverTarget): HTMLTableCellElement | null {
  if (!target.table.isConnected) return null;
  return target.table.rows[target.rowIndex]?.cells[target.cellIndex] ?? null;
}

/** 軸ごとのメニュー項目定義 */
const LINE_MENUS: Record<
  TableLineAxis,
  {
    addOps: { op: TableOp; label: string; icon: LucideIcon }[];
    deleteOp: TableOp;
    deleteLabel: string;
  }
> = {
  row: {
    addOps: [
      { op: "addRowBefore", label: "上に行を追加", icon: ArrowUpToLine },
      { op: "addRowAfter", label: "下に行を追加", icon: ArrowDownToLine },
    ],
    deleteOp: "deleteRow",
    deleteLabel: "行を削除",
  },
  column: {
    addOps: [
      { op: "addColBefore", label: "左に列を追加", icon: ArrowLeftToLine },
      { op: "addColAfter", label: "右に列を追加", icon: ArrowRightToLine },
    ],
    deleteOp: "deleteCol",
    deleteLabel: "列を削除",
  },
};

/** 行 / 列メニューの中身（追加・削除 + スタイル一括適用） */
function LineMenuContent({
  axis,
  runOp,
  applyStyle,
}: {
  axis: TableLineAxis;
  runOp: (op: TableOp) => void;
  applyStyle: (attr: TableCellStyleAttr, value: string | null) => void;
}) {
  const { addOps, deleteOp, deleteLabel } = LINE_MENUS[axis];
  return (
    <PopoverContent
      side={axis === "row" ? "right" : "bottom"}
      align="start"
      className="w-56 p-1"
      role="menu"
      onMouseDown={(e) => e.preventDefault()}
      // 開いてもフォーカスをエディタから奪わない（行 / 列の CellSelection を保持する）
      onOpenAutoFocus={(e) => e.preventDefault()}
    >
      {addOps.map(({ op, label, icon }) => (
        <MenuItem key={op} label={label} icon={icon} onClick={() => runOp(op)} />
      ))}
      <div className="border-t my-1" />
      <div className="px-1 py-1 space-y-2">
        <TableAlignRow onPick={(v) => applyStyle("textAlign", v)} />
        <ColorSwatchGrid
          label="背景色"
          colors={CELL_COLORS}
          kind="bg"
          onPick={(v) => applyStyle("backgroundColor", v)}
        />
        <ColorSwatchGrid
          label="文字色"
          colors={TEXT_COLORS}
          kind="text"
          onPick={(v) => applyStyle("textColor", v)}
        />
      </div>
      <div className="border-t my-1" />
      <MenuItem label={deleteLabel} danger icon={Trash2} onClick={() => runOp(deleteOp)} />
      <MenuItem label="テーブルを削除" danger icon={Trash2} onClick={() => runOp("deleteTable")} />
    </PopoverContent>
  );
}

export function TableHandles({ editor }: { editor: Editor }) {
  const [hover, setHover] = useState<HoverTarget | null>(null);
  const [openAxis, setOpenAxis] = useState<TableLineAxis | null>(null);
  // スクロール / ドキュメント変更時に getBoundingClientRect を取り直すための再描画トリガー
  const [, setTick] = useState(0);

  const hoverRef = useRef(hover);
  hoverRef.current = hover;
  const openRef = useRef(openAxis);
  openRef.current = openAxis;

  // ハンドルはテーブルの外（行の左 / 列の上）に出るため、セルを離れた瞬間に
  // 消すとハンドルへ到達できない。遅延して消し、ハンドル上では取り消す。
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelHide = useCallback(() => {
    if (hideTimer.current != null) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  }, []);
  const scheduleHide = useCallback(() => {
    // 猶予中は張り直さない。セル外の mousemove ごとにリセットするとデバウンスに
    // なり、マウスが動き続ける限り離脱済みテーブルのピルが消えなくなる。
    if (hideTimer.current != null) return;
    hideTimer.current = setTimeout(() => {
      hideTimer.current = null;
      if (!openRef.current) setHover(null);
    }, 400);
  }, []);

  // マウス移動でホバー中のセルを追従
  useEffect(() => {
    const dom = editor.view.dom as HTMLElement;
    const onMove = (e: MouseEvent) => {
      if (openRef.current) return;
      const target = e.target as HTMLElement | null;
      const cell = target?.closest?.("td, th") as HTMLTableCellElement | null;
      if (!cell || !dom.contains(cell)) {
        scheduleHide();
        return;
      }
      cancelHide();
      const row = cell.parentElement as HTMLTableRowElement | null;
      const table = cell.closest("table") as HTMLTableElement | null;
      if (!row || !table) return;
      setHover((prev) =>
        prev &&
        prev.table === table &&
        prev.rowIndex === row.rowIndex &&
        prev.cellIndex === cell.cellIndex
          ? prev
          : { table, rowIndex: row.rowIndex, cellIndex: cell.cellIndex },
      );
    };
    const onLeave = () => scheduleHide();
    dom.addEventListener("mousemove", onMove);
    dom.addEventListener("mouseleave", onLeave);
    return () => {
      dom.removeEventListener("mousemove", onMove);
      dom.removeEventListener("mouseleave", onLeave);
      cancelHide();
    };
  }, [editor, cancelHide, scheduleHide]);

  // スクロール / リサイズでハンドル位置を追従（fixed 配置のため取り直しが必要）
  useEffect(() => {
    if (!hover) return;
    const reposition = () => setTick((t) => t + 1);
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [hover]);

  // ドキュメント変更に追従: ホバー先の行・列が解決できなくなったら（テーブル削除・
  // undo による行・列の消失等）ハンドルとメニューを確実に閉じる。開いたままの
  // Popover がアンマウントされても Radix は onOpenChange(false) を呼ばないため、
  // ここで openAxis をリセットしないと mousemove ガードが効き続けて
  // ハンドルが恒久的に無効化される。解決できる間は位置だけ取り直す。
  useEffect(() => {
    const onTransaction = () => {
      const current = hoverRef.current;
      if (!current) return;
      if (!resolveCell(current)) {
        setHover(null);
        setOpenAxis(null);
      } else {
        setTick((t) => t + 1);
      }
    };
    editor.on("transaction", onTransaction);
    return () => {
      editor.off("transaction", onTransaction);
    };
  }, [editor]);

  const openMenu = useCallback(
    (axis: TableLineAxis) => {
      const current = hoverRef.current;
      const cell = current ? resolveCell(current) : null;
      if (!cell) return;
      const pos = editor.view.posAtDOM(cell, 0);
      if (pos < 0) return;
      if (!selectTableLine(editor, pos, axis)) return;
      setOpenAxis(axis);
    },
    [editor],
  );

  const closeMenu = useCallback(() => {
    setOpenAxis(null);
    // CellSelection のまま放置すると次のキー入力で行 / 列全体が上書きされるため畳む
    collapseCellSelection(editor);
  }, [editor]);

  // メニュー表示中もフォーカスはエディタに残る（onOpenAutoFocus を止めている）ため、
  // 行・列の CellSelection がキー入力のターゲットになり、1 キーで行・列の全セルが
  // 上書きされてしまう。capture でキーを検知したら先にメニューを閉じて選択を畳み、
  // キー自体は畳んだ後のカーソルに対して通常どおり処理させる。
  useEffect(() => {
    if (!openAxis) return;
    const dom = editor.view.dom as HTMLElement;
    const onKeyDown = () => closeMenu();
    dom.addEventListener("keydown", onKeyDown, true);
    return () => {
      dom.removeEventListener("keydown", onKeyDown, true);
    };
  }, [openAxis, editor, closeMenu]);

  // 行・列の追加 / 削除。位置が大きく変わるため選択を畳みハンドルも出し直す
  const runOp = useCallback(
    (op: TableOp) => {
      applyTableOp(editor, op);
      collapseCellSelection(editor);
      setOpenAxis(null);
      setHover(null);
    },
    [editor],
  );

  // スタイル適用。選択（= 行 / 列のハイライト）とメニューは維持して連続適用できるようにする
  const applyStyle = useCallback(
    (attr: TableCellStyleAttr, value: string | null) => {
      if (openRef.current) setTableCellsStyle(editor, openRef.current, attr, value);
    },
    [editor],
  );

  const cell = hover ? resolveCell(hover) : null;
  if (!hover || !cell) return null;

  const row = cell.parentElement as HTMLTableRowElement;
  const rowRect = row.getBoundingClientRect();
  const cellRect = cell.getBoundingClientRect();
  const tableRect = hover.table.getBoundingClientRect();

  // tableWrapper（overflow-x: auto）の可視域へクランプする。fixed 配置は overflow で
  // クリップされないため、横スクロールでテーブル左端が見切れているときに
  // ピルが wrapper 外の本文上に浮いたり画面外に消えたりするのを防ぐ。
  const clipRect = (hover.table.closest(".tableWrapper") ?? hover.table).getBoundingClientRect();
  const rowPillLeft = Math.max(rowRect.left, clipRect.left);
  const colPillLeft = Math.min(
    Math.max(cellRect.left + cellRect.width / 2, clipRect.left + 12),
    Math.max(clipRect.right - 12, clipRect.left + 12),
  );

  const pillClass = (active: boolean) =>
    cn(
      "rounded-full transition-colors",
      active ? "bg-primary" : "bg-muted-foreground/40 group-hover:bg-primary/70",
    );

  return (
    <>
      {/* 行ハンドル: 行の左端中央（テーブル左罫線をまたぐ） */}
      <Popover open={openAxis === "row"} onOpenChange={(o) => (o ? openMenu("row") : closeMenu())}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="行を選択"
            aria-haspopup="menu"
            onMouseDown={(e) => e.preventDefault()}
            onMouseEnter={cancelHide}
            onMouseLeave={scheduleHide}
            style={{
              position: "fixed",
              left: rowPillLeft,
              top: rowRect.top + rowRect.height / 2,
              transform: "translate(-50%, -50%)",
              zIndex: EDITOR_Z.tableHandle,
            }}
            className="group flex h-9 w-4 items-center justify-center"
          >
            <span className={cn("h-6 w-1.5", pillClass(openAxis === "row"))} />
          </button>
        </PopoverTrigger>
        <LineMenuContent axis="row" runOp={runOp} applyStyle={applyStyle} />
      </Popover>

      {/* 列ハンドル: 列の上端中央（テーブル上罫線をまたぐ） */}
      <Popover
        open={openAxis === "column"}
        onOpenChange={(o) => (o ? openMenu("column") : closeMenu())}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="列を選択"
            aria-haspopup="menu"
            onMouseDown={(e) => e.preventDefault()}
            onMouseEnter={cancelHide}
            onMouseLeave={scheduleHide}
            style={{
              position: "fixed",
              left: colPillLeft,
              top: tableRect.top,
              transform: "translate(-50%, -50%)",
              zIndex: EDITOR_Z.tableHandle,
            }}
            className="group flex h-4 w-9 items-center justify-center"
          >
            <span className={cn("h-1.5 w-6", pillClass(openAxis === "column"))} />
          </button>
        </PopoverTrigger>
        <LineMenuContent axis="column" runOp={runOp} applyStyle={applyStyle} />
      </Popover>
    </>
  );
}
