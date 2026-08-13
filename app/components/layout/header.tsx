import { Link, useLocation, useNavigate } from "react-router";
import { Menu, User, LogOut, Settings, Heart, Search, Keyboard, Trophy, LogIn, MessageSquare, BookOpen, FlaskConical } from "lucide-react";
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
import { WhatsNew } from "@/components/whats-new";
import { cn } from "@/lib/utils";
import { sanitizeReturnTo } from "@/lib/return-to";
import { authClient } from "@/lib/auth-client";
import { useT, useLocale, useSetLocale } from "@/hooks/use-locale";
import { SUPPORTED_LOCALES, LOCALE_NAMES } from "@/lib/locale";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { getLocalizedDisplayName } from "@/lib/slug";

interface HeaderProps {
  user?: {
    mcid: string | null;
    slug: string;
    displayName: string | null;
    displayNameAlphabet: string | null;
    discordAvatar: string | null;
  } | null;
}

// ラベルは描画時に t() で解決する（モジュール評価時はロケールが未確定のため）
const navigation = [
  { key: "nav.browse", href: "/browse", icon: Search },
  { key: "nav.keybindings", href: "/keybindings", icon: Keyboard },
  { key: "nav.rankings", href: "/rankings", icon: Trophy },
  { key: "nav.guides", href: "/guides", icon: BookOpen },
] as const;

export function Header({ user }: HeaderProps) {
  const t = useT();
  const locale = useLocale();
  const setLocale = useSetLocale();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();

  // 英語表示ではアルファベット表記を優先する
  const userName = user ? getLocalizedDisplayName(user, locale) : "";

  // ログイン後、遷移前にいたページ（現在地）へ戻れるように returnTo を付ける
  const returnTo = sanitizeReturnTo(`${location.pathname}${location.search}`);
  const loginHref = returnTo ? `/login?returnTo=${encodeURIComponent(returnTo)}` : "/login";

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
            <div className="flex items-center">
              <Link to="/" className="flex items-center space-x-2">
                <img src="/icon.png" alt="Minefolio" className="h-8 w-8" />
                <span className="text-xl font-bold">Minefolio</span>
              </Link>
            </div>

            {/* Desktop Navigation */}
            <div className="hidden md:flex md:items-center md:space-x-1">
              {navigation.map((item, index) => {
                const Icon = item.icon;
                return (
                  <div key={item.key} className="flex items-center">
                    {index > 0 && (
                      <div className="h-4 w-px bg-border mx-2" />
                    )}
                    <Link
                      to={item.href}
                      className={cn(
                        "flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors rounded-md hover:bg-accent hover:text-accent-foreground",
                        location.pathname === item.href
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
            <div className="hidden md:flex items-center space-x-4">
              <ThemeToggle />
              <LocaleSwitcher />
              <WhatsNew />

              {user ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      className="relative h-9 w-9 rounded-full"
                    >
                      <Avatar className="h-9 w-9">
                        <AvatarImage
                          src={user.discordAvatar ?? undefined}
                          alt={userName}
                        />
                        <AvatarFallback>
                          {userName[0]?.toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
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
                      <Link to="/me/edit">
                        <Settings className="mr-2 h-4 w-4" />
                        {t("nav.settings")}
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild className="cursor-pointer">
                      <Link to="/my-guides">
                        <BookOpen className="mr-2 h-4 w-4" />
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
              <div className="flex items-center gap-1 md:hidden">
                <WhatsNew />
                <SheetTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t("nav.openMenu")}
                  >
                    <Menu className="size-5" aria-hidden />
                  </Button>
                </SheetTrigger>
              </div>
              <SheetContent
                side="right"
                className="w-[86%] max-w-xs p-0 flex flex-col gap-0"
              >
                <SheetTitle className="sr-only">{t("nav.navigation")}</SheetTitle>
                {/* ヘッダー */}
                <div className="flex h-16 items-center px-5 border-b border-border shrink-0">
                  <Link
                    to="/"
                    className="flex items-center gap-2"
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    <img src="/icon.png" alt="Minefolio" className="h-7 w-7" />
                    <span className="text-lg font-bold">Minefolio</span>
                  </Link>
                </div>

                <nav
                  aria-label={t("nav.mobileNav")}
                  className="flex-1 overflow-y-auto px-3 py-4"
                >
                  <p className="px-3 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {t("nav.navigation")}
                  </p>
                  <div className="flex flex-col gap-0.5">
                    {navigation.map((item) => {
                      const Icon = item.icon;
                      const active = location.pathname === item.href;
                      return (
                        <Link
                          key={item.key}
                          to={item.href}
                          onClick={() => setMobileMenuOpen(false)}
                          aria-current={active ? "page" : undefined}
                          className={cn(
                            "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors touch-manipulation",
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
                      <div className="mt-5 flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5">
                        <Avatar className="h-10 w-10">
                          <AvatarImage
                            src={user.discordAvatar ?? undefined}
                            alt={userName}
                          />
                          <AvatarFallback>
                            {userName[0]?.toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
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
                          { href: "/me/edit", icon: Settings, label: t("nav.settings") },
                          { href: "/my-guides", icon: BookOpen, label: t("nav.myGuides") },
                          { href: "/playground", icon: FlaskConical, label: t("nav.playground") },
                          { href: "/favorites", icon: Heart, label: t("nav.favorites") },
                          { href: "/feedback", icon: MessageSquare, label: t("nav.feedback") },
                        ].map(({ href, icon: Icon, label }) => (
                          <Link
                            key={href}
                            to={href}
                            onClick={() => setMobileMenuOpen(false)}
                            className="flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium text-foreground/80 hover:bg-accent hover:text-accent-foreground transition-colors touch-manipulation"
                          >
                            <Icon className="h-5 w-5 shrink-0" />
                            {label}
                          </Link>
                        ))}
                        <button
                          type="button"
                          className="flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium text-destructive hover:bg-destructive/10 transition-colors touch-manipulation w-full"
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
                    <Button asChild className="mt-5 w-full gap-2">
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
                          "flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
                          theme === value
                            ? "bg-secondary text-foreground"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        <Icon className="h-4 w-4 shrink-0" />
                        {t(shortLabelKey)}
                      </button>
                    ))}
                  </div>

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
                          "flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
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
