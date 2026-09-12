import type { Route } from "./+types/api";
import { getEnv } from "@/lib/env.server";
import { buildOgMeta } from "@/lib/og-meta";
import { FileText } from "lucide-react";
import { MarkdownDocPage } from "@/components/markdown-doc-page";
import apiMd from "@/content/api.md?raw";
import { createTranslator } from "@/lib/messages";
import { localeFromMatches } from "@/lib/locale";
import { useT } from "@/hooks/use-locale";

export const meta: Route.MetaFunction = ({ loaderData, matches }) => {
  const t = createTranslator(localeFromMatches(matches));
  const appUrl = loaderData?.appUrl || "https://minefolio.app";
  return buildOgMeta({
    title: t("developers.apiMetaTitle"),
    description: t("developers.apiDescription"),
    appUrl,
  });
};

export async function loader() {
  const env = getEnv();
  return { appUrl: env.APP_URL ?? "https://minefolio.app" };
}

export default function ApiDocsPage() {
  const t = useT();
  return (
    <MarkdownDocPage
      icon={FileText}
      heading={t("developers.apiTitle")}
      markdown={apiMd}
      backLink={{ to: "/developers", label: t("developers.heading") }}
    />
  );
}
