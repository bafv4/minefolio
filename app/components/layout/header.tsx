import { Link, useLocation } from "react-router";
import { Menu, X, User, LogOut, Settings, Heart, Sun, Moon, Home, Search, Keyboard, BarChart3, GitCompare, LogIn } from "lucide-react";
import { useState, useEffect } from "react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ThemeToggle } from "./theme-toggle";
import { cn } from "@/lib/utils";

interface HeaderProps {
  user?: {
    mcid: string | null;
    slug: string;
    displayName: string | null;
    discordAvatar: string | null;
  } | null;
}

const navigation = [
  { name: "ホーム", href: "/", icon: Home },
  { name: "探す", href: "/browse", icon: Search },
  { name: "操作設定", href: "/keybindings", icon: Keyboard },
  { name: "統計", href: "/keybindings/stats", icon: BarChart3 },
  { name: "比較", href: "/compare", icon: GitCompare },
];

export function Header({ user }: HeaderProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const location = useLocation();
  const { theme, setTheme } = useTheme();

  // メニューが開いている時はスクロールを無効化
  useEffect(() => {
    if (mobileMenuOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileMenuOpen]);

  // ルート変更時にメニューを閉じる
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  return (
    <>
      <header className="sticky top-0 z-50 w-full border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <nav className="container mx-auto px-4 sm:px-6 lg:px-8">
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
              {navigation.map((item, index) => (
                <div key={item.name} className="flex items-center">
                  {index > 0 && (
                    <div className="h-4 w-px bg-border mx-2" />
                  )}
                  <Link
                    to={item.href}
                    className={cn(
                      "px-3 py-2 text-sm font-medium transition-colors rounded-md hover:bg-accent hover:text-accent-foreground",
                      location.pathname === item.href
                        ? "text-foreground bg-accent/50"
                        : "text-muted-foreground"
                    )}
                  >
                    {item.name}
                  </Link>
                </div>
              ))}
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
                      <Link to="/favorites">
                        <Heart className="mr-2 h-4 w-4" />
                        お気に入り
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem asChild>
                      <Link to="/api/auth/logout">
                        <LogOut className="mr-2 h-4 w-4" />
                        ログアウト
                      </Link>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <Button asChild size="sm">
                  <Link to="/login">ログイン</Link>
                </Button>
              )}
            </div>

            {/* Mobile menu button */}
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
              {mobileMenuOpen ? (
                <X className="h-6 w-6" />
              ) : (
                <Menu className="h-6 w-6" />
              )}
              <span className="sr-only">メニューを開閉</span>
            </Button>
          </div>
        </nav>
      </header>

      {/* Mobile Full Screen Navigation */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-[60] md:hidden">
          {/* 背景オーバーレイ */}
          <div
            className="absolute inset-0 bg-background/80 backdrop-blur-sm"
            onClick={() => setMobileMenuOpen(false)}
          />

          {/* メニューコンテンツ */}
          <div className="absolute inset-x-0 top-0 bottom-0 flex flex-col bg-background">
            {/* ヘッダー部分 */}
            <div className="flex h-16 items-center justify-between px-4 border-b border-border shrink-0">
              <Link
                to="/"
                className="flex items-center space-x-2"
                onClick={() => setMobileMenuOpen(false)}
              >
                <img src="/icon.png" alt="Minefolio" className="h-8 w-8" />
                <span className="text-xl font-bold">Minefolio</span>
              </Link>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setMobileMenuOpen(false)}
              >
                <X className="h-6 w-6" />
                <span className="sr-only">メニューを閉じる</span>
              </Button>
            </div>

            {/* Navigation Links */}
            <div className="flex-1 overflow-y-auto px-4 py-6">
              <div className="flex flex-col space-y-2">
                {navigation.map((item) => {
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.name}
                      to={item.href}
                      className={cn(
                        "flex items-center gap-4 px-4 py-4 text-lg font-medium rounded-xl transition-colors touch-manipulation",
                        location.pathname === item.href
                          ? "bg-primary text-primary-foreground"
                          : "bg-secondary/50 text-foreground hover:bg-secondary"
                      )}
                      onClick={() => setMobileMenuOpen(false)}
                    >
                      <Icon className="h-6 w-6" />
                      {item.name}
                    </Link>
                  );
                })}
              </div>

              {/* Separator */}
              <div className="my-6 border-t border-border" />

              {/* User Section */}
              {user ? (
                <div className="flex flex-col space-y-2">
                  {/* User Info */}
                  <div className="flex items-center gap-4 px-4 py-4 bg-secondary/30 rounded-xl">
                    <Avatar className="h-12 w-12">
                      <AvatarImage
                        src={user.discordAvatar ?? undefined}
                        alt={user.displayName ?? user.mcid ?? user.slug}
                      />
                      <AvatarFallback className="text-lg">
                        {(user.displayName ?? user.mcid ?? user.slug)[0].toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex flex-col">
                      <p className="text-lg font-medium">
                        {user.displayName ?? user.mcid ?? user.slug}
                      </p>
                      {user.mcid && (
                        <p className="text-sm text-muted-foreground">
                          @{user.mcid}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* User Menu Items */}
                  <Link
                    to={`/player/${user.slug}`}
                    className="flex items-center gap-4 px-4 py-4 text-lg font-medium rounded-xl bg-secondary/50 text-foreground hover:bg-secondary transition-colors touch-manipulation"
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    <User className="h-6 w-6" />
                    マイプロフィール
                  </Link>

                  <Link
                    to="/me/edit"
                    className="flex items-center gap-4 px-4 py-4 text-lg font-medium rounded-xl bg-secondary/50 text-foreground hover:bg-secondary transition-colors touch-manipulation"
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    <Settings className="h-6 w-6" />
                    設定
                  </Link>

                  <Link
                    to="/favorites"
                    className="flex items-center gap-4 px-4 py-4 text-lg font-medium rounded-xl bg-secondary/50 text-foreground hover:bg-secondary transition-colors touch-manipulation"
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    <Heart className="h-6 w-6" />
                    お気に入り
                  </Link>

                  <Link
                    to="/api/auth/logout"
                    className="flex items-center gap-4 px-4 py-4 text-lg font-medium rounded-xl bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors touch-manipulation"
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    <LogOut className="h-6 w-6" />
                    ログアウト
                  </Link>
                </div>
              ) : (
                <Link
                  to="/login"
                  className="flex items-center justify-center gap-3 px-4 py-4 text-lg font-medium rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 transition-colors touch-manipulation"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  <LogIn className="h-6 w-6" />
                  ログイン
                </Link>
              )}
            </div>

            {/* Footer - Theme Toggle */}
            <div className="border-t border-border px-4 py-4 bg-background shrink-0">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">テーマ</span>
                <div className="flex items-center gap-2">
                  <Button
                    variant={theme === "light" ? "default" : "outline"}
                    size="sm"
                    className="gap-2"
                    onClick={() => setTheme("light")}
                  >
                    <Sun className="h-4 w-4" />
                    ライト
                  </Button>
                  <Button
                    variant={theme === "dark" ? "default" : "outline"}
                    size="sm"
                    className="gap-2"
                    onClick={() => setTheme("dark")}
                  >
                    <Moon className="h-4 w-4" />
                    ダーク
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
