// /keybindings/stats — 統計ビュー（独立ルート）。
import { useLoaderData } from "react-router";
import type { Route } from "./+types/keybindings-stats";
import { createDb } from "@/lib/db";
import { getEnv } from "@/lib/env.server";
import { loadKeybindingsStats } from "@/lib/keybindings-stats.server";
import { StatsView } from "@/components/keybindings/stats-view";
import { ViewSwitcher } from "@/components/keybindings/view-switcher";
import { KeybindingsPageTitle } from "@/components/keybindings/keybindings-list-layout";
import { TabContentSkeleton } from "@/components/tab-content-skeleton";
import { useTabNavigation } from "@/hooks/use-tab-navigation";
import { t } from "@/lib/messages";

export const meta: Route.MetaFunction = ({ loaderData }) => {
  const title = t("keybindingsStats.metaTitle");
  const description = t("keybindingsStats.description");
  const appUrl = loaderData?.appUrl || "https://minefolio.app";
  const ogImage = `${appUrl}/icon.png`;
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

export async function loader() {
  const env = getEnv();
  const db = createDb();
  const appUrl = env.APP_URL || "https://minefolio.app";
  const stats = await loadKeybindingsStats(db);
  return { stats, appUrl };
}

export default function KeybindingsStatsPage() {
  const { stats } = useLoaderData<typeof loader>();
  // ビュー切替（→ /keybindings, /keybindings/visual）中は本体をスケルトンに差し替える
  const { isTabSwitching, targetPathname } = useTabNavigation();
  return (
    <div className="flex-1 flex flex-col space-y-5">
      <KeybindingsPageTitle />
      <ViewSwitcher />
      {isTabSwitching ? (
        <TabContentSkeleton
          variant={targetPathname === "/keybindings" ? "table" : "cards"}
        />
      ) : (
        <StatsView data={stats} />
      )}
    </div>
  );
}
