// /keybindings/stats — 統計ビュー（独立ルート）。
import { useLoaderData } from "react-router";
import type { Route } from "./+types/keybindings-stats";
import { createDb } from "@/lib/db";
import { getEnv } from "@/lib/env.server";
import { loadKeybindingsStats } from "@/lib/keybindings-stats.server";
import { StatsView } from "@/components/keybindings/stats-view";
import { ViewSwitcher } from "@/components/keybindings/view-switcher";
import { KeybindingsPageTitle } from "@/components/keybindings/keybindings-list-layout";
import { t } from "@/lib/messages";

export const meta: Route.MetaFunction = ({ loaderData }) => {
  const title = t("keybindingsStats.metaTitle");
  const description = t("keybindingsStats.description");
  const appUrl = loaderData?.appUrl || "https://minefolio.pages.dev";
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

export async function loader({ context }: Route.LoaderArgs) {
  const env = getEnv();
  const db = createDb();
  const appUrl = env.APP_URL || "https://minefolio.pages.dev";
  const stats = await loadKeybindingsStats(db);
  return { stats, appUrl };
}

export default function KeybindingsStatsPage() {
  const { stats } = useLoaderData<typeof loader>();
  return (
    <div className="flex-1 flex flex-col space-y-5">
      <KeybindingsPageTitle />
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <ViewSwitcher />
      </div>
      <StatsView data={stats} />
    </div>
  );
}
