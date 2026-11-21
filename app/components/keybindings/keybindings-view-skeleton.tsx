// キー配置のビュー切替（表 / ビジュアル / 統計）中に本体へ出すスケルトン。
// ui.md 8 章「本物と同じ配置で描き、高さを先に確保する」に合わせ、遷移先ごとの形（行の高さ・列数・カードの余白）を
// 本物のソースの値から写している（汎用の TabContentSkeleton は他の画面と共用なので使わない）。
import { Skeleton } from "@/components/ui/skeleton";

export type KeybindingsViewSkeletonVariant = "table" | "visual" | "stats";

/** 遷移先のパスから、出すスケルトンの形を決める */
export function skeletonVariantForPath(pathname: string | null): KeybindingsViewSkeletonVariant {
  if (pathname === "/keybindings") return "table";
  if (pathname === "/keybindings/stats") return "stats";
  return "visual";
}

export function KeybindingsViewSkeleton({ variant }: { variant: KeybindingsViewSkeletonVariant }) {
  if (variant === "table") {
    // 本物: フォルダ型タブ（pt-1.5 ＋ トリガー h-9 ＝ 42px。md 未満はトリガー max-md:h-11 で 50px。
    // 横スクロールが出る幅では pt-2.5 で 4px 増えるが、スクロールの有無は描画前に分からないので通常値に合わせる）＋ 見出し行（py-2 ＋ 24px ＝ 40px）＋ 走者の行
    // （py-2 ＋ アバター 32px ＋ 下線 1px ＝ 49px。行どうしに隙間なし）
    return (
      <div aria-hidden className="overflow-clip rounded-xl border border-border/70 bg-card">
        <Skeleton className="h-[50px] w-full rounded-none md:h-[42px]" />
        <Skeleton className="mt-px h-10 w-full rounded-none" />
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex h-[49px] items-center gap-2 border-b border-border/40 px-2">
            <Skeleton className="size-8 shrink-0 rounded-lg" />
            <Skeleton className="h-4 w-24" />
          </div>
        ))}
      </div>
    );
  }
  if (variant === "stats") {
    // 本物: 概要の 1 行 ＋ タブ ＋ 箱なしの欄（見出し ＋ 補足 ＋ 行）を md で 2 列・lg で 3 列
    return (
      <div aria-hidden className="space-y-6">
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-[50px] w-full rounded-none md:h-[42px]" />
        <div className="grid gap-x-8 gap-y-8 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="min-w-0 space-y-3">
              <div className="space-y-0.5">
                <Skeleton className="h-6 w-1/2" />
                <Skeleton className="h-5 w-1/3" />
              </div>
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, j) => (
                  <Skeleton key={j} className="h-9 w-full" />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }
  // visual: 1 列の走者カード（card-view.tsx の RunnerKeyboardCard と同じ gap / 余白、プレビューは同じ高さ）
  return (
    <div aria-hidden className="flex flex-col gap-4">
      {Array.from({ length: 2 }).map((_, i) => (
        <div
          key={i}
          className="flex flex-col gap-3 rounded-xl border bg-card py-5 shadow-sm"
        >
          <div className="flex items-center gap-2 px-5">
            <Skeleton className="size-8 shrink-0 rounded-lg" />
            <Skeleton className="h-5 w-32" />
          </div>
          <div className="px-5">
            <Skeleton className="aspect-[479/508] md:aspect-auto md:h-[550px]" />
          </div>
        </div>
      ))}
    </div>
  );
}
