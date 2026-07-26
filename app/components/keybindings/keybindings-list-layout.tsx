// /keybindings（表）と /keybindings/visual（ビジュアル）で共有するレイアウト。
// タイトル・ツールバー（ビュー切替 / 件数 / フィルター）・フィルタ適用を一元化し、
// mode によって本体を「表（Tabs）」か「ビジュアル（カード）」に切り替える。
import { useMemo } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Keyboard,
  Mouse,
  WandSparkles,
  Footprints,
  Package,
  Swords,
  ArrowLeftRight,
} from "lucide-react";
import { ViewSwitcher } from "./view-switcher";
import { FilterDialog } from "./filter-dialog";
import { TabContentSkeleton } from "@/components/tab-content-skeleton";
import { useTabNavigation } from "@/hooks/use-tab-navigation";
import { KeybindingsTable } from "./keybindings-table";
import { CardView } from "./card-view";
import { UserFilterChips } from "./user-filter";
import type { KeybindingsRow, PresetKey } from "./keybindings-columns";
import { useKeybindingsFilters } from "@/hooks/use-keybindings-filters";
import type { Tab } from "@/lib/keybindings-search-params";
import { useT } from "@/hooks/use-locale";
import type { MessageKey } from "@/lib/messages";

/** ページ共通タイトル（全ビューで同一） */
export function KeybindingsPageTitle() {
  const t = useT();
  return (
    <div>
      <h1 className="text-2xl font-bold flex items-center gap-2">
        <Keyboard className="h-6 w-6" />
        {t("keybindings.title")}
      </h1>
      <p className="text-sm text-muted-foreground mt-1">
        {t("keybindings.description")}
      </p>
    </div>
  );
}

export function KeybindingsListLayout({
  players,
  mode,
}: {
  players: KeybindingsRow[];
  mode: "table" | "visual";
}) {
  const t = useT();
  const filters = useKeybindingsFilters();
  const tab = filters.params.tab;
  // ビュー切替（/keybindings ⇄ /visual ⇄ /stats）中は本体をスケルトンに差し替える
  const { isTabSwitching, targetPathname } = useTabNavigation();

  // フィルタ適用（数値範囲・ユーザー絞り込みはクライアント側）
  const filteredPlayers = useMemo(
    () => filters.applyToPlayers(players),
    [players, filters],
  );
  const remapsPlayers = useMemo(
    () => filteredPlayers.filter((p) => p.keyRemaps.length > 0),
    [filteredPlayers],
  );
  const customActionsPlayersFiltered = useMemo(
    () => filteredPlayers.filter((p) => p.customActions.length > 0),
    [filteredPlayers],
  );
  const mousePlayersFiltered = useMemo(
    () =>
      filteredPlayers.filter((p) => {
        const c = p.playerConfig;
        return (
          c != null &&
          (c.mouseDpi != null ||
            c.gameSensitivity != null ||
            c.windowsSpeed != null ||
            c.windowsSpeedMultiplier != null)
        );
      }),
    [filteredPlayers],
  );

  const rowsByTab: Record<Tab, KeybindingsRow[]> = {
    movement: filteredPlayers,
    inventory: filteredPlayers,
    "combat-ui": filteredPlayers,
    remaps: remapsPlayers,
    "custom-actions": customActionsPlayersFiltered,
    mouse: mousePlayersFiltered,
  };

  return (
    <div className="flex-1 flex flex-col space-y-5">
      <KeybindingsPageTitle />

      {/* ツールバー: ビュー切替 / 件数 / フィルター（全幅ベースライン行に統合） */}
      <div className="flex flex-col gap-3">
        <ViewSwitcher
          actions={
            <>
              <span className="text-sm text-muted-foreground tabular-nums">
                {t("keybindings.countText", {
                  count: filteredPlayers.length,
                  suffix: t("keybindings.countSuffix"),
                })}
              </span>
              <FilterDialog players={players} />
            </>
          }
        />
        <UserFilterChips players={players} />
      </div>

      {/* 本体 */}
      <div>
        {isTabSwitching ? (
          <TabContentSkeleton
            variant={targetPathname === "/keybindings" ? "table" : "cards"}
          />
        ) : mode === "visual" ? (
          <CardView players={filteredPlayers} />
        ) : (
          <Tabs
            value={tab}
            onValueChange={(v) => filters.setTab(v as Tab)}
            className="w-full"
          >
            <TabsList>
              {TAB_ITEMS.map(({ value, labelKey, icon: Icon, color }) => (
                <TabsTrigger key={value} value={value} className="gap-1.5">
                  <Icon
                    className="h-4 w-4"
                    style={color ? { color } : undefined}
                  />
                  {t(labelKey)}
                </TabsTrigger>
              ))}
            </TabsList>

            {TAB_ITEMS.map(({ value }) => (
              <TabsContent
                key={value}
                value={value}
                className="p-0 pt-px sm:p-0 sm:pt-px"
              >
                <KeybindingsTable
                  rows={rowsByTab[value]}
                  preset={value as PresetKey}
                />
              </TabsContent>
            ))}
          </Tabs>
        )}
      </div>
    </div>
  );
}

/** 表ビューのサブタブ定義（操作はプレイヤー画面と同じ粒度で分割）。
 *  ラベルは描画時に t() で解決する（モジュール評価時はロケールが未確定のため） */
const TAB_ITEMS: Array<{
  value: Tab;
  labelKey: MessageKey;
  icon: typeof Keyboard;
  color?: string;
}> = [
  {
    value: "movement",
    labelKey: "keybindings.movementTab",
    icon: Footprints,
    color: "var(--key-movement)",
  },
  {
    value: "inventory",
    labelKey: "keybindings.inventoryTab",
    icon: Package,
    color: "var(--key-inventory)",
  },
  {
    value: "combat-ui",
    labelKey: "keybindings.combatUiTab",
    icon: Swords,
    color: "var(--key-combat)",
  },
  { value: "remaps", labelKey: "keybindings.remapsTab", icon: ArrowLeftRight },
  {
    value: "custom-actions",
    labelKey: "keybindings.customActionsTab",
    icon: WandSparkles,
  },
  { value: "mouse", labelKey: "keybindings.mouseTab", icon: Mouse },
];
