import { Link } from "react-router";
import type { Route } from "./+types/index";
import { getEnv } from "@/lib/env.server";
import { buildOgMeta } from "@/lib/og-meta";
import { PageSection } from "@/components/page-section";
import { Button } from "@/components/ui/button";
import { Code, FileText, History, Download, MessageSquare, ChevronRight, Languages } from "lucide-react";
import { Github } from "@/components/brand-icons";
import type { LucideIcon } from "lucide-react";
import { createTranslator, type MessageKey } from "@/lib/messages";
import { localeFromMatches } from "@/lib/locale";
import { useLocale, useT } from "@/hooks/use-locale";

export const meta: Route.MetaFunction = ({ loaderData, matches }) => {
  const t = createTranslator(localeFromMatches(matches));
  const appUrl = loaderData?.appUrl || "https://minefolio.app";
  return buildOgMeta({
    title: t("developers.title"),
    description: t("developers.metaDescription"),
    appUrl,
    ogType: "website",
  });
};

export async function loader() {
  const env = getEnv();
  return { appUrl: env.APP_URL ?? "https://minefolio.app" };
}

// 文言は描画時に t() で解決する（モジュール評価時はロケールが未確定のため）
const sections = [
  {
    to: "/developers/api",
    icon: FileText,
    titleKey: "developers.apiTitle",
    jaOnly: true,
    descriptionKey: "developers.apiDescription",
  },
  {
    to: "/developers/changelog",
    icon: History,
    titleKey: "developers.changelogTitle",
    jaOnly: true,
    descriptionKey: "developers.changelogDescription",
  },
  {
    to: "/developers/export",
    icon: Download,
    titleKey: "developers.exportTitle",
    jaOnly: false,
    descriptionKey: "developers.exportDescription",
  },
] as const satisfies readonly { to: string; icon: LucideIcon; titleKey: MessageKey; descriptionKey: MessageKey; jaOnly: boolean }[];

export default function DevelopersHubPage() {
  const t = useT();
  const locale = useLocale();
  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Code className="h-6 w-6" aria-hidden />
          {t("developers.heading")}
        </h1>
        <p className="text-muted-foreground">
          {t("developers.lead")}
        </p>
      </div>

      {/* セクション一覧 */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {sections.map((section) => {
          const Icon = section.icon;
          return (
            <Link
              key={section.to}
              to={section.to}
              className="group rounded-xl border border-border/70 bg-card p-4 transition-colors hover:border-primary/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <div className="flex items-start gap-3">
                {/* 素のアイコン（丸背景のチップは公開一覧ページのヘッダだけ。ui.md 13 章） */}
                <Icon className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="font-semibold">{t(section.titleKey)}</h2>
                    <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:translate-x-0.5 transition-transform motion-reduce:group-hover:translate-x-0" />
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">
                    {t(section.descriptionKey)}
                  </p>
                  {/* 本文が日本語だけの文書（API・更新履歴）にだけ、日本語以外のロケールで小さな印を付ける */}
                  {section.jaOnly && locale !== "ja" && (
                    <p className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <Languages className="h-3 w-3" aria-hidden />
                      {t("developers.jaOnlyBadge")}
                    </p>
                  )}
                </div>
              </div>
            </Link>
          );
        })}
      </div>

      {/* 関連リンク */}
      <PageSection id="developers-related" title={t("developers.relatedLinks")}>
        <p className="text-sm text-muted-foreground">{t("developers.relatedLinksDescription")}</p>
        <div className="flex flex-wrap gap-3">
          <Button variant="outline" asChild className="min-h-11 sm:min-h-9">
            <a
              href="https://github.com/bafv4/minefolio"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Github className="mr-2 h-4 w-4" />
              {t("developers.githubRepository")}
            </a>
          </Button>
          <Button variant="outline" asChild className="min-h-11 sm:min-h-9">
            <a
              href="https://github.com/bafv4/minefolio/issues"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Github className="mr-2 h-4 w-4" />
              Issues
            </a>
          </Button>
          <Button variant="outline" asChild className="min-h-11 sm:min-h-9">
            <Link to="/feedback">
              <MessageSquare className="mr-2 h-4 w-4" />
              {t("nav.feedback")}
            </Link>
          </Button>
        </div>
      </PageSection>
    </div>
  );
}
