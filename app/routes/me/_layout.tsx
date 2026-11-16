import { Fragment, useEffect, useState } from "react";
import { Outlet, NavLink, redirect, useLoaderData, useLocation, useNavigation, type ShouldRevalidateFunctionArgs } from "react-router";
import type { Route } from "./+types/_layout";
import { createDb } from "@/lib/db";
import { createAuth } from "@/lib/auth";
import { getSession, isRegistered } from "@/lib/session";
import { getEnv } from "@/lib/env.server";
import { users } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { cn } from "@/lib/utils";
import {
  Pencil,
  Gamepad2,
  Trophy,
  Keyboard,
  Mouse,
  Package,
  Search,
  Loader2,
  Save,
  Upload,
  X,
  ChevronsDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ShareButton } from "@/components/share-button";
import { useT, useLocale } from "@/hooks/use-locale";
import { pickDisplayName } from "@/lib/slug";
import { loadMeChecklist } from "@/lib/me-checklist.server";
import { MeTour } from "@/components/me/me-tour";

// 同じ pathname で検索パラメータだけが変わる GET 遷移では、このレイアウトのデータ（ユーザー行・appUrl）は
// 変わらないので再取得しない。action 後・パス変更・revalidator.revalidate()（URL 不変）は従来どおり。
export function shouldRevalidate({
  currentUrl,
  nextUrl,
  formMethod,
  actionResult,
  defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs) {
  if (formMethod && formMethod.toUpperCase() !== "GET") return defaultShouldRevalidate;
  if (actionResult !== undefined) return defaultShouldRevalidate;
  if (currentUrl.pathname === nextUrl.pathname && currentUrl.search !== nextUrl.search) return false;
  return defaultShouldRevalidate;
}

export async function loader({ request }: Route.LoaderArgs) {
  const env = getEnv();
  const db = createDb();
  const auth = createAuth(db, env);

  const session = await getSession(request, auth);

  const user = await db.query.users.findFirst({
    where: eq(users.discordId, session.user.id),
  });

  // 未登録（行が無い、またはウィザード未完了）なら /onboarding へ（判定は isRegistered に集約）
  if (!isRegistered(user)) {
    return redirect("/onboarding");
  }

  const appUrl = env.APP_URL || "https://minefolio.app";

  // 「はじめに」チェックリスト（/me/edit が useRouteLoaderData で読む。閉じ済み・全完了なら null）
  const checklist = await loadMeChecklist(db, user);

  return { user, appUrl, checklist };
}

// 主要なナビゲーション項目（プロフィールのホットバーと同じ 2 群: 人物系 | セットアップ系。群の間に区切りを入れる）
const mainNavItems = [
  { to: "/me/edit", labelKey: "meLayout.editProfile" as const, icon: Pencil, startsGroup: false },
  { to: "/me/records", labelKey: "meLayout.records" as const, icon: Trophy, startsGroup: false },
  { to: "/me/playstyle", labelKey: "meLayout.playstyle" as const, icon: Gamepad2, startsGroup: true },
  { to: "/me/keybindings", labelKey: "meLayout.keybindings" as const, icon: Keyboard, startsGroup: false },
  { to: "/me/devices", labelKey: "meLayout.devices" as const, icon: Mouse, startsGroup: false },
  { to: "/me/items", labelKey: "meLayout.itemLayouts" as const, icon: Package, startsGroup: false },
  { to: "/me/search-craft", labelKey: "meLayout.searchCraft" as const, icon: Search, startsGroup: false },
];

// ナビのリンクの見た目。現在地は brand（ヘッダーの現在ページと同じ text-brand bg-brand/10。NavLink が aria-current="page" を付ける）。
// md 未満は押せる高さを 44px にする
function navLinkClass({ isActive, isPending }: { isActive: boolean; isPending: boolean }) {
  return cn(
    "flex items-center gap-3 px-3 py-2 min-h-11 md:min-h-0 rounded-lg text-sm transition-colors",
    isActive
      ? "text-brand bg-brand/10 font-medium"
      : isPending
      ? "bg-secondary/50 text-muted-foreground"
      : "text-muted-foreground hover:bg-secondary hover:text-foreground"
  );
}

// 補助的なナビゲーション項目（区切り線の下）
const secondaryNavItems = [
  { to: "/me/presets", labelKey: "meLayout.presets" as const, icon: Save },
  { to: "/me/import", labelKey: "meLayout.import" as const, icon: Upload },
];

export default function MeLayout() {
  const t = useT();
  const locale = useLocale();
  const { user, appUrl } = useLoaderData<typeof loader>();
  // 英語表示ではアルファベット表記を優先する
  const userName = pickDisplayName(user, locale) ?? user.mcid;
  const navigation = useNavigation();

  // ナビゲーション中（ローディング中）かどうか
  const isNavigating = navigation.state === "loading";

  // lg 未満のナビ開閉状態と現在ページ名（ページ遷移したら閉じる）
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);
  const currentItem = [...mainNavItems, ...secondaryNavItems].find((item) => item.to === location.pathname);
  const currentLabel = currentItem ? t(currentItem.labelKey) : t("meLayout.home");

  return (
    <div className="flex flex-col lg:flex-row gap-8">
      {/* Sidebar Navigation */}
      <aside className="lg:w-64 shrink-0">
        <nav className="sticky top-24 space-y-1">
          <div data-me-tour="identity" className="mb-3 pb-3 lg:mb-4 lg:pb-4 border-b flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-medium truncate">
                {userName}
              </p>
              <p className="text-sm text-muted-foreground truncate">
                @{user.mcid}
              </p>
            </div>
            <ShareButton
              title={`${userName} - Minefolio`}
              url={`${appUrl}/player/${user.slug}`}
              className="min-h-11 md:min-h-0"
            />
          </div>

          {/* lg 未満（縦積み）: 現在のページ名を表示する開閉トグル。h1 を1画面目に収めるため既定は閉じる */}
          <Button
            type="button"
            variant="outline"
            data-me-tour="sidebar-toggle"
            className="w-full justify-between min-h-11 md:min-h-0 lg:hidden"
            aria-expanded={mobileMenuOpen}
            aria-controls="me-mobile-menu"
            aria-label={t("meLayout.mobileMenuLabel", { page: currentLabel })}
            onClick={() => setMobileMenuOpen((open) => !open)}
          >
            <span className="min-w-0 truncate text-sm font-medium text-brand">{currentLabel}</span>
            {mobileMenuOpen ? <X className="h-4 w-4" /> : <ChevronsDown className="h-4 w-4" />}
          </Button>

          <div id="me-mobile-menu" data-me-tour="sidebar" className={cn("space-y-1", !mobileMenuOpen && "hidden", "lg:block")}>
          {/* 主要なナビゲーション項目 */}
          {mainNavItems.map((item) => (
            <Fragment key={item.to}>
            {item.startsGroup && <div aria-hidden="true" className="my-3 border-t" />}
            <NavLink
              to={item.to}
              end
              className={({ isActive, isPending }) =>
                navLinkClass({ isActive, isPending })
              }
            >
              {({ isPending }) => (
                <>
                  {isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <item.icon className="h-4 w-4" />
                  )}
                  {t(item.labelKey)}
                </>
              )}
            </NavLink>
            </Fragment>
          ))}

          {/* 区切り線 */}
          <div aria-hidden="true" className="my-3 border-t" />

          {/* 補助的なナビゲーション項目 */}
          {secondaryNavItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end
              className={({ isActive, isPending }) =>
                navLinkClass({ isActive, isPending })
              }
            >
              {({ isPending }) => (
                <>
                  {isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <item.icon className="h-4 w-4" />
                  )}
                  {t(item.labelKey)}
                </>
              )}
            </NavLink>
          ))}
          </div>
        </nav>
      </aside>

      {/* Main Content */}
      {/* <main> はサイトの共通レイアウト（routes/_layout.tsx）が持つので、ここは div にする */}
      <div className="flex-1 min-w-0">
        <div className={cn(
          "transition-opacity duration-150",
          isNavigating && "opacity-50 pointer-events-none"
        )}>
          <Outlet />
        </div>
      </div>
      <MeTour show={!user.meTourCompletedAt} />
    </div>
  );
}
