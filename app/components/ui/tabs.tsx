import * as React from "react"
import * as TabsPrimitive from "@radix-ui/react-tabs"

import { cn } from "@/lib/utils"
import { useTabScrollbar } from "@/hooks/use-tab-scrollbar"

function Tabs({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      // ルートがタブ列 + コンテンツ全体を囲む 1 枚のカードになる。
      // overflow-hidden でタブ帯（TabsList の bg）を角丸にクリップする。
      // カード化が不要な場面（Dialog 内・独自レイアウト）は消費側で
      // rounded-none border-0 bg-transparent overflow-visible を指定して打ち消す。
      className={cn("flex flex-col overflow-hidden rounded-xl border bg-card", className)}
      {...props}
    />
  )
}

function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  // ネイティブのスクロールバーは帯内に高さを取りタブがベースラインから浮くため
  // 非表示にし、代わりにレイアウト高さを取らないオーバーレイのカスタム
  // スクロールバー（スクロール可能時のみ表示・ドラッグ可）をラッパに重ねる。
  const { scrollerRef, scrollbar, isScrollable } = useTabScrollbar()
  return (
    // ラッパは非スクロールの relative 親（つまみの位置基準 + z-[1] の持ち主）。
    // List の -mb-px でラッパの高さが 1px 縮み、List の描画がラッパ下端から
    // 1px はみ出して直後の TabsContent 上ボーダーに重なる（クリップされない）。
    <div className="relative z-[1] w-full">
      <TabsPrimitive.List
        ref={scrollerRef}
        data-slot="tabs-list"
        className={cn(
          // カード上部の「フォルダの引き出し」帯。bg-muted/40 でコンテンツ面と区別し、
          // px-1.5 pt-1.5 で上下左右均等に帯の面をのぞかせる（下方向だけ -mb-px の
          // 重なり機構のため pb は付けない）。
          // ベースライン（1px の横線）は直後の TabsContent の上ボーダーが担う。
          // 帯全体を -mb-px で 1px 重ねることで、アクティブタブの背景（bg-card）が
          // ベースラインを覆いパネルと連結する。
          // オーバーフロー時は横スクロール（重なりは帯の「外側」で起きるためクリップされない）。
          "relative -mb-px flex w-full items-end justify-start gap-1 overflow-x-auto bg-muted/40 px-1.5 pt-1.5 text-muted-foreground [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          // スクロールが必要なときだけ、カードとタブの間を広げてスクロールバーの余白を確保
          isScrollable && "pt-2.5",
          className
        )}
        {...props}
      />
      {scrollbar}
    </div>
  )
}

function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        // 形状: 上だけ丸いフォルダタブ。全タブ常時 1px 枠（非アクティブも枠 + muted の
        // 面を持ち「フォルダの束」として見える。下ボーダーはベースラインの延長として
        // パネル上辺ボーダーと同色・同位置で重なる）。
        "relative inline-flex h-9 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-t-lg border border-border px-3.5 text-sm font-medium transition-colors",
        // 非アクティブ: くぼんだ muted の面。ホバーで明るく
        "data-[state=inactive]:bg-muted/50 hover:text-foreground data-[state=inactive]:hover:bg-muted/80",
        // アクティブ: パネルと同じ面（bg-card）+ 上・左・右ボーダー。下ボーダーは
        // 透明 — background-clip: border-box（既定）により bg-card がその
        // 1px 帯まで塗られ、直下のパネル上辺ボーダー（ベースライン）を覆って連結する。
        "data-[state=active]:border-b-transparent data-[state=active]:bg-card data-[state=active]:text-foreground",
        // ブランドアクセントバー（アクティブタブの上辺内側）
        "before:pointer-events-none before:absolute before:inset-x-2 before:top-0 before:h-0.5 before:rounded-full data-[state=active]:before:bg-brand",
        // フォーカスリングは inset — スクロールコンテナ（TabsList）にクリップされない
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
        "disabled:pointer-events-none disabled:opacity-50",
        "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn(
        // コンテンツ面。外枠・角丸はルートのカードが持つため、ここは上ボーダーのみ
        //（タブ帯とのベースラインを兼ねる。TabsList が -mb-px で重なる）。
        // padding は消費側 className の last-wins（tailwind-merge）で調整可能。
        // 注意: display 系ユーティリティを足さないこと（非アクティブパネルの hidden 属性が無効化される）。
        "flex-1 border-t bg-card p-4 text-card-foreground outline-none sm:p-6",
        className
      )}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent }
