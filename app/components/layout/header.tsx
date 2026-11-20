import { Link, useLocation, useNavigate } from "react-router";
import { Menu, User, LogOut, Settings, Heart, Search, Keyboard, Trophy, LogIn, MessageSquare, BookOpen, FlaskConical, NotebookPen } from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ThemeToggle, THEME_OPTIONS } from "./theme-toggle";
import { Switch } from "@/components/ui/switch";
import { useContrast } from "@/hooks/use-contrast";
import { WhatsNew } from "@/components/whats-new";
import { cn } from "@/lib/utils";
import { useLoginHref } from "@/hooks/use-login-href";
import { findActiveNavHref } from "@/lib/nav-active";
import { authClient } from "@/lib/auth-client";
import { useT, useLocale, useSetLocale } from "@/hooks/use-locale";
import { SUPPORTED_LOCALES, LOCALE_NAMES } from "@/lib/locale";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { getLocalizedDisplayName } from "@/lib/slug";
import { MinecraftAvatar } from "@/components/minecraft-avatar";

interface HeaderProps {
  user?: {
    mcid: string | null;
    slug: string;
    displayName: string | null;
    displayNameAlphabet: string | null;
    discordAvatar: string | null;
    uuid?: string | null;
    customSkinUrl?: string | null;
  } | null;
  /** 初期設定（/onboarding）が未完了。true のとき「設定」（/me/*）は開けないので「初期設定を続ける」に差し替える */
  onboardingPending?: boolean;
}

/** ナビ・ロゴのキーボードフォーカス（ほかの操作部品と同じ不透明の 2px） */
const NAV_FOCUS_CLASS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/**
 * ヘッダーのアバター。スキンがある人（MCID かカスタムスキン）はスキンの顔（ホームのおかえりバーと同じ）、
 * 無い人は従来どおり Discord のアバター／頭文字
 */
function HeaderAvatar({
  user,
  name,
  size,
}: {
  user: NonNullable<HeaderProps["user"]>;
  name: string;
  size: 36 | 40;
}) {
  if (user.mcid || user.customSkinUrl) {
    return (
      <MinecraftAvatar
        uuid={user.uuid}
        skinUrl={user.customSkinUrl}
        mcid={user.mcid}
        size={size}
        alt=""
        className="shrink-0 rounded-lg"
      />
    );
  }
  return (
    <Avatar className={size === 36 ? "h-9 w-9" : "h-10 w-10"} aria-hidden>
      <AvatarImage src={user.discordAvatar ?? undefined} alt={name} />
      <AvatarFallback>{name[0]?.toUpperCase()}</AvatarFallback>
    </Avatar>
  );
}

// ラベルは描画時に t() で解決する（モジュール評価時はロケールが未確定のため）
const navigation = [
  { key: "nav.browse", href: "/browse", icon: Search },
  { key: "nav.keybindings", href: "/keybindings", icon: Keyboard },
  { key: "nav.rankings", href: "/rankings", icon: Trophy },
  { key: "nav.guides", href: "/guides", icon: BookOpen },
] as const;

export function Header({ user, onboardingPending = false }: HeaderProps) {
  const t = useT();
  const locale = useLocale();
  const setLocale = useSetLocale();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();
  const { enabled: highContrast, setEnabled: setHighContrast } = useContrast();

  // サブルート（/guides/xxx 等）でも親のナビ項目を現在地にする
  const activeHref = findActiveNavHref(location.pathname, navigation.map((n) => n.href));

  // 英語表示ではアルファベット表記を優先する
  const userName = user ? getLocalizedDisplayName(user, locale) : "";
  // 未完了の人は /me/* に入ると /onboarding へ戻されるので、最初から初期設定へ案内する
  const settingsLink = onboardingPending
    ? { href: "/onboarding", label: t("onboarding.resumeAction") }
    : { href: "/me/edit", label: t("nav.settings") };

  // ログイン後、遷移前にいたページ（現在地）へ戻れるように returnTo を付ける
  const loginHref = useLoginHref();

  const handleLogout = useCallback(async () => {
    await authClient.signOut();
    navigate("/", { replace: true });
    window.location.reload();
  }, [navigate]);

  // Sheet（Radix Dialog）がスクロールロック・フォーカストラップ・Escape を自動管理

  // ルート変更時にメニューを閉じる
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  return (
    <>
      <header className="sticky top-0 z-50 w-full border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <nav
          aria-label={t("nav.mainNav")}
          className="container mx-auto px-4 sm:px-6 lg:px-8"
        >
          <div className="flex h-16 items-center justify-between">
            {/* Logo */}
            <div className="flex min-w-0 items-center">
              <Link to="/" className={cn("flex min-w-0 items-center space-x-2 rounded-md", NAV_FOCUS_CLASS)}>
                <img src="/icon.png" alt="" className="h-8 w-8 shrink-0" />
                <span className="truncate text-xl font-bold">Minefolio</span>
              </Link>
            </div>

            {/* Desktop Navigation（ロゴ＋ナビ＋右側の操作が1行に収まるのは約900px以上。md〈768px〉の
                container では幅が足りず各項目が折り返すため、横並びは lg から。未満はハンバーガーメニュー） */}
            <div className="hidden lg:flex lg:items-center lg:space-x-1">
              {navigation.map((item, index) => {
                const Icon = item.icon;
                const active = item.href === activeHref;
                return (
                  <div key={item.key} className="flex items-center">
                    {index > 0 && (
                      <div className="h-4 w-px bg-border mx-2" />
                    )}
                    <Link
                      to={item.href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex items-center gap-1.5 whitespace-nowrap px-3 py-2 text-sm font-medium transition-colors rounded-md hover:bg-accent hover:text-accent-foreground",
                        NAV_FOCUS_CLASS,
                        active
                          ? "text-brand bg-brand/10"
                          : "text-muted-foreground"
                      )}
                    >
                      <Icon className="h-4 w-4" />
                      {t(item.key)}
                    </Link>
                  </div>
                );
              })}
            </div>

            {/* Right side - Desktop */}
            <div className="hidden lg:flex items-center space-x-4">
              <ThemeToggle />
              <LocaleSwitcher />
              <WhatsNew />

              {user ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      className={cn(
                        "relative h-9 w-9 p-0",
                        // スキンの顔は角丸の四角（36px は rounded-lg）、Discord のアバターは丸
                        user.mcid || user.customSkinUrl ? "rounded-lg" : "rounded-full",
                      )}
                      aria-label={t("nav.userMenu", { name: userName })}
                    >
                      {/* 名前はボタンの aria-label が担う（頭文字のフォールバックを「H」と読ませない） */}
                      <HeaderAvatar user={user} name={userName} size={36} />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <div className="flex items-center justify-start gap-2 px-2 py-2">
                      <div className="flex flex-col space-y-0.5">
                        <p className="text-sm font-medium">
                          {userName}
                        </p>
                        {user.mcid && (
                          <p className="text-xs text-muted-foreground">
                            @{user.mcid}
                          </p>
                        )}
                      </div>
                    </div>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem asChild className="cursor-pointer">
                      <Link to={`/player/${user.slug}`}>
                        <User className="mr-2 h-4 w-4" />
                        {t("nav.myProfile")}
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild className="cursor-pointer">
                      <Link to={settingsLink.href}>
                        <Settings className="mr-2 h-4 w-4" />
                        {settingsLink.label}
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild className="cursor-pointer">
                      <Link to="/my-guides">
                        <NotebookPen className="mr-2 h-4 w-4" />
                        {t("nav.myGuides")}
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild className="cursor-pointer">
                      <Link to="/playground">
                        <FlaskConical className="mr-2 h-4 w-4" />
                        {t("nav.playground")}
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild className="cursor-pointer">
                      <Link to="/favorites">
                        <Heart className="mr-2 h-4 w-4" />
                        {t("nav.favorites")}
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild className="cursor-pointer">
                      <Link to="/feedback">
                        <MessageSquare className="mr-2 h-4 w-4" />
                        {t("nav.feedback")}
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="destructive"
                      onSelect={handleLogout}
                      className="cursor-pointer"
                    >
                      <LogOut className="mr-2 h-4 w-4" />
                      {t("nav.logout")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <Button asChild size="sm">
                  <Link to={loginHref}>{t("nav.login")}</Link>
                </Button>
              )}
            </div>

            {/* Mobile menu button — Sheet (Radix Dialog) でアクセシブル化 */}
            <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
              <div className="flex shrink-0 items-center gap-1 lg:hidden">
                <WhatsNew />
                <SheetTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-11 md:size-9"
                    aria-label={t("nav.openMenu")}
                  >
                    <Menu className="size-5" aria-hidden />
                  </Button>
                </SheetTrigger>
              </div>
              <SheetContent
                side="right"
                closeLabel={t("common.close")}
                // 閉じるボタンを 44px 四方にする（ヘッダー帯 64px の中で縦中央）
                closeClassName="top-2.5 right-2.5 flex size-11 items-center justify-center p-0"
                className="w-[86%] max-w-xs p-0 flex flex-col gap-0"
              >
                <SheetTitle className="sr-only">{t("nav.navigation")}</SheetTitle>
                {/* ヘッダー */}
                <div className="flex h-16 items-center px-5 border-b border-border shrink-0">
                  <Link
                    to="/"
                    className={cn("flex items-center gap-2 rounded-md", NAV_FOCUS_CLASS)}
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    <img src="/icon.png" alt="" className="h-7 w-7" />
                    <span className="text-lg font-bold">Minefolio</span>
                  </Link>
                </div>

                <nav
                  aria-label={t("nav.mobileNav")}
                  className="flex-1 overflow-y-auto px-3 py-4"
                >
                  <h2 className="px-3 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {t("nav.navigation")}
                  </h2>
                  <div className="flex flex-col gap-0.5">
                    {navigation.map((item) => {
                      const Icon = item.icon;
                      const active = item.href === activeHref;
                      return (
                        <Link
                          key={item.key}
                          to={item.href}
                          onClick={() => setMobileMenuOpen(false)}
                          aria-current={active ? "page" : undefined}
                          className={cn(
                            "flex min-h-11 items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors touch-manipulation",
                            NAV_FOCUS_CLASS,
                            active
                              ? "bg-brand/10 text-brand"
                              : "text-foreground/80 hover:bg-accent hover:text-accent-foreground",
                          )}
                        >
                          <Icon className="h-5 w-5 shrink-0" />
                          {t(item.key)}
                        </Link>
                      );
                    })}
                  </div>

                  {user ? (
                    <>
                      {/* アカウントの項目の群の見出し（見た目は上の「ナビゲーション」と同じ） */}
                      <h2 className="mt-5 px-3 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        {t("nav.account")}
                      </h2>
                      <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5">
                        <HeaderAvatar user={user} name={userName} size={40} />
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">
                            {userName}
                          </p>
                          {user.mcid && (
                            <p className="text-xs text-muted-foreground truncate">
                              @{user.mcid}
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="mt-2 flex flex-col gap-0.5">
                        {[
                          { href: `/player/${user.slug}`, icon: User, label: t("nav.myProfile") },
                          { href: settingsLink.href, icon: Settings, label: settingsLink.label },
                          { href: "/my-guides", icon: NotebookPen, label: t("nav.myGuides") },
                          { href: "/playground", icon: FlaskConical, label: t("nav.playground") },
                          { href: "/favorites", icon: Heart, label: t("nav.favorites") },
                          { href: "/feedback", icon: MessageSquare, label: t("nav.feedback") },
                        ].map(({ href, icon: Icon, label }) => (
                          <Link
                            key={href}
                            to={href}
                            onClick={() => setMobileMenuOpen(false)}
                            className={cn(
                              "flex min-h-11 items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium text-foreground/80 hover:bg-accent hover:text-accent-foreground transition-colors touch-manipulation",
                              NAV_FOCUS_CLASS,
                            )}
                          >
                            <Icon className="h-5 w-5 shrink-0" />
                            {label}
                          </Link>
                        ))}
                      </div>
                      {/* ログアウトはナビの列から区切る */}
                      <div className="mt-2 border-t border-border/60 pt-2">
                        <button
                          type="button"
                          className={cn(
                            "flex min-h-11 items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium text-destructive hover:bg-destructive/10 transition-colors touch-manipulation w-full",
                            NAV_FOCUS_CLASS,
                          )}
                          onClick={() => {
                            setMobileMenuOpen(false);
                            handleLogout();
                          }}
                        >
                          <LogOut className="h-5 w-5 shrink-0" />
                          {t("nav.logout")}
                        </button>
                      </div>
                    </>
                  ) : (
                    <Button asChild className="mt-5 w-full gap-2 min-h-11">
                      <Link to={loginHref} onClick={() => setMobileMenuOpen(false)}>
                        <LogIn className="h-4 w-4" />
                        {t("nav.login")}
                      </Link>
                    </Button>
                  )}
                </nav>

                {/* フッター: テーマ切替（ViewSwitcher と同じセグメント調） */}
                <div className="border-t border-border px-4 py-3 shrink-0">
                  <span className="text-sm text-muted-foreground">{t("nav.theme")}</span>
                  <div className="mt-2 flex rounded-lg border bg-card p-0.5 gap-0.5">
                    {THEME_OPTIONS.map(({ value, shortLabelKey, icon: Icon }) => (
                      <button
                        key={value}
                        type="button"
                        aria-pressed={theme === value}
                        onClick={() => setTheme(value)}
                        className={cn(
                          // 4択（システム・ライト・ダーク・ウルトラ）が幅に収まるよう、アイコンを文字の上に置く。
                          // 高さは 44px 以上になる（押せる範囲もそのまま）
                          "flex min-h-11 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-md px-1 py-1.5 text-xs font-medium transition-colors",
                          theme === value
                            ? "bg-secondary text-foreground"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        <Icon className="h-4 w-4 shrink-0" aria-hidden />
                        {t(shortLabelKey)}
                      </button>
                    ))}
                  </div>

                  {/* ハイコントラスト（テーマとは別のオン・オフ。ラベルごと押せる） */}
                  <label className="mt-3 flex min-h-11 cursor-pointer items-center justify-between gap-3 text-sm">
                    <span>{t("theme.highContrast")}</span>
                    <Switch checked={highContrast} onCheckedChange={setHighContrast} />
                  </label>

                  {/* 言語切替（デスクトップはヘッダー右のドロップダウン、
                      モバイルはテーマと同じセグメント切替で並べる） */}
                  <span className="mt-4 block text-sm text-muted-foreground">
                    {t("nav.language")}
                  </span>
                  <div className="mt-2 flex rounded-lg border bg-card p-0.5 gap-0.5">
                    {SUPPORTED_LOCALES.map((value) => (
                      <button
                        key={value}
                        type="button"
                        aria-pressed={locale === value}
                        onClick={() => setLocale(value)}
                        className={cn(
                          // 高さは 44px 以上（押せる範囲も見た目もそのまま）
                          "flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
                          locale === value
                            ? "bg-secondary text-foreground"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {LOCALE_NAMES[value]}
                      </button>
                    ))}
                  </div>
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </nav>
      </header>
    </>
  );
}
