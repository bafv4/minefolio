// /keybindings の TanStack Table 本体。
// CSS Grid Table（role="table"）。左端の走者列は sticky left で固定する。
//
// 行は仮想化しない（走者は高々数百で、タブごとに 1 つの表しか描かれない）。
// 仮想化していた頃は、見積もり行高と実測のずれで行の間に隙間が出る・SSR で本体の行が出ない・
// md 未満でページスクロールに任せられない（スクロール要素が表の内側に固定される）という問題があった。
//
// 見出し行は横スクロール枠の外に置き、本体の scrollLeft に追従させる（CSS 変数 --kb-scroll-left）。
// 横スクロール枠（overflow-x）の内側に置くと、sticky がページではなくその枠を基準にしてしまい、
// ページに貼り付けられないため。縦スクロールは全幅でページに任せ（内側の縦スクロール枠は持たない）、
// 見出しはサイトヘッダーの下（top-[64px]）に貼り付く。
//
// 列幅: 各列は「下限 + 余りの比例配分」の grid トラック（minmax(下限, 基準幅fr)）で、表の合計が
// 枠より狭いときは余りを全列で分け合う（右に空き帯を作らない）。下限は md 未満 / 以上で違う列があるため
// CSS 変数（--kb-*-col）で持ち、ユーザーがリサイズした列だけ px で固定する。行は w-max にせず、
// 下限の合計を min-width に渡す（w-max だと fr が中身の max-content まで広がり、チップが折り返さない）。
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type RefObject,
  type TouchEvent,
} from "react";
import { flexRender, useTable, type Header, type SortingState } from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown, Info } from "lucide-react";
import { HintTip } from "@/components/hint-tip";
import { cn } from "@/lib/utils";
import {
  columnPresets,
  keybindingsTableFeatures,
  type KeybindingsColumnDef,
  type KeybindingsFeatures,
  type KeybindingsRow,
  type PresetKey,
} from "./keybindings-columns";
import { KeybindingsEmptyState } from "./keybindings-empty-state";
import { useKeybindingsFilters } from "@/hooks/use-keybindings-filters";
import { useLocale, useT } from "@/hooks/use-locale";

interface KeybindingsTableProps {
  rows: KeybindingsRow[];
  preset: PresetKey;
  /** 表のアクセシブルネームに使うタブ名 */
  label: string;
  /** 絞り込み後の走者は居るが、このタブのデータを持つ人が居ない（0 件の文言を分ける） */
  noTabData?: boolean;
}

/**
 * 列幅の CSS 変数（md 未満 / 以上）。リサイズ後は px で上書きする。
 * - runner: 走者列。md 未満は頭＋名前の縦並びなので狭い
 * - action: 1 キーのアクション列。md 未満は 1 キーのバッジが収まる約 56px
 * - hotbar: ホットバー列。md 未満は 9 枠が 2 行に折り返して収まる 240px
 * - fill: リマップ / カスタムアクション列。md 未満は下限なし（残りの幅に収めてチップを折り返す）
 */
const COLUMN_WIDTHS =
  "[--kb-runner-col:96px] md:[--kb-runner-col:224px] [--kb-action-col:56px] md:[--kb-action-col:104px] [--kb-hotbar-col:240px] md:[--kb-hotbar-col:360px] [--kb-fill-col:0px] md:[--kb-fill-col:600px]";

type ColumnMeta = {
  align?: string;
  widthVar?: string;
  fixed?: boolean;
  /** 見出しの意味の説明（見えている文字と同じ内容のものは付けない） */
  hint?: string;
};

/** キーボードでの列幅の変更量（Shift で大きく） */
const RESIZE_STEP = 16;
const RESIZE_STEP_LARGE = 64;
const RESIZE_MAX = 1200;

