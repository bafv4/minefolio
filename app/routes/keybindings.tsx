import { useLoaderData } from "react-router";
import { useMemo } from "react";
import type { Route } from "./+types/keybindings";
import { createDb } from "@/lib/db";
import { getEnv } from "@/lib/env.server";
import { users, keybindings, keyRemaps, customKeys, customActions } from "@/lib/schema";
import { desc, asc, like, eq, and, inArray } from "drizzle-orm";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Keyboard, Mouse, ArrowRight, WandSparkles } from "lucide-react";
import { excludeViewersCondition } from "@/lib/users-filter";
import { loadKeybindingsStats } from "@/lib/keybindings-stats.server";
import { StatsView } from "@/components/keybindings/stats-view";
import { ViewSwitcher } from "@/components/keybindings/view-switcher";
import { FilterSheet } from "@/components/keybindings/filter-sheet";
import { KeybindingsTable } from "@/components/keybindings/keybindings-table";
import { CompareView } from "@/components/keybindings/compare-view";
import { CompareBasketBar } from "@/components/keybindings/compare-basket-bar";
import { useKeybindingsFilters } from "@/hooks/use-keybindings-filters";
import { useCompareBasket } from "@/hooks/use-compare-basket";
import { t } from "@/lib/messages";

export const meta: Route.MetaFunction = ({ data }) => {
  const title = t("keybindings.metaTitle");
  const description = t("keybindings.description");
  const appUrl = data?.appUrl || "https://minefolio.pages.dev";
  const ogImage = `${appUrl}/og-image`;
  return [
    { title },
    { name: "description", content: description },
    { property: "og:type", content: "website" },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:image", content: ogImage },
    { name: "twitter:card", content: "summary" },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
    { name: "twitter:image", content: ogImage },
  ];
};

export async function loader({ context, request }: Route.LoaderArgs) {
  const env = context.env ?? getEnv();
  const db = createDb();
  const url = new URL(request.url);
  const appUrl = env.APP_URL || "https://minefolio.pages.dev";

  const view = url.searchParams.get("view") ?? "table";
  const search = url.searchParams.get("q") ?? "";

  // view=stats のとき: 統計データのみ返す
  if (view === "stats") {
    const stats = await loadKeybindingsStats(db);
    return { kind: "stats" as const, stats, search, appUrl };
  }

  // それ以外（table / grid / compare）は走者一覧をロード
  const orderBy = desc(users.createdAt);
  const baseCondition = and(
    eq(users.profileVisibility, "public"),
    excludeViewersCondition,
  );
  const searchCondition = search
    ? like(users.mcid, `%${search}%`)
    : undefined;
  const whereClause = searchCondition
    ? and(baseCondition, searchCondition)
    : baseCondition;

  const playersWithKeybindings = await db.query.users.findMany({
    where: whereClause,
    orderBy: [orderBy],
    columns: {
      id: true,
      mcid: true,
      uuid: true,
      slug: true,
      displayName: true,
      customSkinUrl: true,
    },
    with: {
      keybindings: {
        orderBy: [asc(keybindings.category), asc(keybindings.action)],
      },
      keyRemaps: {
        orderBy: [asc(keyRemaps.sourceKey)],
      },
      playerConfig: {
        columns: {
          keyboardLayout: true,
          mouseDpi: true,
          gameSensitivity: true,
          windowsSpeed: true,
          windowsSpeedMultiplier: true,
          rawInput: true,
          mouseAcceleration: true,
        },
      },
      customKeys: {
        orderBy: [asc(customKeys.category), asc(customKeys.keyName)],
      },
      customActions: {
        orderBy: [asc(customActions.displayOrder), asc(customActions.actionName)],
      },
    },
  });

  const players = playersWithKeybindings.filter(
    (p) => p.keybindings.length > 0 || p.keyRemaps.length > 0 || p.customActions.length > 0,
  );

  // view=compare のとき: ids に指定された走者だけを追加で取得（ids は順序を保持）
  if (view === "compare") {
    const idsRaw = url.searchParams.get("ids") ?? "";
    const ids = idsRaw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .slice(0, 5);
    if (ids.length === 0) {
      return { kind: "compare" as const, comparePlayers: [], players, search, appUrl };
    }
    const comparePlayersRaw = await db.query.users.findMany({
      where: and(baseCondition, inArray(users.slug, ids)),
      columns: {
        id: true,
        mcid: true,
        uuid: true,
        slug: true,
        displayName: true,
        customSkinUrl: true,
      },
      with: {
        keybindings: { orderBy: [asc(keybindings.category), asc(keybindings.action)] },
        keyRemaps: { orderBy: [asc(keyRemaps.sourceKey)] },
        playerConfig: {
          columns: {
            keyboardLayout: true,
            mouseDpi: true,
            gameSensitivity: true,
            windowsSpeed: true,
            windowsSpeedMultiplier: true,
            rawInput: true,
            mouseAcceleration: true,
          },
        },
        customKeys: { orderBy: [asc(customKeys.category), asc(customKeys.keyName)] },
        customActions: { orderBy: [asc(customActions.displayOrder), asc(customActions.actionName)] },
      },
    });
    // ids 順に並べ替え
    const orderedById = new Map(comparePlayersRaw.map((p) => [p.slug, p]));
    const comparePlayers = ids
      .map((id) => orderedById.get(id))
      .filter((p): p is NonNullable<typeof p> => p != null);
    return { kind: "compare" as const, comparePlayers, players, search, appUrl };
  }

  return { kind: "list" as const, players, search, appUrl };
}

