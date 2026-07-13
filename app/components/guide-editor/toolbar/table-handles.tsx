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
  Copy,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import {
  applyTableOp,
  selectTableLine,
  collapseCellSelection,
  setTableCellsStyle,
  copyTableToClipboard,
  type TableOp,
  type TableLineAxis,
  type TableCellStyleAttr,
} from "../lib/block-commands";
import { setTableHandleMenuOpen } from "../lib/table-ui-state";
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

/** 行 / 列メニューの中身（追加・削除 + スタイル一括適用 + コピー） */
function LineMenuContent({
  axis,
  runOp,
  applyStyle,
  onCopyTable,
  onInteractOutside,
}: {
  axis: TableLineAxis;
  runOp: (op: TableOp) => void;
  applyStyle: (attr: TableCellStyleAttr, value: string | null) => void;
  onCopyTable: () => void;
  onInteractOutside: (target: Node | null) => void;
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
      // 閉じるときも fixed 配置のピル（アンマウントされうる）へフォーカスを移さない
      onCloseAutoFocus={(e) => e.preventDefault()}
      // 外側クリックは開直後ガード（ダブルクリック対策）を通さず即閉じる
      onInteractOutside={(e) => onInteractOutside(e.target as Node | null)}
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
      <MenuItem label="テーブルをコピー" icon={Copy} onClick={onCopyTable} />
      <div className="border-t my-1" />
      <MenuItem label={deleteLabel} danger icon={Trash2} onClick={() => runOp(deleteOp)} />
      <MenuItem label="テーブルを削除" danger icon={Trash2} onClick={() => runOp("deleteTable")} />
    </PopoverContent>
  );
}

/** 開いた直後の閉トグルを無視する猶予（ms）。ダブルクリックで「開→即閉」になるのを防ぐ */
const REOPEN_GUARD_MS = 300;

/** ピル消滅タイマーの発火時、ポインタがピルからこの距離（px）以内なら消さない */
const PILL_NEAR_MARGIN = 24;

