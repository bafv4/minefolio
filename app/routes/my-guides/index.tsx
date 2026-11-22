import { createTranslator } from "@/lib/messages";
import { localeFromMatches, resolveLocale } from "@/lib/locale";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
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
import { StatusPill } from "@/components/status-pill";
import { MyContentTabs } from "@/components/content-tabs";
import { TabContentSkeleton } from "@/components/tab-content-skeleton";
import { useTabNavigation } from "@/hooks/use-tab-navigation";
import { PinnedBadge } from "@/components/pinned-badge";
import { BookOpen, ExternalLink, Plus, PencilLine, Trash2, Globe, Lock, Loader2, Eye, Pin, PinOff } from "lucide-react";
import { UpdatedAgo } from "@/components/updated-ago";
import { useT } from "@/hooks/use-locale";

export const meta = ({ matches }: { matches: ReadonlyArray<{ id: string; loaderData?: unknown }> }) => {
  const t = createTranslator(localeFromMatches(matches));
  return [{ title: t("meGuides.title") }];
};

export async function loader({ request }: LoaderFunctionArgs) {
  const env = getEnv();
  const db = createDb();
  const auth = createAuth(db, env);
  const session = await getSession(request, auth);

  // クライアントへ渡すのは一覧で使う列だけ（行をそのまま返すと、本文・下書き本文や
  // ユーザーの個人情報の列まで HTML と hydration に載る）。user は id（クエリ用）と公開 URL 用の slug だけ
  const user = await db.query.users.findFirst({
    where: eq(users.discordId, session.user.id),
    columns: { id: true, slug: true },
  });
  if (!user) return redirect("/onboarding");

  const userGuides = await db.query.guides.findMany({
    where: eq(guides.authorId, user.id),
    columns: {
      id: true,
      slug: true,
      title: true,
      isPublished: true,
      isPinned: true,
      tags: true,
      viewCount: true,
      updatedAt: true,
      draftUpdatedAt: true,
    },
    orderBy: [desc(guides.updatedAt)],
  });

  return { guides: userGuides, user: { slug: user.slug } };
}