export default function KeybindingsListPage() {
  const data = useLoaderData<typeof loader>();
  const basket = useCompareBasket();
  const filters = useKeybindingsFilters();

  // view=stats のときは統計ビューを表示
  if (data.kind === "stats") {
    return (
      <div className="flex-1 flex flex-col space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Keyboard className="h-6 w-6" />
              {t("keybindings.title")}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {t("keybindings.description")}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <ViewSwitcher compareCount={basket.count} />
          </div>
        </div>
        <StatsView data={data.stats} />
        <CompareBasketBar />
      </div>
    );
  }

  // view=compare のときは比較ビューを表示
  if (data.kind === "compare") {
    return (
      <div className="flex-1 flex flex-col space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Keyboard className="h-6 w-6" />
              {t("keybindings.title")}
            </h1>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <ViewSwitcher compareCount={data.comparePlayers.length} />
          </div>
        </div>
        <CompareView players={data.comparePlayers} />
      </div>
    );
  }

  const { players } = data;
  const tab = filters.params.tab;

  // フィルタ適用（数値範囲はクライアント、q はサーバー側で既に適用済み）
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

  return (
    <div className="flex-1 flex flex-col space-y-6">
      {/* ヘッダー */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Keyboard className="h-6 w-6" />
            {t("keybindings.title")}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t("keybindings.description")}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <FilterSheet />
          <ViewSwitcher compareCount={basket.count} />
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        {t("keybindings.countText", {
          count: filteredPlayers.length,
          suffix: t("keybindings.countSuffix"),
        })}
      </p>

      <Tabs
        value={tab}
        onValueChange={(v) =>
          filters.setTab(v as "actions" | "remaps" | "custom-actions" | "mouse")
        }
        className="w-full"
      >
        <TabsList>
          <TabsTrigger value="actions" className="gap-1.5">
            <Keyboard className="h-4 w-4" />
            {t("keybindings.actionsTab")}
          </TabsTrigger>
          <TabsTrigger value="remaps" className="gap-1.5">
            <ArrowRight className="h-4 w-4" />
            {t("keybindings.remapsTab")}
          </TabsTrigger>
          <TabsTrigger value="custom-actions" className="gap-1.5">
            <WandSparkles className="h-4 w-4" />
            {t("keybindings.customActionsTab")}
          </TabsTrigger>
          <TabsTrigger value="mouse" className="gap-1.5">
            <Mouse className="h-4 w-4" />
            {t("keybindings.mouseTab")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="actions">
          <KeybindingsTable rows={filteredPlayers} preset="actions" />
        </TabsContent>
        <TabsContent value="remaps">
          <KeybindingsTable rows={remapsPlayers} preset="remaps" />
        </TabsContent>
        <TabsContent value="custom-actions">
          <KeybindingsTable rows={customActionsPlayersFiltered} preset="custom-actions" />
        </TabsContent>
        <TabsContent value="mouse">
          <KeybindingsTable rows={mousePlayersFiltered} preset="mouse" />
        </TabsContent>
      </Tabs>
      <CompareBasketBar />
    </div>
  );
}