export function KeybindingsTable({ rows, preset, label, noTabData }: KeybindingsTableProps) {
  const t = useT();
  const locale = useLocale();
  const columns = useMemo<KeybindingsColumnDef[]>(
    () => columnPresets(t, locale)[preset] as KeybindingsColumnDef[],
    [preset, t, locale],
  );
  const { sort, setSort } = useKeybindingsFilters();

  // TanStack Table の sorting state を URL の sort と同期
  const sorting: SortingState = useMemo(() => {
    if (!sort) return [];
    return [{ id: sort.key, desc: sort.direction === "desc" }];
  }, [sort]);

  const table = useTable({
    features: keybindingsTableFeatures,
    data: rows,
    columns,
    state: { sorting },
    onSortingChange: (updater) => {
      const next = typeof updater === "function" ? updater(sorting) : updater;
      const first = next[0];
      if (!first) {
        setSort(null, null);
      } else {
        setSort(first.id, first.desc ? "desc" : "asc");
      }
    },
    enableColumnResizing: true,
    columnResizeMode: "onChange",
    defaultColumn: { minSize: 48 },
  });

  // 列リサイズの現在値（columnSizing が変わるたびに gridTemplateColumns を再計算）
  const columnSizing = table.state.columnSizing;
  const rowModel = table.getRowModel();

  // grid-template-columns と min-width（下限の合計）。リサイズ済みの列だけ px で固定する
  const { gridTemplateColumns, minWidth } = useMemo(() => {
    const tracks: string[] = [];
    const mins: string[] = [];
    for (const col of table.getAllLeafColumns()) {
      const meta = col.columnDef.meta as ColumnMeta | undefined;
      const size = col.getSize();
      if (columnSizing[col.id] != null) {
        tracks.push(`${size}px`);
        mins.push(`${size}px`);
      } else if (meta?.fixed && meta.widthVar) {
        tracks.push(`var(${meta.widthVar})`);
        mins.push(`var(${meta.widthVar})`);
      } else {
        const min = meta?.widthVar ? `var(${meta.widthVar})` : `${size}px`;
        tracks.push(`minmax(${min}, ${size}fr)`);
        mins.push(min);
      }
    }
    return {
      gridTemplateColumns: tracks.join(" "),
      minWidth: `calc(${mins.join(" + ")})`,
    };
    // table はレンダーごとに生成されるため依存に含めない。
    // 実際に幅が変わるのは columnSizing / columns の変化時のみ。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columnSizing, columns]);

  // リサイズ開始時、いま描かれている幅（余りを配分された幅）を基準サイズに固定してから始める。
  // 固定しないと、基準サイズ（既定幅）と描画幅のずれぶん、ドラッグの開始で列が跳ねる
  const startResize = (header: Header<KeybindingsFeatures, KeybindingsRow>) => {
    const handler = header.getResizeHandler();
    return (e: MouseEvent<HTMLElement> | TouchEvent<HTMLElement>) => {
      const width = e.currentTarget.parentElement?.getBoundingClientRect().width;
      if (width) {
        table.setColumnSizing((old) => ({ ...old, [header.column.id]: Math.round(width) }));
      }
      handler(e);
    };
  };

  // キーボードでの列幅の変更・既定幅への復帰（ダブルクリック / Enter）
  const resizeBy = (columnId: string, minSize: number, current: number, delta: number) => {
    const next = Math.min(RESIZE_MAX, Math.max(minSize, Math.round(current + delta)));
    table.setColumnSizing((old) => ({ ...old, [columnId]: next }));
  };
  const resetSize = (columnId: string) => {
    table.setColumnSizing((old) => {
      const { [columnId]: _removed, ...rest } = old;
      return rest;
    });
  };
  const idBase = useId();

  const bodyRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  // 本体の横スクロール量を見出しへ渡す（再レンダーなしで CSS 変数に書く）
  const syncHeaderScroll = (scrollLeft: number) => {
    rootRef.current?.style.setProperty("--kb-scroll-left", `${scrollLeft}px`);
  };

  // 見出しセルの描画幅（余りを配分された後の幅）。リサイズハンドルの aria-valuenow に使う
  // （getSize() は基準サイズで、描画中の実幅と違う）
  const [renderedWidths, setRenderedWidths] = useState<Record<string, number>>({});
  const isEmpty = rowModel.rows.length === 0;
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const cells = Array.from(root.querySelectorAll<HTMLElement>("[role=columnheader][data-col-id]"));
    const measure = () => {
      setRenderedWidths((prev) => {
        const next: Record<string, number> = {};
        let changed = cells.length !== Object.keys(prev).length;
        for (const el of cells) {
          const id = el.dataset.colId as string;
          next[id] = Math.round(el.getBoundingClientRect().width);
          if (prev[id] !== next[id]) changed = true;
        }
        return changed ? next : prev;
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    for (const el of cells) ro.observe(el);
    return () => ro.disconnect();
  }, [isEmpty, columns, gridTemplateColumns]);

  if (rowModel.rows.length === 0) return <KeybindingsEmptyState noTabData={noTabData} />;

  const headers = table.getHeaderGroups()[0]?.headers ?? [];

  return (
    <div
      ref={rootRef}
      role="table"
      aria-label={t("keybindings.tableLabel", { tab: label })}
      aria-rowcount={rowModel.rows.length + 1}
      className={cn("relative bg-card", COLUMN_WIDTHS)}
    >
      {/* 見出し行: ページの上端（サイトヘッダーの下）に貼り付く。
          中身は本体の scrollLeft ぶん逆向きにずらし、走者列だけ打ち消して固定する */}
      <div className="sticky top-[64px] z-30 overflow-hidden border-b-2 border-border bg-muted">
        <div
          role="rowgroup"
          className="w-full"
          style={
            {
              minWidth,
              transform: "translateX(calc(var(--kb-scroll-left, 0px) * -1))",
            } as CSSProperties
          }
        >
          <div
            role="row"
            aria-rowindex={1}
            className="grid text-xs font-medium md:text-sm"
            style={{ gridTemplateColumns }}
          >
            {headers.map((header, idx) => {
              const canSort = header.column.getCanSort();
              const sortDir = header.column.getIsSorted();
              const align =
                (header.column.columnDef.meta as ColumnMeta | undefined)?.align ?? "left";
              const isFirst = idx === 0;
              const isLast = idx === headers.length - 1;
              const canResize = header.column.getCanResize();
              const hint = (header.column.columnDef.meta as ColumnMeta | undefined)?.hint;
              return (
                <div
                  role="columnheader"
                  data-col-id={header.column.id}
                  key={header.id}
                  aria-sort={
                    canSort
                      ? sortDir === "asc"
                        ? "ascending"
                        : sortDir === "desc"
                          ? "descending"
                          : "none"
                      : undefined
                  }
                  className={cn(
                    "relative flex items-center gap-1 border-r border-border/60 px-1 py-2 md:px-2",
                    align === "center" && "justify-center text-center",
                    align === "right" && "justify-end text-right",
                    isFirst && "z-10 border-r-2 bg-muted px-2",
                    // 末尾の列の右に区切りを出さない（その先に列はない）
                    isLast && !isFirst && "border-r-0",
                  )}
                  style={
                    isFirst
                      ? ({ transform: "translateX(var(--kb-scroll-left, 0px))" } as CSSProperties)
                      : undefined
                  }
                >
                  {canSort ? (
                    <button
                      type="button"
                      onClick={header.column.getToggleSortingHandler()}
                      // md 未満は狭い列でも見出しが読めるよう、矢印を文字の下に置く
                      className="inline-flex min-w-0 items-center gap-1 rounded text-inherit transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-6 max-md:min-h-11 max-md:flex-col max-md:justify-center max-md:gap-0.5"
                    >
                      {/* 省略せず折り返して全文を読めるようにする */}
                      <span id={`${idBase}-${header.id}`} className="min-w-0 break-words leading-snug">
                        {flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                      </span>
                      {sortDir === "asc" ? (
                        <ArrowUp className="h-3 w-3 shrink-0" aria-hidden />
                      ) : sortDir === "desc" ? (
                        <ArrowDown className="h-3 w-3 shrink-0" aria-hidden />
                      ) : (
                        <ArrowUpDown className="h-3 w-3 shrink-0 opacity-40" aria-hidden />
                      )}
                    </button>
                  ) : (
                    <span id={`${idBase}-${header.id}`} className="min-w-0 break-words leading-snug">
                      {flexRender(header.column.columnDef.header, header.getContext())}
                    </span>
                  )}

                  {/* 意味の説明が要る見出しだけ。並べ替えボタンの外に置く（ボタンの入れ子を避ける） */}
                  {hint && (
                    <HintTip message={hint} className="shrink-0 text-muted-foreground">
                      <Info className="size-3" aria-hidden />
                    </HintTip>
                  )}

                  {/* リサイズハンドル（右端をドラッグ。キーボードは左右キー、Enter / ダブルクリックで既定に戻す） */}
                  {canResize && (
                    <span
                      role="separator"
                      tabIndex={0}
                      aria-orientation="vertical"
                      id={`${idBase}-${header.id}-resize`}
                      aria-label={t("keybindings.resizeColumn")}
                      aria-labelledby={`${idBase}-${header.id} ${idBase}-${header.id}-resize`}
                      aria-valuenow={renderedWidths[header.column.id] ?? header.column.getSize()}
                      aria-valuemin={header.column.columnDef.minSize ?? 48}
                      aria-valuemax={RESIZE_MAX}
                      title={t("keybindings.resizeColumnReset")}
                      onMouseDown={startResize(header)}
                      onTouchStart={startResize(header)}
                      onClick={(e) => e.stopPropagation()}
                      onDoubleClick={() => resetSize(header.column.id)}
                      onKeyDown={(e: KeyboardEvent<HTMLElement>) => {
                        const step = e.shiftKey ? RESIZE_STEP_LARGE : RESIZE_STEP;
                        const min = header.column.columnDef.minSize ?? 48;
                        // 描画中の幅（余りを配分された幅）を起点にする
                        const current =
                          e.currentTarget.parentElement?.getBoundingClientRect().width ??
                          header.column.getSize();
                        if (e.key === "ArrowRight") {
                          e.preventDefault();
                          resizeBy(header.column.id, min, current, step);
                        } else if (e.key === "ArrowLeft") {
                          e.preventDefault();
                          resizeBy(header.column.id, min, current, -step);
                        } else if (e.key === "Enter") {
                          e.preventDefault();
                          resetSize(header.column.id);
                        }
                      }}
                      className={cn(
                        "absolute top-0 right-0 h-full w-1.5 cursor-col-resize select-none touch-none",
                        "hover:bg-primary/40 focus-visible:bg-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        header.column.getIsResizing() && "bg-primary/60",
                      )}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* 本体: 横スクロール枠（縦はページのスクロールに任せる）。md 以上は、長い表でも下端が画面外にならないよう
          下端に貼り付く同期スクロールバー（StickyScrollbar）を使い、この枠のネイティブバーは隠す */}
      <div
        ref={bodyRef}
        role="rowgroup"
        onScroll={(e) => syncHeaderScroll(e.currentTarget.scrollLeft)}
        className="custom-scrollbar overflow-x-auto [overscroll-behavior-x:contain] md:[scrollbar-width:none] md:[&::-webkit-scrollbar]:hidden"
      >
        {rowModel.rows.map((row, rowIndex) => (
          <div
            role="row"
            key={row.id}
            aria-rowindex={rowIndex + 2}
            className="grid w-full border-b border-border/40 hover:bg-muted/30"
            style={{ gridTemplateColumns, minWidth }}
          >
            {row.getAllCells().map((cell, idx) => {
              const align =
                (cell.column.columnDef.meta as ColumnMeta | undefined)?.align ?? "left";
              const isFirst = idx === 0;
              return (
                <div
                  role="cell"
                  key={cell.id}
                  className={cn(
                    "flex min-w-0 items-center overflow-hidden px-1 py-2 md:px-2",
                    align === "center" && "justify-center",
                    align === "right" && "justify-end",
                    isFirst &&
                      "sticky left-0 z-10 border-r-2 border-border bg-card px-2",
                  )}
                >
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <StickyScrollbar targetRef={bodyRef} />
    </div>
  );
}

/**
 * 本体の横スクロールと同期する、下端（--bottom-fixed-inset の上）に貼り付くスクロールバー（md 以上）。
 * ページスクロールにすると長い表の下端が画面外になり、横スクロールのつまみに届かなくなるため。
 * 横にあふれていないときは描かない。
 */
function StickyScrollbar({ targetRef }: { targetRef: RefObject<HTMLDivElement | null> }) {
  const proxyRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | null>(null);

  useEffect(() => {
    const target = targetRef.current;
    if (!target) return;
    const update = () => {
      setWidth(target.scrollWidth > target.clientWidth + 1 ? target.scrollWidth : null);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(target);
    for (const child of target.children) ro.observe(child);
    const onScroll = () => {
      if (proxyRef.current) proxyRef.current.scrollLeft = target.scrollLeft;
    };
    target.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      ro.disconnect();
      target.removeEventListener("scroll", onScroll);
    };
  }, [targetRef]);

  if (width == null) return null;
  return (
    <div
      ref={proxyRef}
      aria-hidden
      onScroll={(e) => {
        if (targetRef.current) targetRef.current.scrollLeft = e.currentTarget.scrollLeft;
      }}
      className="custom-scrollbar sticky bottom-[var(--bottom-fixed-inset,0px)] z-20 hidden h-3 overflow-x-auto overflow-y-hidden border-t border-border/60 bg-card md:block"
    >
      <div style={{ width, height: 1 }} />
    </div>
  );
}
