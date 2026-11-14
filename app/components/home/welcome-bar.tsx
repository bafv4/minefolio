import { useState } from "react";
import { Link } from "react-router";
import type { HomeSectionId } from "@/lib/home-sections";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { MinecraftAvatar } from "@/components/minecraft-avatar";
import { HomeSettingsDialog } from "@/components/home/home-settings-dialog";
import { useT } from "@/hooks/use-locale";
import { Heart, Pencil, Settings2, User } from "lucide-react";

/** ログイン済みの「おかえりなさい」バー（1行）。宣伝の見出し・説明や自分のペース・PB は出さない。作成24時間以内は「ようこそ」 */
export function WelcomeBar({
  name,
  slug,
  uuid,
  skinUrl,
  isNewAccount = false,
  sectionOrder,
}: {
  name: string;
  slug: string;
  uuid: string | null;
  skinUrl: string | null;
  /** アカウント作成から24時間以内（初回訪問に「おかえりなさい」と出さない） */
  isNewAccount?: boolean;
  /** 設定モーダルの編集初期値（現在の欄の並び） */
  sectionOrder: HomeSectionId[];
}) {
  const t = useT();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const greeting = t(isNewAccount ? "home.welcomeNew" : "home.welcomeBack", { name });
  return (
    <section
      aria-label={greeting}
      className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-2xl border border-border/70 bg-card/80 px-4 py-3 shadow-sm sm:px-5"
    >
      <Link to={`/player/${slug}`} className="shrink-0" aria-hidden="true" tabIndex={-1}>
        <MinecraftAvatar uuid={uuid} skinUrl={skinUrl} size={44} className="rounded-xl" />
      </Link>
      <div className="min-w-0 flex-1 basis-48">
        <p className="truncate text-base font-semibold">{greeting}</p>
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
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-11 sm:size-9"
              aria-label={t("home.settingsTitle")}
              onClick={() => setSettingsOpen(true)}
            >
              <Settings2 />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("home.settingsTitle")}</TooltipContent>
        </Tooltip>
      </div>
      <HomeSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} order={sectionOrder} />
    </section>
  );
}
