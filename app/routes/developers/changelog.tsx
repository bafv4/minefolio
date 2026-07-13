import { Link } from "react-router";
import type { Route } from "./+types/changelog";
import { getEnv } from "@/lib/env.server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { Button } from "@/components/ui/button";
import { ArrowLeft, History } from "lucide-react";
import changelogMd from "@/content/changelog.md?raw";

export const meta: Route.MetaFunction = ({ loaderData }) => {
  const title = "更新履歴 - Developers - Minefolio";
  const description = "Minefolio のリリースノート";
  const appUrl = loaderData?.appUrl || "https://minefolio.pages.dev";
  const ogImage = `${appUrl}/og-image`;
  return [
    { title },
    { name: "description", content: description },
    { property: "og:type", content: "article" },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:image", content: ogImage },
  ];
};

export async function loader({ context }: Route.LoaderArgs) {
  const env = getEnv();
  return { appUrl: env?.APP_URL ?? "https://minefolio.pages.dev" };
}

export default function ChangelogPage() {
  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div>
        <Button variant="ghost" size="sm" asChild className="-ml-2">
          <Link to="/developers">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Developers
          </Link>
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <History className="h-7 w-7" />
        <h1 className="text-3xl font-bold">更新履歴</h1>
      </div>

      <article className="prose prose-sm dark:prose-invert max-w-none">
        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
          {changelogMd}
        </ReactMarkdown>
      </article>
    </div>
  );
}
