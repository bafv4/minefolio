import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { MinecraftAvatar } from "@/components/minecraft-avatar";
import { useT } from "@/hooks/use-locale";
import { formatClock } from "@/lib/home-format";
import { Heart, Pencil, User } from "lucide-react";

export interface WelcomeHighlight {
  kind: "pace" | "pb";
  /** pace: 到達区間名 / pb: カテゴリの表示名 */
  label: string;
  timeMs: number;
}

/** ログイン済みの「おかえりなさい」バー（1行・72px前後）。宣伝の見出し・説明は出さない */
export function WelcomeBar({
  name,
  slug,
  uuid,
  skinUrl,
  highlight,
}: {
  name: string;
  slug: string;
  uuid: string | null;
  skinUrl: string | null;
  highlight: WelcomeHighlight | null;
}) {
  const t = useT();
  return (
    <section
      aria-label={t("home.welcomeBack", { name })}
      className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-2xl border border-border/70 bg-card/80 px-4 py-3 shadow-sm sm:px-5"
    >
      <Link to={`/player/${slug}`} className="shrink-0" aria-hidden="true" tabIndex={-1}>
        <MinecraftAvatar uuid={uuid} skinUrl={skinUrl} size={44} className="rounded-xl" />
      </Link>
      <div className="min-w-0 flex-1 basis-48">
        <p className="truncate text-base font-semibold">{t("home.welcomeBack", { name })}</p>
        {highlight && (
          <p className="truncate text-xs text-muted-foreground">
            {highlight.kind === "pace"
              ? t("home.welcomeLatestPace", { split: highlight.label })
              : t("home.welcomeLatestPb", { category: highlight.label })}{" "}
            <span className="font-mono font-semibold tabular-nums text-foreground">{formatClock(highlight.timeMs)}</span>
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Button asChild className="min-h-11 sm:min-h-9">
          <Link to="/me/edit">
            <Pencil className="mr-1.5 h-4 w-4" />
            {t("home.welcomeEditProfile")}
          </Link>
        </Button>
        <Button asChild variant="ghost" className="min-h-11 sm:min-h-9">
          <Link to={`/player/${slug}`}>
            <User className="mr-1.5 h-4 w-4" />
            {t("home.welcomeMyProfile")}
          </Link>
        </Button>
        <Button asChild variant="ghost" className="min-h-11 sm:min-h-9">
          <Link to="/favorites">
            <Heart className="mr-1.5 h-4 w-4" />
            {t("home.welcomeFavorites")}
          </Link>
        </Button>
      </div>
    </section>
  );
}
