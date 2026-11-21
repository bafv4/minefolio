import { useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * キー編集ダイアログの段（操作割り当て・リマップ・指・カスタムアクション）。
 * 標準の `<details>` で開閉する（キーボード操作・読み上げは標準のまま）。見出し行に件数の要約を出すので、
 * 閉じたままでも「何が入っているか」が分かる。`defaultOpen` は**マウント時の初期値だけ**に効き、
 * 以後の開閉は利用者が決める（編集中に件数が変わっても勝手に閉じない）。
 * 別のキーを編集し直すときは、呼び出し側が `key` を変えて作り直す。
 */
export function KeyDialogSection({
  title,
  summary,
  defaultOpen = false,
  nested = false,
  className,
  children,
}: {
  title: string;
  /** 見出し行の右に出す短い要約（例: 「2件」）。 */
  summary?: string;
  defaultOpen?: boolean;
  /** 別の段の中に置くとき true。箱を二重にせず、枠を外す（段どうしの区切りは呼び出し側の divide で付ける） */
  nested?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
      className={cn("group", !nested && "rounded-lg border border-border/70", className)}
    >
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium select-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none [&::-webkit-details-marker]:hidden">
        <ChevronRight
          className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90 motion-reduce:transition-none"
          aria-hidden="true"
        />
        <span>{title}</span>
        {summary && <span className="ml-auto text-xs font-normal text-muted-foreground">{summary}</span>}
      </summary>
      <div className={cn("space-y-3 p-3", nested ? "pt-0" : "border-t border-border/60")}>{children}</div>
    </details>
  );
}