export function TableHandles({ editor }: { editor: Editor }) {
  const [hover, setHover] = useState<HoverTarget | null>(null);
  const [openAxis, setOpenAxis] = useState<TableLineAxis | null>(null);
  // スクロール / ドキュメント変更時に getBoundingClientRect を取り直すための再描画トリガー
  const [, setTick] = useState(0);

  const hoverRef = useRef(hover);
  hoverRef.current = hover;
  const openRef = useRef(openAxis);
  openRef.current = openAxis;

  // メニューを開いた時刻。ダブルクリック（開いた直後の閉トグル）を無視するために使う
  const openedAtRef = useRef(0);
  // ピルの DOM 参照と最後のポインタ座標（消滅タイマーの「ピルに接近中」判定に使う）
  const rowPillRef = useRef<HTMLButtonElement | null>(null);
  const colPillRef = useRef<HTMLButtonElement | null>(null);
  const pointerRef = useRef<{ x: number; y: number } | null>(null);

  // ハンドルはテーブルの外（行の左 / 列の上）に出るため、セルを離れた瞬間に
  // 消すとハンドルへ到達できない。遅延して消し、ハンドル上では取り消す。
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelHide = useCallback(() => {
    if (hideTimer.current != null) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  }, []);

  // ポインタがピルの近く（マージン込み）にあるか。エディタ外からピルへ接近する経路では
  // ピルの mouseenter が間に合わないことがあるため、タイマー発火時にこれで消滅を延期する
  const isPointerNearPills = useCallback(() => {
    const p = pointerRef.current;
    if (!p) return false;
    for (const ref of [rowPillRef, colPillRef]) {
      const el = ref.current;
      if (!el) continue;
      const r = el.getBoundingClientRect();
      // レイアウト前などサイズ 0 の rect は判定できないため対象外
      if (r.width === 0 && r.height === 0) continue;
      if (
        p.x >= r.left - PILL_NEAR_MARGIN &&
        p.x <= r.right + PILL_NEAR_MARGIN &&
        p.y >= r.top - PILL_NEAR_MARGIN &&
        p.y <= r.bottom + PILL_NEAR_MARGIN
      ) {
        return true;
      }
    }
    return false;
  }, []);

  const scheduleHide = useCallback(() => {
    // 猶予中は張り直さない。セル外の mousemove ごとにリセットするとデバウンスに
    // なり、マウスが動き続ける限り離脱済みテーブルのピルが消えなくなる。
    if (hideTimer.current != null) return;
    const fire = () => {
      hideTimer.current = null;
      if (openRef.current) return;
      // ポインタがピル付近にいる間は消さず、短い間隔で再判定する
      if (isPointerNearPills()) {
        hideTimer.current = setTimeout(fire, 200);
        return;
      }
      setHover(null);
    };
    hideTimer.current = setTimeout(fire, 400);
  }, [isPointerNearPills]);

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
    // 消滅タイマーの接近判定用に、ドキュメント全体でポインタ座標を追跡する
    const onDocMove = (e: MouseEvent) => {
      pointerRef.current = { x: e.clientX, y: e.clientY };
    };
    dom.addEventListener("mousemove", onMove);
    dom.addEventListener("mouseleave", onLeave);
    document.addEventListener("mousemove", onDocMove);
    return () => {
      dom.removeEventListener("mousemove", onMove);
      dom.removeEventListener("mouseleave", onLeave);
      document.removeEventListener("mousemove", onDocMove);
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
        setTableHandleMenuOpen(editor, false);
      } else {
        setTick((t) => t + 1);
      }
    };
    editor.on("transaction", onTransaction);
    return () => {
      editor.off("transaction", onTransaction);
      setTableHandleMenuOpen(editor, false);
    };
  }, [editor]);

  const openMenu = useCallback(
    (axis: TableLineAxis) => {
      const current = hoverRef.current;
      const cell = current ? resolveCell(current) : null;
      const pos = cell ? editor.view.posAtDOM(cell, 0) : -1;
      // セル選択バブルメニューと重ならないよう、行 / 列選択のディスパッチ前にフラグを立てる
      setTableHandleMenuOpen(editor, true);
      if (pos < 0 || !selectTableLine(editor, pos, axis)) {
        // 解決できないピルを残すとクリックが無反応になる。正直に消して再ホバーさせる
        setTableHandleMenuOpen(editor, false);
        setHover(null);
        setOpenAxis(null);
        return;
      }
      openedAtRef.current = Date.now();
      setOpenAxis(axis);
    },
    [editor],
  );

  const closeMenu = useCallback(() => {
    setOpenAxis(null);
    setTableHandleMenuOpen(editor, false);
    // CellSelection のまま放置すると次のキー入力で行 / 列全体が上書きされるため畳む
    collapseCellSelection(editor);
  }, [editor]);

  // Radix のトグルは開いた直後の閉も拾う。ダブルクリック癖で「開→即閉」になり
  // 「クリックしてもメニューが出ない」ように見えるため、開直後の閉トグルは無視する
  const onOpenChange = useCallback(
    (axis: TableLineAxis) => (open: boolean) => {
      if (open) {
        openMenu(axis);
      } else if (Date.now() - openedAtRef.current > REOPEN_GUARD_MS) {
        closeMenu();
      }
    },
    [openMenu, closeMenu],
  );

  // 外側クリックによる正当な dismiss は開直後ガードを通さず即閉じる。
  // ただしピル上のクリックは除外（ダブルクリック2打目・ピル切替はトグル側の管轄）
  const handleInteractOutside = useCallback(
    (target: Node | null) => {
      if (
        target &&
        (rowPillRef.current?.contains(target) || colPillRef.current?.contains(target))
      ) {
        return;
      }
      closeMenu();
    },
    [closeMenu],
  );

  // メニュー表示中もフォーカスはエディタに残る（onOpenAutoFocus を止めている）ため、
  // 行・列の CellSelection がキー入力のターゲットになり、1 キーで行・列の全セルが
  // 上書きされてしまう。capture でキーを検知したら先にメニューを閉じて選択を畳み、
  // キー自体は畳んだ後のカーソルに対して通常どおり処理させる。
  useEffect(() => {
    if (!openAxis) return;
    const dom = editor.view.dom as HTMLElement;
    const onKeyDown = (e: KeyboardEvent) => {
      // 修飾キー単独では閉じない（Ctrl+C の1打鍵目で行・列の選択を失わないように）
      if (e.key === "Control" || e.key === "Meta" || e.key === "Shift" || e.key === "Alt") return;
      // コピーは CellSelection のネイティブコピーに任せ、選択とメニューを維持する
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c") return;
      if (e.ctrlKey && e.key === "Insert") return;
      closeMenu();
    };
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
      setTableHandleMenuOpen(editor, false);
    },
    [editor],
  );

  // テーブル全体をクリップボードへコピー（HTML + TSV）。メニューは閉じる
  const handleCopyTable = useCallback(() => {
    void copyTableToClipboard(editor).then((ok) => {
      if (ok) toast.success("テーブルをコピーしました");
      else toast.error("テーブルをコピーできませんでした");
    });
    closeMenu();
  }, [editor, closeMenu]);

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
      <Popover open={openAxis === "row"} onOpenChange={onOpenChange("row")}>
        <PopoverTrigger asChild>
          <button
            ref={rowPillRef}
            type="button"
            aria-label="行を選択"
            aria-haspopup="menu"
            onMouseDown={(e) => e.preventDefault()}
            onPointerDown={cancelHide}
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
        <LineMenuContent axis="row" runOp={runOp} applyStyle={applyStyle} onCopyTable={handleCopyTable} onInteractOutside={handleInteractOutside} />
      </Popover>

      {/* 列ハンドル: 列の上端中央（テーブル上罫線をまたぐ） */}
      <Popover open={openAxis === "column"} onOpenChange={onOpenChange("column")}>
        <PopoverTrigger asChild>
          <button
            ref={colPillRef}
            type="button"
            aria-label="列を選択"
            aria-haspopup="menu"
            onMouseDown={(e) => e.preventDefault()}
            onPointerDown={cancelHide}
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
        <LineMenuContent axis="column" runOp={runOp} applyStyle={applyStyle} onCopyTable={handleCopyTable} onInteractOutside={handleInteractOutside} />
      </Popover>
    </>
  );
}
