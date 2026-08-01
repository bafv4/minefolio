import { Outlet, NavLink, redirect, useLoaderData, useNavigation } from "react-router";
import type { Route } from "./+types/_layout";
import { createDb } from "@/lib/db";
import { createAuth } from "@/lib/auth";
import { getSession } from "@/lib/session";
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
} from "lucide-react";
import { ShareButton } from "@/components/share-button";
import { useT, useLocale } from "@/hooks/use-locale";
import { pickDisplayName } from "@/lib/slug";

export async function loader({ request }: Route.LoaderArgs) {
  const env = getEnv();
  const db = createDb();
  const auth = createAuth(db, env);

  const session = await getSession(request, auth);

  const user = await db.query.users.findFirst({
    where: eq(users.discordId, session.user.id),
  });

  if (!user) {
    return redirect("/onboarding");
  }

  const appUrl = env.APP_URL || "https://minefolio.app";

  return { user, appUrl };
}

// 主要なナビゲーション項目
const mainNavItems = [
  { to: "/me/edit", labelKey: "meLayout.editProfile" as const, icon: Pencil },
  { to: "/me/playstyle", labelKey: "meLayout.playstyle" as const, icon: Gamepad2 },
  { to: "/me/records", labelKey: "meLayout.records" as const, icon: Trophy },
  { to: "/me/keybindings", labelKey: "meLayout.keybindings" as const, icon: Keyboard },
  { to: "/me/devices", labelKey: "meLayout.devices" as const, icon: Mouse },
  { to: "/me/items", labelKey: "meLayout.itemLayouts" as const, icon: Package },
  { to: "/me/search-craft", labelKey: "meLayout.searchCraft" as const, icon: Search },
];

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

  return (
    <div className="flex flex-col lg:flex-row gap-8">
      {/* Sidebar Navigation */}
      <aside className="lg:w-64 shrink-0">
        <nav className="sticky top-24 space-y-1">
          <div className="mb-4 pb-4 border-b flex items-start justify-between gap-2">
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
            />
          </div>

          {/* 主要なナビゲーション項目 */}
          {mainNavItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end
              className={({ isActive, isPending }) =>
                cn(
                  "flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors",
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : isPending
                    ? "bg-secondary/50 text-muted-foreground"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                )
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

          {/* 区切り線 */}
          <div className="my-3 border-t" />

          {/* 補助的なナビゲーション項目 */}
          {secondaryNavItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end
              className={({ isActive, isPending }) =>
                cn(
                  "flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors",
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : isPending
                    ? "bg-secondary/50 text-muted-foreground"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                )
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
        </nav>
      </aside>

      {/* Main Content */}
      <main className="flex-1 min-w-0">
        <div className={cn(
          "transition-opacity duration-150",
          isNavigating && "opacity-50 pointer-events-none"
        )}>
          <Outlet />
        </div>
      </main>
    </div>
  );
}
