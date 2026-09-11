import type { Route } from "./+types/privacy";
import { getEnv } from "@/lib/env.server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { Shield } from "lucide-react";
import privacyMd from "@/content/privacy.md?raw";
import { createTranslator } from "@/lib/messages";
import { localeFromMatches } from "@/lib/locale";
import { useT } from "@/hooks/use-locale";

export const meta: Route.MetaFunction = ({ loaderData, matches }) => {
  const t = createTranslator(localeFromMatches(matches));
  const title = t("privacy.metaTitle");
  const description = t("privacy.metaDescription");
  const appUrl = loaderData?.appUrl || "https://minefolio.app";
  const ogImage = `${appUrl}/icon.png`;
  return [
    { title },
    { name: "description", content: description },
    { property: "og:type", content: "article" },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:image", content: ogImage },
  ];
};

export async function loader() {
  const env = getEnv();
  return { appUrl: env?.APP_URL ?? "https://minefolio.app" };
}

export default function PrivacyPage() {
  const t = useT();
  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-2">
        <Shield className="h-6 w-6" />
        <h1 className="text-2xl font-bold">{t("privacy.heading")}</h1>
      </div>

      <article className="prose prose-sm dark:prose-invert max-w-none">
        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
          {privacyMd}
        </ReactMarkdown>
      </article>
    </div>
  );
}
