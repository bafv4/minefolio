import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Outlet, NavLink, useLoaderData, useLocation, useNavigation, type ShouldRevalidateFunctionArgs } from "react-router";
import type { Route } from "./+types/_layout";
import { createDb } from "@/lib/db";
import { createAuth } from "@/lib/auth";
import { getCurrentUser, registeredUserContext } from "@/lib/session";
import { getEnv } from "@/lib/env.server";
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
  Layers,
  UserCog,
  ChevronDown,
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

// /me/* の登録完了ゲート。配下の loader だけでなく **action の前**にも走るので、ウィザード（/onboarding）
// 未完了のアカウントが /me/* の action を直接 POST して書き込む（例: 登録完了前に公開にする）ことを防ぐ。
// 未ログインは /login、未登録（users 行なし・onboardingCompleted=false）は /onboarding へ redirect。
// /api/me/* は別ルート（このレイアウトの外）で、オンボーディングのスキン手順が登録完了前に使うので対象外。
// 解決した行は context に積み、下のレイアウト loader が再利用する（DB の往復を増やさない）。
export const middleware: Route.MiddlewareFunction[] = [
  async ({ request, context }) => {
    const db = createDb();
    const auth = createAuth(db, getEnv());
    const { user } = await getCurrentUser(request, auth, db);
    context.set(registeredUserContext, user);
  },
];

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = getEnv();
  const db = createDb();
  const auth = createAuth(db, env);

  // 通常はミドルウェアが解決済み（未登録なら既にそこで /onboarding へ redirect している）
  const user = context.get(registeredUserContext) ?? (await getCurrentUser(request, auth, db)).user;

  const appUrl = env.APP_URL || "https://minefolio.app";

  // 「はじめに」チェックリスト（/me/edit が useRouteLoaderData で読む。閉じ済みなら null）
  const checklist = await loadMeChecklist(db, user);

  return { user, appUrl, checklist };
}

// ナビゲーションの3群（見出し付き）。群の境目は「プリセットに保存されるか」で引く。
// 1群目: プロフィール（プレイスタイルはプリセットに属さない＝users 側に保存）。2群目: 管理（公開とアカウント・プリセット管理）。
// 3群目: 編集中のプリセットに保存される画面（各画面にプリセットの選択がある。ツアーの「編集中のプリセット」の手順と同じ4画面。
// 設定のインポートはキー配置画面のプリセット行から開く）
const navGroups = [
  {
    key: "profile",
    labelKey: "meLayout.groupProfile" as const,
    items: [
      { to: "/me/edit", labelKey: "meLayout.editProfile" as const, icon: Pencil },
      { to: "/me/records", labelKey: "meLayout.records" as const, icon: Trophy },
      { to: "/me/playstyle", labelKey: "meLayout.playstyle" as const, icon: Gamepad2 },
    ],
  },
  {
    key: "manage",
    labelKey: "meLayout.groupManage" as const,
    items: [
      { to: "/me/account", labelKey: "meLayout.account" as const, icon: UserCog },
      { to: "/me/presets", labelKey: "meLayout.presets" as const, icon: Layers },
    ],
  },
  {
    key: "preset",
    labelKey: "meLayout.groupPreset" as const,
    items: [
      { to: "/me/keybindings", labelKey: "meLayout.keybindings" as const, icon: Keyboard },
      { to: "/me/devices", labelKey: "meLayout.devices" as const, icon: Mouse },
      { to: "/me/items", labelKey: "meLayout.itemLayouts" as const, icon: Package },
      { to: "/me/search-craft", labelKey: "meLayout.searchCraft" as const, icon: Search },
    ],
  },
];

type MeNavItem = (typeof navGroups)[number]["items"][number];

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
  const currentItem = navGroups.flatMap<MeNavItem>((group) => group.items).find((item) => item.to === location.pathname);
  const currentLabel = currentItem ? t(currentItem.labelKey) : t("meLayout.home");
  // 開いたメニューは Esc で閉じ、フォーカスを開閉ボタンへ戻す（lg 未満のみ。lg 以上は常に開いたサイドバー）
  const toggleRef = useRef<HTMLButtonElement>(null);
  const handleNavBarKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Escape" || !mobileMenuOpen) return;
    if (!window.matchMedia("(max-width: 1023.98px)").matches) return;
    e.preventDefault();
    setMobileMenuOpen(false);
    toggleRef.current?.focus();
  };

  return (
    <div className="flex flex-col lg:flex-row lg:gap-8">
      {/* Sidebar Navigation。lg 未満は aside / nav を display:contents にして、開閉ボタンの帯をページ全体を
          包むコンテナの直下に出す（sticky は直近の親の中でしか貼り付かないため） */}
      <aside className="lg:w-64 shrink-0 max-lg:contents">
        <nav aria-label={t("meLayout.navLabel")} className="sticky top-24 space-y-1 max-lg:contents">
          {/* lg 未満は1行に詰める（名前と @MCID を横並び、共有ボタンは押せる高さ 44px を負のマージンで保ったまま行の高さを取らない）。
              開閉バーの上でページの h1 を押し下げないため */}
          <div data-me-tour="identity" className="max-lg:pb-2 lg:mb-4 lg:pb-4 border-b flex items-center lg:items-start justify-between gap-2">
            <div className="min-w-0 max-lg:flex max-lg:items-baseline max-lg:gap-2">
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
              className="shrink-0 max-md:min-h-11 max-md:-my-1.5"
            />
          </div>

          {/* lg 未満（縦積み）: 現在のページ名を表示する開閉トグル。h1 を1画面目に収めるため既定は閉じる。
              トグルと開いたメニューを1つの帯にして、ヘッダーの直下（64px）に貼り付ける（長いときは帯の中でスクロール）。
              lg 以上は display:contents で、従来のサイドバーのまま */}
          <div
            data-me-nav-bar
            onKeyDown={handleNavBarKeyDown}
            className="max-lg:sticky max-lg:top-[64px] max-lg:z-30 max-lg:-mx-2 max-lg:bg-background max-lg:px-2 max-lg:py-2 space-y-1 lg:contents"
          >
          <Button
            ref={toggleRef}
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
            <ChevronDown
              aria-hidden="true"
              className={cn("h-4 w-4 shrink-0 transition-transform duration-200 motion-reduce:transition-none", mobileMenuOpen && "rotate-180")}
            />
          </Button>

          <div id="me-mobile-menu" data-me-tour="sidebar" className={cn("space-y-1 max-lg:max-h-[calc(100dvh-9rem)] max-lg:overflow-y-auto", !mobileMenuOpen && "hidden", "lg:block")}>
          {navGroups.map((group, index) => {
            const headingId = `me-nav-group-${group.key}`;
            return (
              <div
                key={group.key}
                role="group"
                aria-labelledby={headingId}
                className={cn("space-y-1", index > 0 && "mt-3 border-t pt-3")}
              >
                <p id={headingId} className="px-3 pb-1 text-xs font-medium text-muted-foreground">
                  {t(group.labelKey)}
                </p>
                {group.items.map((item) => (
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
            );
          })}
          </div>
          </div>
        </nav>
      </aside>

      {/* Main Content */}
      {/* <main> はサイトの共通レイアウト（routes/_layout.tsx）が持つので、ここは div にする */}
      <div className="flex-1 min-w-0 max-lg:mt-4">
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
