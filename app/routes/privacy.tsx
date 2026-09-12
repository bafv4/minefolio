import type { Route } from "./+types/privacy";
import { getEnv } from "@/lib/env.server";
import { buildOgMeta } from "@/lib/og-meta";
import { Shield } from "lucide-react";
import { MarkdownDocPage } from "@/components/markdown-doc-page";
import privacyMd from "@/content/privacy.md?raw";
import { createTranslator } from "@/lib/messages";
import { localeFromMatches } from "@/lib/locale";
import { useT } from "@/hooks/use-locale";

export const meta: Route.MetaFunction = ({ loaderData, matches }) => {
  const t = createTranslator(localeFromMatches(matches));
  const appUrl = loaderData?.appUrl || "https://minefolio.app";
  return buildOgMeta({
    title: t("privacy.metaTitle"),
    description: t("privacy.metaDescription"),
    appUrl,
  });
};

export async function loader() {
  const env = getEnv();
  return { appUrl: env.APP_URL ?? "https://minefolio.app" };
}

export default function PrivacyPage() {
  const t = useT();
  return <MarkdownDocPage icon={Shield} heading={t("privacy.heading")} markdown={privacyMd} />;
}
