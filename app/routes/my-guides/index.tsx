import {
  useLoaderData,
  useFetcher,
  redirect,
  Link,
  type LoaderFunctionArgs,
  type ActionFunctionArgs,
} from "react-router";
import { createDb } from "@/lib/db";
import { createAuth } from "@/lib/auth";
import { getSession } from "@/lib/session";
import { getEnv } from "@/lib/env.server";
import { users, guides } from "@/lib/schema";
import { eq, and, desc } from "drizzle-orm";
import { del } from "@vercel/blob";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { MyContentTabs } from "@/components/content-tabs";
import { Plus, Pencil, Trash2, Globe, Lock, Loader2, Eye } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ja } from "date-fns/locale";
import { t } from "@/lib/messages";

export const meta = () => [{ title: t("meGuides.title") }];

export async function loader({ context, request }: LoaderFunctionArgs) {
  const env = context.env ?? getEnv();
  const db = createDb();
  const auth = createAuth(db, env);
  const session = await getSession(request, auth);

  const user = await db.query.users.findFirst({
    where: eq(users.discordId, session.user.id),
  });
  if (!user) return redirect("/onboarding");

  const userGuides = await db.query.guides.findMany({
    where: eq(guides.authorId, user.id),
    orderBy: [desc(guides.updatedAt)],
  });

  return { guides: userGuides, user };
}

export async function action({ context, request }: ActionFunctionArgs) {
  const env = context.env ?? getEnv();
  const db = createDb();
  const auth = createAuth(db, env);
  const session = await getSession(request, auth);

  const user = await db.query.users.findFirst({
    where: eq(users.discordId, session.user.id),
  });
  if (!user) return redirect("/onboarding");

  const formData = await request.formData();
  const _action = formData.get("_action") as string;

  if (_action === "delete") {
    const guideId = formData.get("guideId") as string;
    const guide = await db.query.guides.findFirst({
      where: and(eq(guides.id, guideId), eq(guides.authorId, user.id)),
    });
    if (guide) {
      if (guide.coverImageUrl) {
        try {
          await del(guide.coverImageUrl);
        } catch {}
      }
      await db.delete(guides).where(eq(guides.id, guideId));
    }
  }

  return null;
}

export default function MyGuidesPage() {
  const { guides: userGuides, user } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t("meGuides.pageTitle")}</h1>
          <p className="text-muted-foreground text-sm">{t("meGuides.pageDesc")}</p>
        </div>
        <Button asChild>
          <Link to="/my-guides/new">
            <Plus className="h-4 w-4 mr-2" />
            {t("meGuides.newGuide")}
          </Link>
        </Button>
      </div>

      <MyContentTabs active="guides" />

      {userGuides.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <p className="text-muted-foreground mb-4">{t("meGuides.noGuides")}</p>
            <Button asChild>
              <Link to="/my-guides/new">
                <Plus className="h-4 w-4 mr-2" />
                {t("meGuides.newGuide")}
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {userGuides.map((guide) => {
            const tags = JSON.parse(guide.tags) as string[];
            return (
              <Card key={guide.id}>
                <CardContent className="flex items-center gap-4 p-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <h3 className="font-medium truncate">{guide.title}</h3>
                      {guide.isPublished ? (
                        <Badge variant="default" className="shrink-0 text-xs">
                          <Globe className="h-3 w-3 mr-1" />
                          {t("meGuides.statusPublished")}
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="shrink-0 text-xs">
                          <Lock className="h-3 w-3 mr-1" />
                          {t("meGuides.statusDraft")}
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                      <span>
                        {formatDistanceToNow(guide.updatedAt, {
                          addSuffix: true,
                          locale: ja,
                        })}{" "}
                        更新
                      </span>
                      {guide.isPublished && (
                        <span className="flex items-center gap-1">
                          <Eye className="h-3 w-3" />
                          {guide.viewCount}
                        </span>
                      )}
                      {tags.length > 0 && (
                        <div className="flex gap-1 flex-wrap">
                          {tags.map((tag) => (
                            <span
                              key={tag}
                              className="bg-muted px-1.5 py-0.5 rounded text-xs"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {guide.isPublished && (
                      <Button variant="ghost" size="sm" asChild>
                        <Link
                          to={`/guides/${user.slug}/${guide.slug}`}
                          target="_blank"
                        >
                          <Globe className="h-4 w-4" />
                        </Link>
                      </Button>
                    )}
                    <Button variant="outline" size="sm" asChild>
                      <Link to={`/my-guides/${guide.slug}/edit`}>
                        <Pencil className="h-4 w-4" />
                      </Link>
                    </Button>
                    <fetcher.Form method="post">
                      <input type="hidden" name="_action" value="delete" />
                      <input type="hidden" name="guideId" value={guide.id} />
                      <Button
                        variant="ghost"
                        size="sm"
                        type="submit"
                        onClick={(e) => {
                          if (!confirm(t("meGuides.confirmDelete")))
                            e.preventDefault();
                        }}
                      >
                        {fetcher.state !== "idle" &&
                        fetcher.formData?.get("guideId") === guide.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </Button>
                    </fetcher.Form>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
