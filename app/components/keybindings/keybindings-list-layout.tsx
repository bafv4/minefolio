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
import { sortKeybindingsRows } from "./keybindings-columns";
import { UserFilterChips } from "./user-filter";
import type { KeybindingsRow, PresetKey } from "./keybindings-columns";
import { useKeybindingsFilters } from "@/hooks/use-keybindings-filters";
import { hasKeyBindings, hasKeyboardContent, hasMouseSettings } from "@/lib/keybindings-filter";
import {
  COMBAT_UI_ACTIONS,
  HOTBAR_ACTIONS,
  INVENTORY_ACTIONS,
  MOVEMENT_ACTIONS,
  type Tab,
} from "@/lib/keybindings-search-params";
import { useLocale, useT } from "@/hooks/use-locale";
import type { MessageKey } from "@/lib/messages";

/** インベントリのタブに載る操作（ホットバー 1〜9 を含む） */
const INVENTORY_TAB_ACTIONS: readonly string[] = [...INVENTORY_ACTIONS, ...HOTBAR_ACTIONS];

/** ページ共通タイトル。h1 はビュー（表 / ビジュアル / 統計）の名前、説明文は共通 */
export function KeybindingsPageTitle({ title }: { title?: string }) {
  const t = useT();
  return (
    <div>
      <h1 className="text-2xl font-bold flex items-center gap-2">
        <Keyboard className="h-6 w-6" aria-hidden />
        {title ?? t("keybindings.title")}
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
  const locale = useLocale();
  const filters = useKeybindingsFilters();
  const tab = filters.params.tab;
  // ビュー切替（/keybindings ⇄ /visual ⇄ /stats）中は本体をスケルトンに差し替える
  const { isTabSwitching, targetPathname } = useTabNavigation();

  // フィルタ適用（数値範囲・ユーザー絞り込みはクライアント側）
  const { applyToPlayers } = filters;
  const filteredPlayers = useMemo(
    () => applyToPlayers(players),
    [players, applyToPlayers],
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
    () => filteredPlayers.filter((p) => hasMouseSettings(p.playerConfig)),
    [filteredPlayers],
  );
  // キーのタブは、そのタブの列がすべて「未割り当て」の走者を載せない（マウスタブの「設定のある走者のみ」と同じ扱い）
  const movementPlayers = useMemo(
    () => filteredPlayers.filter((p) => hasKeyBindings(p, MOVEMENT_ACTIONS)),
    [filteredPlayers],
  );
  const inventoryPlayers = useMemo(
    () => filteredPlayers.filter((p) => hasKeyBindings(p, INVENTORY_TAB_ACTIONS)),
    [filteredPlayers],
  );
  const combatUiPlayers = useMemo(
    () => filteredPlayers.filter((p) => hasKeyBindings(p, COMBAT_UI_ACTIONS)),
    [filteredPlayers],
  );
  // ビジュアルは、キーボードに描くものが何も無い走者（空のカードになる）を載せない
  const visualBase = useMemo(
    () => filteredPlayers.filter(hasKeyboardContent),
    [filteredPlayers],
  );

  const rowsByTab: Record<Tab, KeybindingsRow[]> = {
    movement: movementPlayers,
    inventory: inventoryPlayers,
    "combat-ui": combatUiPlayers,
    remaps: remapsPlayers,
    "custom-actions": customActionsPlayersFiltered,
    mouse: mousePlayersFiltered,
  };

  // ビジュアルは表と同じ並べ替え（URL の sort）で並べる
  const { sort } = filters;
  const visualPlayers = useMemo(
    () => sortKeybindingsRows(visualBase, sort, t, locale),
    [visualBase, sort, t, locale],
  );
  // 件数は、いま見えている表の行数（タブごとに母集団が違う）。ビジュアルは絞り込み後の全走者
  const visibleCount = mode === "visual" ? visualBase.length : rowsByTab[tab].length;

  return (
    <div className="flex-1 flex flex-col space-y-6">
      <KeybindingsPageTitle
        title={mode === "visual" ? t("keybindings.visualTitle") : undefined}
      />

      {/* ツールバー: ビュー切替 / 件数 / フィルター（全幅ベースライン行に統合） */}
      <div className="flex flex-col gap-3">
        <ViewSwitcher
          actions={
            <>
              {/* 件数の変化を読み上げる（aria-live は描画済みの領域の変化だけを読むので、初回表示では読まれない） */}
              <span className="text-sm text-muted-foreground tabular-nums" aria-live="polite">
                {t("keybindings.countText", {
                  count: visibleCount,
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
          <CardView players={visualPlayers} />
        ) : (
          <Tabs
            value={tab}
            onValueChange={(v) => filters.setTab(v as Tab)}
            // overflow-clip: 既定の overflow-hidden はスクロールコンテナになり、md 未満で表の見出しを
            // ページに貼り付ける sticky を止めてしまう（clip は角丸の切り抜きだけ残す）
            className="w-full overflow-clip"
          >
            <TabsList scrollFade>
              {TAB_ITEMS.map(({ value, labelKey, icon: Icon, color }) => (
                <TabsTrigger key={value} value={value} className="gap-1.5 max-md:h-11">
                  <Icon
                    className="h-4 w-4"
                    style={color ? { color } : undefined}
                  />
                  {t(labelKey)}
                </TabsTrigger>
              ))}
            </TabsList>

            {TAB_ITEMS.map(({ value, labelKey }) => (
              <TabsContent
                key={value}
                value={value}
                className="p-0 pt-px sm:p-0 sm:pt-px"
              >
                <KeybindingsTable
                  rows={rowsByTab[value]}
                  preset={value as PresetKey}
                  label={t(labelKey)}
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