export async function action({ request }: ActionFunctionArgs) {
  const t = createTranslator(resolveLocale(request));
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
    if (!guide) {
      return { error: t("meGuides.deleteFailed"), action: "delete" };
    }
    try {
      // 翻訳キャッシュ削除 + guides 行削除を単一トランザクションで原子化する
      // （app/lib/content-cleanup.server.ts）。Vercel Blob 実体の削除は内部で
      // runAfterResponse 経由でレスポンス後にスケジュールされる。
      await deleteGuide(db, guide);
    } catch (error) {
      console.error("Guide delete error:", error);
      return { error: t("meGuides.deleteFailed"), action: "delete" };
    }
    return { success: true, action: "delete" };
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

/** 行の操作ボタンの押せる大きさ（モバイル 44px 四方、sm 以上 32px。ui.md 9 章「タップ領域」） */
const ROW_ACTION_CLASS = "min-h-11 min-w-11 sm:min-h-8 sm:min-w-8";

export default function MyGuidesPage() {
  const t = useT();
  const { guides: userGuides, user } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  // 削除の結果をトーストで知らせる（テンプレートの削除と同じ形）
  const prevDataRef = useRef<typeof fetcher.data>(undefined);
  useEffect(() => {
    const data = fetcher.data;
    if (!data || data === prevDataRef.current) return;
    prevDataRef.current = data;
    if (data.action !== "delete") return;
    if ("success" in data && data.success) toast.success(t("meGuides.deleteSuccess"));
    else if ("error" in data && data.error) toast.error(data.error);
  }, [fetcher.data]);
  // タブ切替（→ /my-guides/templates）中は一覧をスケルトンに差し替える
  const { isTabSwitching } = useTabNavigation();

  return (
    <div className="space-y-6">
      <MyContentTabs active="guides" />

      {/* タブ切替中はタイトル含むコンテンツ全体をスケルトンに（タイトルはタブ内側にあるため、
          先行切替済みのタブと旧ページのタイトルが食い違って見えないようにする） */}
      {isTabSwitching ? (
        <TabContentSkeleton />
      ) : (
      <>
      {/* タイトル・説明・新規ボタンはタブの内側（コンテンツ側）に置く */}
      {/* 見出しの行の組み方はテンプレート一覧（templates.tsx）と同じ（狭い画面は縦積み・新規ボタンは全幅の 44px） */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t("meGuides.pageTitle")}</h1>
          <p className="text-muted-foreground text-sm">
            {t("meGuides.pageDesc")}{" "}
            {/* 書き方の手引き（公式ガイド）。新しいタブで開き、そのことを読み上げでも伝える。
                押せる高さは負のマージン＋同じ量の padding で広げる（モバイル 44px、sm 以上 28px。行の高さは変えない） */}
            <Link
              to={GUIDE_WRITING_GUIDE_PATH}
              target="_blank"
              rel="noopener noreferrer"
              className="-my-3 inline-flex items-center gap-1 py-3 text-primary underline underline-offset-2 hover:text-primary/80 sm:-my-1 sm:py-1"
            >
              {t("meGuides.writingGuide")}
              <ExternalLink className="h-3 w-3" aria-hidden />
              <span className="sr-only">{t("meGuides.opensInNewTab")}</span>
            </Link>
          </p>
        </div>
        {/* 0 件のときは空状態の action に同じボタンがあるので出さない */}
        {userGuides.length > 0 && (
          <Button asChild className="h-11 w-full shrink-0 sm:h-9 sm:w-auto">
            <Link to="/my-guides/new">
              <Plus className="h-4 w-4 mr-2" />
              {t("meGuides.newGuide")}
            </Link>
          </Button>
        )}
      </div>

      {userGuides.length === 0 ? (
        <EmptyState
          icon={<BookOpen className="h-12 w-12" />}
          title={t("meGuides.noGuidesTitle")}
          description={t("meGuides.noGuides")}
          action={
            <Button asChild size="sm" className="min-h-11 sm:min-h-9">
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
              // 行全体のクリックはタイトルのリンクの ::after で敷くオーバーレイが担う（ui.md 9 章の after 方式）。
              // 行の操作（ピン留め・公開ページ・削除）は relative z-10 でオーバーレイより手前に出す
              <Card
                key={guide.id}
                className="relative py-0 transition-colors hover:border-primary/40"
              >
                {/* 操作は狭い画面でも右端に置き（メタ行の下に独立した段を作らない）、タイトルの段と並べる */}
                <CardContent className="flex items-start gap-3 p-4 sm:items-center sm:gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      {/* 行き先は公開状態に依らず常に編集（公開ページは右の操作から別に開く） */}
                      <Link
                        to={`/my-guides/${guide.slug}/edit`}
                        className="font-medium truncate outline-none hover:underline after:absolute after:inset-0 after:rounded-xl after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-ring"
                      >
                        {guide.title}
                      </Link>
                      {/* 公開状態はエディタの公開状態のピル（desktop-toolbar.tsx の PublishStatusPill）と同じ丸ピル・同じ語。
                          brand は選択中・進行だけに使うので、公開中も muted にする（ui.md 1 章） */}
                      <StatusPill icon={guide.isPublished ? Globe : Lock} className="shrink-0">
                        {guide.isPublished ? t("meGuides.statusPublished") : t("meGuides.statusPrivate")}
                      </StatusPill>
                      {/* 公開中のガイドに下書き保存した未公開の変更があるときだけ。非公開のガイドに残る下書き
                          （下書き保存が非公開にも出ていた頃のもの）は読者に関係しないので出さない
                          （エディタの draftBannerUnpublished・プレビューの帯と同じ扱い） */}
                      {guide.isPublished && guide.draftUpdatedAt !== null && (
                        <StatusPill icon={PencilLine} tone="warning" className="shrink-0">
                          {t("meGuides.statusUnpublishedChanges")}
                        </StatusPill>
                      )}
                      {guide.isPinned && <PinnedBadge className="shrink-0" />}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                      <UpdatedAgo date={guide.updatedAt} />
                      {guide.isPublished && (
                        <span className="flex items-center gap-1">
                          <Eye className="h-3 w-3" aria-hidden />
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
                  {/* 操作はモバイルで 44px 四方・間隔 12px（sm 以上は 32px・間隔 8px）。編集はタイトル（行全体）が担うので置かない */}
                  <div className="relative z-10 flex shrink-0 items-center gap-3 sm:gap-2">
                    <fetcher.Form method="post">
                      <input type="hidden" name="_action" value="togglePin" />
                      <input type="hidden" name="guideId" value={guide.id} />
                      <Button
                        variant="ghost"
                        size="sm"
                        type="submit"
                        className={ROW_ACTION_CLASS}
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
                    {/* 公開ページ（公開中のときだけ）。新しいタブで開くことを名前でも伝える */}
                    {guide.isPublished && (
                      <Button variant="ghost" size="sm" asChild className={ROW_ACTION_CLASS}>
                        <Link
                          to={`/guides/${user.slug}/${guide.slug}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`${t("meGuides.viewPublished")}${t("meGuides.opensInNewTab")}`}
                          title={t("meGuides.viewPublished")}
                        >
                          <Globe className="h-4 w-4" aria-hidden />
                        </Link>
                      </Button>
                    )}
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className={ROW_ACTION_CLASS}
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
