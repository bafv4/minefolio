import { Link } from "react-router";
import type { Route } from "./+types/index";
import { getEnv } from "@/lib/env.server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Code, FileText, History, Download, Github, MessageSquare, ChevronRight } from "lucide-react";

export const meta: Route.MetaFunction = ({ loaderData }) => {
  const title = "Developers - Minefolio";
  const description = "Minefolio の開発者向け情報・APIドキュメント・更新履歴・データエクスポート";
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

const sections = [
  {
    to: "/developers/api",
    icon: FileText,
    title: "API ドキュメント",
    description: "Minefolio が提供する公開 API の仕様",
  },
  {
    to: "/developers/changelog",
    icon: History,
    title: "更新履歴",
    description: "Minefolio のリリースノート",
  },
  {
    to: "/developers/export",
    icon: Download,
    title: "データエクスポート",
    description: "自分のキー配置・リマップ・カスタムアクション・マウス設定をCSVで出力",
  },
];

export default function DevelopersHubPage() {
  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <Code className="h-7 w-7" />
          Developers
        </h1>
        <p className="text-muted-foreground">
          Minefolio の開発者向け情報を掲載しています。
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
                    <h3 className="font-semibold">{section.title}</h3>
                    <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:translate-x-0.5 transition-transform" />
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">
                    {section.description}
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
          <CardTitle className="text-base">関連リンク</CardTitle>
          <CardDescription>外部サービス・お問い合わせ</CardDescription>
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
              フィードバック
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
