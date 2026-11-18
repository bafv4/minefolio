import type { Route } from "./+types/changelog";
import { getEnv } from "@/lib/env.server";
import { buildOgMeta } from "@/lib/og-meta";
import { History } from "lucide-react";
import { MarkdownDocPage, type CollapsedDocSection } from "@/components/markdown-doc-page";
import changelogMd from "@/content/changelog.md?raw";
import { parseChangelog } from "@/lib/changelog";
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

/** 開いたまま出す最新の版の数。これより古い版は details に畳む */
const OPEN_VERSIONS = 3;

// 版ごとに分け、最新の数版だけを本文として開き、古い版は版の見出しを summary にして畳む。
// 見出しの形式（## vX.Y.Z（YYYY/MM/DD））に合わず分けられないときは、従来どおり全文を出す
const changelogEntries = parseChangelog(changelogMd);
const versionHeading = (entry: { version: string; date: string }) => `${entry.version}（${entry.date}）`;
const openMarkdown =
  changelogEntries.length > 0
    ? changelogEntries
        .slice(0, OPEN_VERSIONS)
        .map((entry) => `## ${versionHeading(entry)}\n\n${entry.body}`)
        .join("\n\n")
    : changelogMd;
const collapsedSections: CollapsedDocSection[] = changelogEntries
  .slice(OPEN_VERSIONS)
  .map((entry) => ({ heading: versionHeading(entry), markdown: entry.body }));

export default function ChangelogPage() {
  const t = useT();
  return (
    <MarkdownDocPage
      icon={History}
      heading={t("developers.changelogTitle")}
      markdown={openMarkdown}
      collapsedSections={collapsedSections}
      backLink={{ to: "/developers", label: t("developers.heading") }}
    />
  );
}
