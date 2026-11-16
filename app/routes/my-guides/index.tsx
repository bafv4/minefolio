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
import { parseGuideTags } from "@/lib/guide-tags";
import { eq, and, desc } from "drizzle-orm";
import { cn } from "@/lib/utils";
import { GUIDE_WRITING_GUIDE_PATH } from "@/lib/official-guides";
import { deleteGuide } from "@/lib/content-cleanup.server";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { EmptyState } from "@/components/empty-state";
import { MyContentTabs } from "@/components/content-tabs";
import { TabContentSkeleton } from "@/components/tab-content-skeleton";
import { useTabNavigation } from "@/hooks/use-tab-navigation";
import { PinnedBadge } from "@/components/pinned-badge";
import { BookOpen, ExternalLink, Plus, Pencil, PencilLine, Trash2, Globe, Lock, Loader2, Eye, Pin, PinOff } from "lucide-react";
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
      // 翻訳キャッシュ削除 + guides 行削除を単一トランザクションで原子化する
      // （app/lib/content-cleanup.server.ts）。Vercel Blob 実体の削除は内部で
      // runAfterResponse 経由でレスポンス後にスケジュールされる。
      await deleteGuide(db, guide);
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

/** 状態の丸ピル（ui.md 6 章）。色は呼び出し側で上書きする */
const STATUS_PILL_CLASS =
  "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-border/70 bg-background/75 px-2.5 py-1 text-xs text-muted-foreground";

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
          <p className="text-muted-foreground text-sm">
            {t("meGuides.pageDesc")}
            {/* 書き方の手引き（公式ガイド）。新しいタブで開き、そのことを読み上げでも伝える。
                押せる高さは負のマージン＋同じ量の padding で広げる（モバイル 44px、sm 以上 28px。行の高さは変えない） */}
            <Link
              to={GUIDE_WRITING_GUIDE_PATH}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-2 -my-3 inline-flex items-center gap-1 py-3 text-primary hover:underline sm:-my-1 sm:py-1"
            >
              {t("meGuides.writingGuide")}
              <ExternalLink className="h-3 w-3" aria-hidden />
              <span className="sr-only">{t("meGuides.opensInNewTab")}</span>
            </Link>
          </p>
        </div>
        <Button asChild>
          <Link to="/my-guides/new">
            <Plus className="h-4 w-4 mr-2" />
            {t("meGuides.newGuide")}
          </Link>
        </Button>
      </div>

      {userGuides.length === 0 ? (
        <EmptyState
          icon={<BookOpen className="h-12 w-12" />}
          title={t("meGuides.noGuidesTitle")}
          description={t("meGuides.noGuides")}
          action={
            <Button asChild size="sm" className="mt-4">
              <Link to="/my-guides/new">
                <Plus className="h-4 w-4 mr-2" />
                {t("meGuides.newGuide")}
              </Link>
            </Button>
          }
        />
      ) : (
        <div className="space-y-3">
          {userGuides.map((guide) => {
            const tags = parseGuideTags(guide.tags);
            return (
              <Card key={guide.id} className="py-0">
                <CardContent className="flex items-center gap-4 p-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      {guide.isPublished ? (
                        <Link
                          to={`/guides/${user.slug}/${guide.slug}`}
                          className="font-medium truncate hover:underline"
                        >
                          {guide.title}
                        </Link>
                      ) : (
                        <Link
                          to={`/my-guides/${guide.slug}/edit`}
                          className="font-medium truncate hover:underline"
                        >
                          {guide.title}
                        </Link>
                      )}
                      {/* 公開状態はエディタの公開状態のピル（desktop-toolbar.tsx の PublishStatusPill）と同じ丸ピル・同じ語。
                          brand は選択中・進行だけに使うので、公開中も muted にする（ui.md 1 章） */}
                      <span className={STATUS_PILL_CLASS}>
                        {guide.isPublished ? (
                          <Globe className="h-3 w-3" aria-hidden />
                        ) : (
                          <Lock className="h-3 w-3" aria-hidden />
                        )}
                        {guide.isPublished ? t("meGuides.statusPublished") : t("meGuides.statusPrivate")}
                      </span>
                      {/* 公開中のガイドに下書き保存した未公開の変更があるときだけ。非公開のガイドに残る下書き
                          （下書き保存が非公開にも出ていた頃のもの）は読者に関係しないので出さない
                          （エディタの draftBannerUnpublished・プレビューの帯と同じ扱い） */}
                      {guide.isPublished && guide.draftUpdatedAt !== null && (
                        <span className={cn(STATUS_PILL_CLASS, "border-warning/40 text-warning")}>
                          <PencilLine className="h-3 w-3" aria-hidden />
                          {t("meGuides.statusUnpublishedChanges")}
                        </span>
                      )}
                      {guide.isPinned && <PinnedBadge className="shrink-0" />}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                      {/* 相対時刻はSSR時とhydration時で基準時刻がずれるため警告を抑制 */}
                      <span suppressHydrationWarning>
                        {t("common.updatedAgo", {
                          time: formatDistanceToNow(guide.updatedAt, {
                            addSuffix: true,
                            locale: dateFnsLocale(locale),
                          }),
                        })}
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
                            <Badge
                              key={tag}
                              variant="secondary"
                              className="rounded-full px-2 py-0.5 text-[11px]"
                            >
                              {tag}
                            </Badge>
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
                        aria-label={guide.isPinned ? t("meGuides.unpin") : t("meGuides.pin")}
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
                          aria-label={t("meGuides.viewPublished")}
                          title={t("meGuides.viewPublished")}
                        >
                          <Globe className="h-4 w-4" />
                        </Link>
                      </Button>
                    )}
                    <Button variant="ghost" size="sm" asChild>
                      <Link
                        to={`/my-guides/${guide.slug}/edit`}
                        aria-label={t("guideEditor.edit")}
                        title={t("guideEditor.edit")}
                      >
                        <Pencil className="h-4 w-4" />
                      </Link>
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={t("meGuides.delete")}
                          title={t("meGuides.delete")}
                        >
                          {/* 回すのはこのガイドの削除中だけ（ピン留めも同じ fetcher・同じ guideId で送るため） */}
                          {fetcher.state !== "idle" &&
                          fetcher.formData?.get("_action") === "delete" &&
                          fetcher.formData?.get("guideId") === guide.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="h-4 w-4 text-destructive" />
                          )}
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>{t("meGuides.deleteTitle")}</AlertDialogTitle>
                          <AlertDialogDescription>
                            {t("meGuides.deleteDescription", { title: guide.title })}
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>{t("meGuides.cancel")}</AlertDialogCancel>
                          <AlertDialogAction
                            className={buttonVariants({ variant: "destructive" })}
                            onClick={() => {
                              const formData = new FormData();
                              formData.set("_action", "delete");
                              formData.set("guideId", guide.id);
                              fetcher.submit(formData, { method: "post" });
                            }}
                          >
                            {t("meGuides.delete")}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
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
