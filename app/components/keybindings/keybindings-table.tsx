// /keybindings の TanStack Table 本体。
// CSS Grid Table（role="grid"）+ TanStack Virtual で sticky 左列を安定化しつつ大量行に対応。
import { useMemo, useRef } from "react";
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  COLUMN_PRESETS,
  type KeybindingsRow,
  type PresetKey,
} from "./keybindings-columns";
import { useKeybindingsFilters } from "@/hooks/use-keybindings-filters";

const ROW_ESTIMATED_SIZE = 56;
/** remaps / custom-actions は内容次第で背丈が伸びるため、初期見積もりを上げる */
const ROW_ESTIMATED_SIZE_DYNAMIC = 80;

interface KeybindingsTableProps {
  rows: KeybindingsRow[];
  preset: PresetKey;
}

export function KeybindingsTable({ rows, preset }: KeybindingsTableProps) {
  const columns = COLUMN_PRESETS[preset] as ColumnDef<KeybindingsRow>[];
  const { sort, setSort } = useKeybindingsFilters();

  // TanStack Table の sorting state を URL の sort と同期
  const sorting: SortingState = useMemo(() => {
    if (!sort) return [];
    return [{ id: sort.key, desc: sort.direction === "desc" }];
  }, [sort]);

  const table = useReactTable({
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
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const rowModel = table.getRowModel();

  // スクロールコンテナ
  const scrollRef = useRef<HTMLDivElement>(null);

  const isDynamic = preset === "remaps" || preset === "custom-actions";
  const virtualizer = useVirtualizer({
    count: rowModel.rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => (isDynamic ? ROW_ESTIMATED_SIZE_DYNAMIC : ROW_ESTIMATED_SIZE),
    overscan: 8,
    measureElement: isDynamic
      ? (el) => el.getBoundingClientRect().height
      : undefined,
  });

  // grid-template-columns 値: 列の size を px で連結
  const gridTemplateColumns = useMemo(
    () =>
      columns
        .map((col) => `${col.size ?? 100}px`)
        .join(" "),
    [columns],
  );

  const headers = table.getHeaderGroups()[0]?.headers ?? [];

  return (
    <div
      ref={scrollRef}
      role="grid"
      className="relative rounded-lg border overflow-auto max-h-[70vh] [overscroll-behavior:contain] bg-card"
    >
      {/* ヘッダ行（仮想化外、sticky top） */}
      <div
        role="row"
        className="sticky top-0 z-30 grid bg-muted border-b-2 border-border text-sm font-medium"
        style={{ gridTemplateColumns }}
      >
        {headers.map((header, idx) => {
          const canSort = header.column.getCanSort();
          const sortDir = header.column.getIsSorted();
          const align =
            (header.column.columnDef.meta as { align?: string } | undefined)
              ?.align ?? "left";
          const isFirst = idx === 0;
          return (
            <div
              role="columnheader"
              key={header.id}
              className={cn(
                "flex items-center gap-1 px-2 py-2 border-r border-border/60",
                align === "center" && "justify-center",
                align === "right" && "justify-end",
                isFirst && "sticky left-0 z-10 bg-muted border-r-2",
              )}
            >
              {canSort ? (
                <button
                  type="button"
                  onClick={header.column.getToggleSortingHandler()}
                  className="inline-flex items-center gap-1 hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                >
                  {flexRender(
                    header.column.columnDef.header,
                    header.getContext(),
                  )}
                  {sortDir === "asc" ? (
                    <ArrowUp className="h-3 w-3" aria-hidden />
                  ) : sortDir === "desc" ? (
                    <ArrowDown className="h-3 w-3" aria-hidden />
                  ) : (
                    <ArrowUpDown className="h-3 w-3 opacity-40" aria-hidden />
                  )}
                </button>
              ) : (
                flexRender(header.column.columnDef.header, header.getContext())
              )}
            </div>
          );
        })}
      </div>

      {/* 仮想化された行 */}
      <div
        style={{
          height: virtualizer.getTotalSize(),
          position: "relative",
        }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const row = rowModel.rows[virtualRow.index];
          if (!row) return null;
          return (
            <div
              role="row"
              key={row.id}
              ref={isDynamic ? virtualizer.measureElement : undefined}
              data-index={virtualRow.index}
              className="absolute top-0 left-0 grid w-full hover:bg-muted/30 border-b border-border/40"
              style={{
                gridTemplateColumns,
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              {row.getVisibleCells().map((cell, idx) => {
                const align =
                  (cell.column.columnDef.meta as { align?: string } | undefined)
                    ?.align ?? "left";
                const isFirst = idx === 0;
                return (
                  <div
                    role="gridcell"
                    key={cell.id}
                    className={cn(
                      "flex items-center px-2 py-2 min-w-0",
                      align === "center" && "justify-center",
                      align === "right" && "justify-end",
                      isFirst &&
                        "sticky left-0 z-10 bg-background border-r-2 border-border",
                    )}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {rowModel.rows.length === 0 && (
        <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
          該当する走者がいません
        </div>
      )}
    </div>
  );
}
