import type { Route } from "./+types/terms";
import { getEnv } from "@/lib/env.server";
import { buildOgMeta } from "@/lib/og-meta";
import { ScrollText } from "lucide-react";
import { MarkdownDocPage } from "@/components/markdown-doc-page";
import termsMd from "@/content/terms.md?raw";
import { createTranslator } from "@/lib/messages";
import { localeFromMatches } from "@/lib/locale";
import { useT } from "@/hooks/use-locale";

export const meta: Route.MetaFunction = ({ loaderData, matches }) => {
  const t = createTranslator(localeFromMatches(matches));
  const appUrl = loaderData?.appUrl || "https://minefolio.app";
  return buildOgMeta({
    title: t("terms.metaTitle"),
    description: t("terms.metaDescription"),
    appUrl,
  });
};

export async function loader() {
  const env = getEnv();
  return { appUrl: env.APP_URL ?? "https://minefolio.app" };
}

export default function TermsPage() {
  const t = useT();
  return <MarkdownDocPage icon={ScrollText} heading={t("terms.heading")} markdown={termsMd} />;
}
