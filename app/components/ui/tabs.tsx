import * as React from "react"
import * as TabsPrimitive from "@radix-ui/react-tabs"

import { cn } from "@/lib/utils"

function Tabs({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn("flex flex-col", className)}
      {...props}
    />
  )
}

function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        // フォルダタブのトラック。ベースライン（1px の横線）は直後の TabsContent の
        // 上ボーダーが担う。リスト全体を -mb-px で 1px 重ね、relative z-[1] で
        // パネルより手前に描画することで、アクティブタブの背景がベースラインを覆い
        // タブとパネルが一続きの面に見える。オーバーフロー時は横スクロール
        // （重なりはリストの「外側」で起きるため overflow-x-auto にクリップされない）。
        // スクロールバーは非表示（Windows のクラシックスクロールバーがリスト内に
        // 高さを取るとタブがベースラインから浮くため）。
        "relative z-[1] -mb-px flex w-full items-end justify-start gap-1 overflow-x-auto text-muted-foreground [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        className
      )}
      {...props}
    />
  )
}

function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        // 形状: 上だけ丸いフォルダタブ。border は常に確保（アクティブ切替での
        // レイアウトシフト防止）し、非アクティブ時は透明。
        "relative inline-flex h-9 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-t-lg border border-transparent px-3.5 text-sm font-medium transition-colors",
        // 非アクティブ: ホバーで文字色とうっすら背景
        "hover:text-foreground data-[state=inactive]:hover:bg-muted/50",
        // アクティブ: パネルと同じ面（bg-card）+ 上・左・右ボーダー。下ボーダーは
        // 透明のまま — background-clip: border-box（既定）により bg-card がその
        // 1px 帯まで塗られ、直下のパネル上辺ボーダー（ベースライン）を覆って連結する。
        "data-[state=active]:border-border data-[state=active]:border-b-transparent data-[state=active]:bg-card data-[state=active]:text-foreground",
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
        // パネル。上ボーダーがタブ列のベースラインを兼ねる（TabsList が -mb-px で重なる）。
        // padding・枠は消費側 className の last-wins（tailwind-merge）で調整可能。
        // 注意: display 系ユーティリティを足さないこと（非アクティブパネルの hidden 属性が無効化される）。
        "flex-1 rounded-b-xl border bg-card p-4 text-card-foreground outline-none sm:p-6",
        className
      )}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent }
