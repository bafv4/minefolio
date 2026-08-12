import { Link } from "react-router";
import type { Route } from "./+types/index";
import { getEnv } from "@/lib/env.server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Code, FileText, History, Download, Github, MessageSquare, ChevronRight } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { createTranslator, type MessageKey } from "@/lib/messages";
import { localeFromMatches } from "@/lib/locale";
import { useT } from "@/hooks/use-locale";

export const meta: Route.MetaFunction = ({ loaderData, matches }) => {
  const t = createTranslator(localeFromMatches(matches));
  const title = t("developers.title");
  const description = t("developers.metaDescription");
  const appUrl = loaderData?.appUrl || "https://minefolio.app";
  const ogImage = `${appUrl}/icon.png`;
  return [
    { title },
    { name: "description", content: description },
    { property: "og:type", content: "website" },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:image", content: ogImage },
  ];
};

export async function loader() {
  const env = getEnv();
  return { appUrl: env?.APP_URL ?? "https://minefolio.app" };
}

// 文言は描画時に t() で解決する（モジュール評価時はロケールが未確定のため）
const sections = [
  {
    to: "/developers/api",
    icon: FileText,
    titleKey: "developers.apiTitle",
    descriptionKey: "developers.apiDescription",
  },
  {
    to: "/developers/changelog",
    icon: History,
    titleKey: "developers.changelogTitle",
    descriptionKey: "developers.changelogDescription",
  },
  {
    to: "/developers/export",
    icon: Download,
    titleKey: "developers.exportTitle",
    descriptionKey: "developers.exportDescription",
  },
] as const satisfies readonly { to: string; icon: LucideIcon; titleKey: MessageKey; descriptionKey: MessageKey }[];

export default function DevelopersHubPage() {
  const t = useT();
  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Code className="h-6 w-6" />
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
              className="group rounded-lg border bg-card p-4 hover:bg-accent transition-colors"
            >
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <Icon className="h-5 w-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-semibold">{t(section.titleKey)}</h3>
                    <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:translate-x-0.5 transition-transform" />
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">
                    {t(section.descriptionKey)}
                  </p>
                </div>
              </div>
            </Link>
          );
        })}
      </div>

      {/* 関連リンク */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("developers.relatedLinks")}</CardTitle>
          <CardDescription>{t("developers.relatedLinksDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button variant="outline" asChild>
            <a
              href="https://github.com/bafv4/minefolio"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Github className="mr-2 h-4 w-4" />
              GitHub Repository
            </a>
          </Button>
          <Button variant="outline" asChild>
            <a
              href="https://github.com/bafv4/minefolio/issues"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Github className="mr-2 h-4 w-4" />
              Issues
            </a>
          </Button>
          <Button variant="outline" asChild>
            <Link to="/feedback">
              <MessageSquare className="mr-2 h-4 w-4" />
              {t("nav.feedback")}
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
