import type { Route } from "./+types/changelog";
import { getEnv } from "@/lib/env.server";
import { buildOgMeta } from "@/lib/og-meta";
import { History } from "lucide-react";
import { MarkdownDocPage } from "@/components/markdown-doc-page";
import changelogMd from "@/content/changelog.md?raw";
import { createTranslator } from "@/lib/messages";
import { localeFromMatches } from "@/lib/locale";
import { useT } from "@/hooks/use-locale";

export const meta: Route.MetaFunction = ({ loaderData, matches }) => {
  const t = createTranslator(localeFromMatches(matches));
  const appUrl = loaderData?.appUrl || "https://minefolio.app";
  return buildOgMeta({
    title: t("developers.changelogMetaTitle"),
    description: t("developers.changelogDescription"),
    appUrl,
  });
};

export async function loader() {
  const env = getEnv();
  return { appUrl: env.APP_URL ?? "https://minefolio.app" };
}

export default function ChangelogPage() {
  const t = useT();
  return (
    <MarkdownDocPage
      icon={History}
      heading={t("developers.changelogTitle")}
      markdown={changelogMd}
      backLink={{ to: "/developers", label: t("developers.heading") }}
    />
  );
}
