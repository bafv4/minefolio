import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import type { LucideIcon } from "lucide-react";

import { hotbarTabForKey, type ProfileHotbarGroup } from "@/lib/profile-hotbar";
import { cn } from "@/lib/utils";
import { useT } from "@/hooks/use-locale";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export interface ProfileHotbarItem {
  value: string;
  icon: LucideIcon;
  /** スロットに常時表示する短いラベル */
  shortLabel: string;
  /** 長いラベル（短いラベルと異なるときはツールチップに出す） */
  label: string;
  /** 未登録（中身が無い）スロット。押せる状態は保つ */
  empty: boolean;
  group: ProfileHotbarGroup;
}

interface ProfileHotbarTabsProps {
  /** 並び順どおり。数字キー 1〜9 がこの順に対応する */
  items: readonly ProfileHotbarItem[];
  activeValue: string;
  onSelect: (value: string) => void;
}

/**
 * プロフィール専用のホットバー型タブ列。
 *
 * 消費側の Root（`ui/tabs` の `<Tabs>`）には `activationMode="manual"`（矢印キーはフォーカス移動のみ、
 * Enter/Space で切替）を付け、向きは既定の horizontal のままにする。タブ切替を履歴に積むため、
 * 矢印で動くたびに履歴が増えるのを避ける。`ui/tabs` の TabsList / TabsTrigger（フォルダ型）は使わない。
 *
 * - md 以上: 通常フロー内に横一列のスロット（アイコン＋短いラベル）
 * - md 未満: 画面下端固定（`data-bottom-dock`。高さは app.css の `--bottom-dock-height`）。アイコンのみ
 * - 数字キーはこの tablist にフォーカスがあるときだけ効く（ページ全体のキー監視はしない）
 */
export function ProfileHotbarTabs({ items, activeValue, onSelect }: ProfileHotbarTabsProps) {
  const t = useT();
  const triggerRefs = React.useRef(new Map<string, HTMLButtonElement>());
  const active = items.find((i) => i.value === activeValue);

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const target = hotbarTabForKey(
      e,
      items.map((i) => i.value),
    );
    if (target === null) return;
    e.preventDefault();
    if (target === activeValue) return;
    onSelect(target);
    triggerRefs.current.get(target)?.focus();
  }

  return (
    <div
      data-bottom-dock
      className="max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:z-40 max-md:h-[var(--bottom-dock-height)] max-md:border-t max-md:border-border max-md:bg-background/95 max-md:pb-[env(safe-area-inset-bottom,0px)] max-md:backdrop-blur"
    >
      <p
        aria-hidden="true"
        className="truncate px-3 pt-1 text-center text-xs font-medium leading-5 text-muted-foreground md:hidden"
      >
        {active?.label}
      </p>
      <TabsPrimitive.List
        aria-label={t("playerProfile.hotbarAriaLabel")}
        onKeyDown={handleKeyDown}
        className="flex items-center gap-0.5 px-1 pt-1 md:w-fit md:gap-1.5 md:p-0"
      >
        {items.map((item, index) => {
          const Icon = item.icon;
          const showTooltip = item.label !== item.shortLabel;
          const baseName = item.label.includes(item.shortLabel) ? item.label : item.shortLabel;
          const name = item.empty
            ? `${baseName}${t("playerProfile.hotbarEmptySuffix")}`
            : baseName;
          const prev = items[index - 1];
          const trigger = (
            <TabsPrimitive.Trigger
              ref={(el) => {
                if (el) triggerRefs.current.set(item.value, el);
                else triggerRefs.current.delete(item.value);
              }}
              value={item.value}
              aria-label={name}
              className={cn(
                "flex min-w-9 flex-1 flex-col items-center justify-center gap-1 rounded-lg border-2 text-muted-foreground transition-colors outline-none",
                "h-11 md:size-[4.5rem] md:flex-none",
                "hover:bg-muted/60 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50",
                // 選択状態は aria-selected で判定する。ツールチップ付きのスロットは TooltipTrigger（asChild）が
                // data-state を closed / delayed-open で上書きするため、data-[state=active] が効かない
                "aria-selected:border-foreground aria-selected:bg-secondary/50 aria-selected:text-foreground",
                item.empty
                  ? "border-dashed border-border/70"
                  : "border-transparent md:border-border/70",
                item.empty && "aria-selected:border-solid",
              )}
            >
              <Icon aria-hidden="true" className="size-5 shrink-0" />
              <span aria-hidden="true" className="hidden text-xs leading-none md:block">
                {item.shortLabel}
              </span>
            </TabsPrimitive.Trigger>
          );
          return (
            <React.Fragment key={item.value}>
              {prev && prev.group !== item.group && (
                <span
                  aria-hidden="true"
                  className="mx-0.5 h-6 w-px shrink-0 bg-border md:mx-1.5 md:h-10"
                />
              )}
              {showTooltip ? (
                <Tooltip>
                  <TooltipTrigger asChild>{trigger}</TooltipTrigger>
                  <TooltipContent className="max-md:hidden">{item.label}</TooltipContent>
                </Tooltip>
              ) : (
                trigger
              )}
            </React.Fragment>
          );
        })}
      </TabsPrimitive.List>
    </div>
  );
}
