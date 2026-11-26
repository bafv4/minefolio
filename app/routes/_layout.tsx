import { useT } from "@/hooks/use-locale";
import { Link, Outlet, useLoaderData, useLocation, useRouteLoaderData } from "react-router";
import { NuqsAdapter } from "nuqs/adapters/react-router/v7";
import type { Route } from "./+types/_layout";
import { Header, Footer, NavigationProgress } from "@/components/layout";
import { ErrorView } from "@/components/layout/error-view";
import { NoticeBanner } from "@/components/notice-banner";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Info } from "lucide-react";
import { createDb } from "@/lib/db";
import { createAuth } from "@/lib/auth";
import { getOptionalSession, loadUserByDiscordId } from "@/lib/session";
import { getEnv } from "@/lib/env.server";
import { users } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { BackToTopButton } from "@/components/back-to-top-button";
import { FavoritesProvider } from "@/hooks/use-favorites";
import { getFavoritesFromDb } from "@/lib/favorites";
import { LikesProvider } from "@/hooks/use-likes";
import { getViewerLikedIds } from "@/lib/likes.server";
import { estimateOnboardingResumeStep, ONBOARDING_TOTAL_STEPS } from "@/lib/onboarding-progress";

// 検索パラメータ遷移でも再実行する。いいね状態（use-likes の likedKeys）がこのローダー結果
// （likedGuideIds / likedTemplateIds）に依存し、いいね自体は素の fetch でルーター再検証が起きないため、
// shouldRevalidate で止めると並び替え/タブ切替後にいいねが未いいね表示へ戻る。
export async function loader({ request }: Route.LoaderArgs) {
  const env = getEnv();
  const db = createDb();
  const auth = createAuth(db, env);

  const session = await getOptionalSession(request, auth);

  if (!session) {
    return {
      user: null,
      onboardingPending: false,
      onboardingResumeStep: null,
      initialFavorites: [] as string[],
      likedGuideIds: [] as string[],
      likedTemplateIds: [] as string[],
    };
  }

  // Get user from our users table
  const user = await loadUserByDiscordId(request, db, session.user.id);

  // ログイン済みだが初期設定（/onboarding）が未完了。users 行がまだ無い場合も含む
  if (!user) {
    return {
      user: null,
      onboardingPending: true,
      // 行がまだ無い＝「はじめる」を押していない
      onboardingResumeStep: null,
      initialFavorites: [] as string[],
      likedGuideIds: [] as string[],
      likedTemplateIds: [] as string[],
    };
  }

  // アバター更新（必要なら）と initialFavorites / いいね済みid の取得を並列実行
  // （DB ラウンドトリップ削減）
  const needsAvatarUpdate = session.user.image !== user.discordAvatar;
  const [, initialFavorites, likedIds, onboardingResumeStep] = await Promise.all([
    needsAvatarUpdate
      ? db
          .update(users)
          .set({ discordAvatar: session.user.image ?? null })
          .where(eq(users.discordId, session.user.id))
      : Promise.resolve(),
    getFavoritesFromDb(db, user.id),
    getViewerLikedIds(db, user.id),
    // 初期設定が未完了の人だけ、再開案内に添える「どこから再開するか」を保存済みの内容から推定する
    user.onboardingCompleted ? Promise.resolve(null) : loadOnboardingResumeStep(db, user.id, session.user.name),
  ]);
  if (needsAvatarUpdate) {
    user.discordAvatar = session.user.image ?? null;
  }

  return {
    onboardingPending: !user.onboardingCompleted,
    onboardingResumeStep,
    user: {
      mcid: user.mcid,
      uuid: user.uuid,
      customSkinUrl: user.customSkinUrl,
      slug: user.slug,
      displayName: user.displayName,
      displayNameAlphabet: user.displayNameAlphabet,
      discordAvatar: user.discordAvatar,
    },
    initialFavorites,
    likedGuideIds: likedIds.guideIds,
    likedTemplateIds: likedIds.templateIds,
  };
}

