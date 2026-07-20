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
import { KeybindingsTable } from "./keybindings-table";
import { CardView } from "./card-view";
import { UserFilterChips } from "./user-filter";
import type { KeybindingsRow, PresetKey } from "./keybindings-columns";
import { useKeybindingsFilters } from "@/hooks/use-keybindings-filters";
import type { Tab } from "@/lib/keybindings-search-params";
import { t } from "@/lib/messages";

/** ページ共通タイトル（全ビューで同一） */
export function KeybindingsPageTitle() {
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
  const filters = useKeybindingsFilters();
  const tab = filters.params.tab;

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

      {/* ツールバー: ビュー切替 / 件数 / フィルター */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <ViewSwitcher />
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground tabular-nums">
              {t("keybindings.countText", {
                count: filteredPlayers.length,
                suffix: t("keybindings.countSuffix"),
              })}
            </span>
            <FilterDialog players={players} />
          </div>
        </div>
        <UserFilterChips players={players} />
      </div>

      {/* 本体 */}
      <div>
        {mode === "visual" ? (
          <CardView players={filteredPlayers} />
        ) : (
          <Tabs
            value={tab}
            onValueChange={(v) => filters.setTab(v as Tab)}
            className="w-full"
          >
            <TabsList>
              {TAB_ITEMS.map(({ value, label, icon: Icon, color }) => (
                <TabsTrigger key={value} value={value} className="gap-1.5">
                  <Icon
                    className="h-4 w-4"
                    style={color ? { color } : undefined}
                  />
                  {label}
                </TabsTrigger>
              ))}
            </TabsList>

            {TAB_ITEMS.map(({ value }) => (
              <TabsContent key={value} value={value}>
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

/** 表ビューのサブタブ定義（操作はプレイヤー画面と同じ粒度で分割） */
const TAB_ITEMS: Array<{
  value: Tab;
  label: string;
  icon: typeof Keyboard;
  color?: string;
}> = [
  {
    value: "movement",
    label: t("keybindings.movementTab"),
    icon: Footprints,
    color: "var(--key-movement)",
  },
  {
    value: "inventory",
    label: t("keybindings.inventoryTab"),
    icon: Package,
    color: "var(--key-inventory)",
  },
  {
    value: "combat-ui",
    label: t("keybindings.combatUiTab"),
    icon: Swords,
    color: "var(--key-combat)",
  },
  { value: "remaps", label: t("keybindings.remapsTab"), icon: ArrowLeftRight },
  {
    value: "custom-actions",
    label: t("keybindings.customActionsTab"),
    icon: WandSparkles,
  },
  { value: "mouse", label: t("keybindings.mouseTab"), icon: Mouse },
];
