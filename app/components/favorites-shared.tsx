import { Link } from "react-router";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { useT } from "@/hooks/use-locale";
import { Cookie, Users } from "lucide-react";

/** Cookie 未承諾の警告（未ログインのお気に入りはブラウザ保存なので Cookie 同意が要る。/favorites と /favorites/activity で共用） */
export function FavoritesCookieAlert({ onAccept }: { onAccept: () => void }) {
  const t = useT();
  return (
    <Alert>
      <Cookie className="h-4 w-4" />
      <AlertTitle>{t("favorites.cookieDisabled")}</AlertTitle>
      <AlertDescription className="flex items-center justify-between">
        <span>{t("favorites.cookieRequired")}</span>
        <Button size="sm" onClick={onAccept} className="ml-4">
          {t("favorites.enableCookie")}
        </Button>
      </AlertDescription>
    </Alert>
  );
}

/** お気に入りが 0 人のときの空状態（Cookie 未承諾なら理由を、そうでなければ使い方を案内し、走者を探す導線を置く） */
export function FavoritesEmptyState({ cookieBlocked }: { cookieBlocked: boolean }) {
  const t = useT();
  return (
    <EmptyState
      icon={<Users className="h-12 w-12" />}
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
