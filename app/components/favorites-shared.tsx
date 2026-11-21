import { Link } from "react-router";
import { NoticeBanner } from "@/components/notice-banner";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { useT } from "@/hooks/use-locale";
import { Cookie, Users } from "lucide-react";

/** Cookie 未承諾の警告（未ログインのお気に入りはブラウザ保存なので Cookie 同意が要る。/favorites と /favorites/activity で共用） */
export function FavoritesCookieAlert({ onAccept }: { onAccept: () => void }) {
  const t = useT();
  return (
    <NoticeBanner tone="warning" icon={Cookie}>
      <p className="font-medium">{t("favorites.cookieDisabled")}</p>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="text-muted-foreground">{t("favorites.cookieRequired")}</p>
        <Button size="sm" onClick={onAccept} className="min-h-11 sm:min-h-8">
          {t("favorites.enableCookie")}
        </Button>
      </div>
    </NoticeBanner>
  );
}

/** お気に入りが 0 人のときの空状態（Cookie 未承諾なら理由を、そうでなければ使い方を案内し、走者を探す導線を置く） */
export function FavoritesEmptyState({ cookieBlocked }: { cookieBlocked: boolean }) {
  const t = useT();
  return (
    <EmptyState
      icon={<Users className="h-12 w-12" aria-hidden />}
      title={t("favorites.emptyTitle")}
      description={cookieBlocked ? t("favorites.cookieRequired") : t("favorites.emptyHelp")}
      action={
        <Button asChild className="mt-4">
          <Link to="/browse">{t("favorites.browseRunner")}</Link>
        </Button>
      }
    />
  );
}