/** 初期設定の再開位置（/onboarding と同じ推定）。行が消えていたら null */
async function loadOnboardingResumeStep(
  db: ReturnType<typeof createDb>,
  userId: string,
  discordName: string | null | undefined,
): Promise<number | null> {
  const row = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: {
      displayName: true,
      shortBio: true,
      bio: true,
      location: true,
      pronouns: true,
      mcid: true,
      bedrockMcid: true,
      customSkinUrl: true,
      customCapeUrl: true,
    },
    with: { socialLinks: { columns: { platform: true } } },
  });
  if (!row) return null;
  return estimateOnboardingResumeStep(
    { ...row, linkPlatforms: row.socialLinks.map((link) => link.platform) },
    discordName,
  );
}

type LayoutData = Awaited<ReturnType<typeof loader>>;

// 初期設定の再開案内を出さないパス（手順の途中・ログイン画面そのもの）
const RESUME_NOTICE_HIDDEN_PATHS = ["/onboarding", "/login", "/dev/login"];

function LayoutShell({ data, children }: { data: LayoutData; children: React.ReactNode }) {
  const t = useT();
  const { pathname } = useLocation();
  const { user, onboardingPending, onboardingResumeStep, initialFavorites, likedGuideIds, likedTemplateIds } = data;
  const showResumeNotice =
    onboardingPending && !RESUME_NOTICE_HIDDEN_PATHS.includes(pathname.replace(/\/+$/, "") || "/");

  return (
    <NuqsAdapter>
      <FavoritesProvider isLoggedIn={!!user} initialFavorites={initialFavorites}>
      <LikesProvider
        isLoggedIn={!!user}
        likedGuideIds={likedGuideIds}
        likedTemplateIds={likedTemplateIds}
      >
        <div className="flex min-h-screen flex-col">
        {/* スキップリンク（Tab フォーカス時のみ表示） */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground focus:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t("common.skipToContent")}
        </a>
        <NavigationProgress />
        <Header user={user} onboardingPending={onboardingPending} />
        {showResumeNotice && (
          <div className="container mx-auto px-4 pt-4 sm:px-6 lg:px-8">
            <NoticeBanner tone="info" icon={Info} className="items-center">
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                <span>
                  {t("onboarding.resumeNotice")}{" "}
                  {onboardingResumeStep
                    ? t("onboarding.resumeNoticeRemaining", {
                        step: onboardingResumeStep,
                        total: ONBOARDING_TOTAL_STEPS,
                      })
                    : t("onboarding.resumeNoticeNotStarted")}
                </span>
                <Link
                  to="/onboarding"
                  className={cn(buttonVariants({ size: "sm" }), "min-h-11 sm:min-h-8")}
                >
                  {t("onboarding.resumeAction")}
                </Link>
              </div>
            </NoticeBanner>
          </div>
        )}
        <main
          id="main-content"
          tabIndex={-1}
          className="flex-1 flex flex-col container mx-auto px-4 sm:px-6 lg:px-8 py-8 focus-visible:outline-none"
        >
          {children}
        </main>
        <Footer />
        <BackToTopButton />
        </div>
      </LikesProvider>
      </FavoritesProvider>
    </NuqsAdapter>
  );
}

export default function Layout() {
  const data = useLoaderData<typeof loader>();
  return (
    <LayoutShell data={data}>
      <Outlet />
    </LayoutShell>
  );
}

// 子ルートの loader の 404 や描画中の例外を、ヘッダー・フッターの内側で表示する。
// この layout 自身の loader が落ちたとき（data が無い）は、素の画面で ErrorView だけを出す。
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const data = useRouteLoaderData<typeof loader>("routes/_layout");
  if (!data) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background p-4 text-foreground">
        <ErrorView error={error} plainLinks />
      </div>
    );
  }
  return (
    <LayoutShell data={data}>
      <ErrorView error={error} />
    </LayoutShell>
  );
}
