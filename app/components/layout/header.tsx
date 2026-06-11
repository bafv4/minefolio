import { Link, useLocation, useNavigate } from "react-router";
import { Menu, User, LogOut, Settings, Heart, Sun, Moon, Radio, Search, Keyboard, Trophy, LogIn, MessageSquare, BookOpen } from "lucide-react";
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
import { ThemeToggle } from "./theme-toggle";
import { cn } from "@/lib/utils";
import { authClient } from "@/lib/auth-client";

interface HeaderProps {
  user?: {
    mcid: string | null;
    slug: string;
    displayName: string | null;
    discordAvatar: string | null;
  } | null;
}

const navigation = [
  { name: "ライブ", href: "/live", icon: Radio },
  { name: "探す", href: "/browse", icon: Search },
  { name: "操作設定", href: "/keybindings", icon: Keyboard },
  { name: "ランキング", href: "/rankings", icon: Trophy },
  { name: "ガイド", href: "/guides", icon: BookOpen },
];

export function Header({ user }: HeaderProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();

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
          aria-label="メインナビゲーション"
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
                  <div key={item.name} className="flex items-center">
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
                      {item.name}
                    </Link>
                  </div>
                );
              })}
            </div>

            {/* Right side - Desktop */}
            <div className="hidden md:flex items-center space-x-4">
              <ThemeToggle />

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
                          alt={user.displayName ?? user.mcid ?? user.slug}
                        />
                        <AvatarFallback>
                          {(user.displayName ?? user.mcid ?? user.slug)[0].toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <div className="flex items-center justify-start gap-2 px-2 py-2">
                      <div className="flex flex-col space-y-0.5">
                        <p className="text-sm font-medium">
                          {user.displayName ?? user.mcid ?? user.slug}
                        </p>
                        {user.mcid && (
                          <p className="text-xs text-muted-foreground">
                            @{user.mcid}
                          </p>
                        )}
                      </div>
                    </div>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem asChild>
                      <Link to={`/player/${user.slug}`}>
                        <User className="mr-2 h-4 w-4" />
                        マイプロフィール
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link to="/me/edit">
                        <Settings className="mr-2 h-4 w-4" />
                        設定
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link to="/my-guides">
                        <BookOpen className="mr-2 h-4 w-4" />
                        ガイド
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link to="/favorites">
                        <Heart className="mr-2 h-4 w-4" />
                        お気に入り
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link to="/feedback">
                        <MessageSquare className="mr-2 h-4 w-4" />
                        フィードバック
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={handleLogout}>
                      <LogOut className="mr-2 h-4 w-4" />
                      ログアウト
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <Button asChild size="sm">
                  <Link to="/login">ログイン</Link>
                </Button>
              )}
            </div>

            {/* Mobile menu button — Sheet (Radix Dialog) でアクセシブル化 */}
            <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
              <SheetTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="md:hidden"
                  aria-label="メニューを開く"
                >
                  <Menu className="h-6 w-6" aria-hidden />
                </Button>
              </SheetTrigger>
              <SheetContent
                side="right"
                className="w-[86%] max-w-xs p-0 flex flex-col gap-0"
              >
                <SheetTitle className="sr-only">ナビゲーション</SheetTitle>
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
                  aria-label="モバイルナビゲーション"
                  className="flex-1 overflow-y-auto px-3 py-4"
                >
                  <p className="px-3 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    ナビゲーション
                  </p>
                  <div className="flex flex-col gap-0.5">
                    {navigation.map((item) => {
                      const Icon = item.icon;
                      const active = location.pathname === item.href;
                      return (
                        <Link
                          key={item.name}
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
                          {item.name}
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
                            alt={user.displayName ?? user.mcid ?? user.slug}
                          />
                          <AvatarFallback>
                            {(user.displayName ?? user.mcid ?? user.slug)[0].toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">
                            {user.displayName ?? user.mcid ?? user.slug}
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
                          { href: `/player/${user.slug}`, icon: User, label: "マイプロフィール" },
                          { href: "/me/edit", icon: Settings, label: "設定" },
                          { href: "/my-guides", icon: BookOpen, label: "ガイド" },
                          { href: "/favorites", icon: Heart, label: "お気に入り" },
                          { href: "/feedback", icon: MessageSquare, label: "フィードバック" },
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
                          ログアウト
                        </button>
                      </div>
                    </>
                  ) : (
                    <Button asChild className="mt-5 w-full gap-2">
                      <Link to="/login" onClick={() => setMobileMenuOpen(false)}>
                        <LogIn className="h-4 w-4" />
                        ログイン
                      </Link>
                    </Button>
                  )}
                </nav>

                {/* フッター: テーマ切替（ViewSwitcher と同じセグメント調） */}
                <div className="border-t border-border px-4 py-3 shrink-0">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">テーマ</span>
                    <div className="inline-flex items-center rounded-lg border bg-card p-0.5 gap-0.5">
                      <button
                        type="button"
                        aria-pressed={theme === "light"}
                        onClick={() => setTheme("light")}
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                          theme === "light"
                            ? "bg-secondary text-foreground"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        <Sun className="h-4 w-4" />
                        ライト
                      </button>
                      <button
                        type="button"
                        aria-pressed={theme === "dark"}
                        onClick={() => setTheme("dark")}
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                          theme === "dark"
                            ? "bg-secondary text-foreground"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        <Moon className="h-4 w-4" />
                        ダーク
                      </button>
                    </div>
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
