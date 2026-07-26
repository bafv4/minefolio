import { createTranslator } from "@/lib/messages";
import { localeFromMatches } from "@/lib/locale";
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
import { TabContentSkeleton } from "@/components/tab-content-skeleton";
import { useTabNavigation } from "@/hooks/use-tab-navigation";
import { PinnedBadge } from "@/components/pinned-badge";
import { Plus, Pencil, Trash2, Globe, Lock, Loader2, Eye, Pin, PinOff } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { dateFnsLocale } from "@/lib/date-locale";
import { useT, useLocale } from "@/hooks/use-locale";

export const meta = ({ matches }: { matches: ReadonlyArray<{ id: string; loaderData?: unknown }> }) => {
  const t = createTranslator(localeFromMatches(matches));
  return [{ title: t("meGuides.title") }];
};

export async function loader({ request }: LoaderFunctionArgs) {
  const env = getEnv();
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

export async function action({ request }: ActionFunctionArgs) {
  const env = getEnv();
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

  // プロフィールのガイドタブでのピン留め切替
  if (_action === "togglePin") {
    const guideId = formData.get("guideId") as string;
    const guide = await db.query.guides.findFirst({
      where: and(eq(guides.id, guideId), eq(guides.authorId, user.id)),
    });
    if (guide) {
      await db
        .update(guides)
        .set({ isPinned: !guide.isPinned })
        .where(eq(guides.id, guideId));
    }
  }

  return null;
}

export default function MyGuidesPage() {
  const t = useT();
  const locale = useLocale();
  const { guides: userGuides, user } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  // タブ切替（→ /my-guides/templates）中は一覧をスケルトンに差し替える
  const { isTabSwitching } = useTabNavigation();

  return (
    <div className="space-y-6">
      <MyContentTabs active="guides" />

      {/* タブ切替中はタイトル含むコンテンツ全体をスケルトンに（タイトルはタブ内側にあるため、
          先行切替済みのタブと旧ページのタイトルが食い違って見えないようにする） */}
      {isTabSwitching ? (
        <TabContentSkeleton variant="list" />
      ) : (
      <>
      {/* タイトル・説明・新規ボタンはタブの内側（コンテンツ側）に置く */}
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
                      {guide.isPinned && <PinnedBadge className="shrink-0" />}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                      <span>
                        {formatDistanceToNow(guide.updatedAt, {
                          addSuffix: true,
                          locale: dateFnsLocale(locale),
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
                    <fetcher.Form method="post">
                      <input type="hidden" name="_action" value="togglePin" />
                      <input type="hidden" name="guideId" value={guide.id} />
                      <Button
                        variant="ghost"
                        size="sm"
                        type="submit"
                        title={guide.isPinned ? t("meGuides.unpin") : t("meGuides.pin")}
                      >
                        {guide.isPinned ? (
                          <PinOff className="h-4 w-4" />
                        ) : (
                          <Pin className="h-4 w-4" />
                        )}
                      </Button>
                    </fetcher.Form>
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
      </>
      )}
    </div>
  );
}
