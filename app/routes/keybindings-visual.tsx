// /keybindings/visual — ビジュアル（カード）ビュー。
import { useLoaderData } from "react-router";
import type { Route } from "./+types/keybindings-visual";
import { createDb } from "@/lib/db";
import { getEnv } from "@/lib/env.server";
import { loadKeybindingsListPlayers } from "@/lib/keybindings-list.server";
import { KeybindingsListLayout } from "@/components/keybindings/keybindings-list-layout";
import { t } from "@/lib/messages";

export const meta: Route.MetaFunction = ({ loaderData }) => {
  const title = t("keybindings.metaTitle");
  const description = t("keybindings.description");
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
  const players = await loadKeybindingsListPlayers(db);
  return { players, appUrl };
}

export default function KeybindingsVisualPage() {
  const { players } = useLoaderData<typeof loader>();
  return <KeybindingsListLayout players={players} mode="visual" />;
}
