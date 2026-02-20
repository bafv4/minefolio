import { Link } from "react-router";
import { Badge } from "@/components/ui/badge";
import { MinecraftAvatar } from "@/components/minecraft-avatar";
import { User, Clock3 } from "lucide-react";
import { t } from "@/lib/messages";

export interface ProfileFeedCardPlayer {
  mcid: string | null;
  uuid: string | null;
  slug: string;
  displayName: string | null;
  pronouns: string | null;
  role: "runner" | "viewer" | null;
  mainEdition: "java" | "bedrock" | null;
  mainPlatform: "pc_windows" | "pc_mac" | "pc_linux" | "switch" | "mobile" | "other" | null;
  inputMethodBadge: "keyboard_mouse" | "controller" | "touch" | null;
  updatedAt: Date;
  shortBio: string | null;
}

function formatRelativeDate(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - new Date(date).getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "今日";
  if (diffDays === 1) return "昨日";
  if (diffDays < 7) return `${diffDays}日前`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}週間前`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}ヶ月前`;
  return `${Math.floor(diffDays / 365)}年前`;
}

export function ProfileFeedCard({ player }: { player: ProfileFeedCardPlayer }) {
  const displayName = player.displayName ?? player.mcid ?? player.slug;
  const userRoleLabel =
    player.role === "runner"
      ? t("common.runner")
      : player.role === "viewer"
        ? t("common.viewer")
        : null;
  const editionLabel = player.mainEdition === "java" ? "Java" : player.mainEdition === "bedrock" ? "Bedrock" : null;
  const platformLabel =
    player.mainPlatform === "pc_windows" ? "Windows" :
      player.mainPlatform === "pc_mac" ? "Mac" :
        player.mainPlatform === "pc_linux" ? "Linux" :
          player.mainPlatform === "switch" ? "Switch" :
            player.mainPlatform === "mobile" ? "Mobile" :
              player.mainPlatform === "other" ? "Other" : null;
  const inputMethodLabel =
    player.inputMethodBadge === "keyboard_mouse" ? "KBM" :
      player.inputMethodBadge === "controller" ? "Controller" :
        player.inputMethodBadge === "touch" ? "Touch" : null;

  return (
    <Link
      to={`/player/${player.slug}`}
      prefetch="intent"
      className="group rounded-2xl border border-border/70 bg-background/80 p-4 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-sm"
    >
      <div className="flex items-start gap-3">
        <div className="h-12 w-12 shrink-0 rounded-xl">
          {player.uuid ? (
            <MinecraftAvatar uuid={player.uuid} size={48} />
          ) : (
            <div className="flex h-full items-center justify-center text-sm font-semibold text-muted-foreground">
              {displayName[0]?.toUpperCase() ?? "?"}
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{displayName}</p>
          {player.mcid && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <p>@{player.mcid}</p>
              {player.pronouns && (
                <span className="rounded-full border border-border/70 bg-background px-1.5 py-0.5 text-[10px] leading-none">
                  {player.pronouns}
                </span>
              )}
            </div>
          )}
          <p className="mt-1 min-h-4 line-clamp-1 text-xs text-muted-foreground">
            {player.shortBio ?? "\u00A0"}
          </p>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-border/60 pt-3 text-xs text-muted-foreground">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          {userRoleLabel && (
            <Badge variant="secondary" className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]">
              <User className="h-3.5 w-3.5 shrink-0" />
              {userRoleLabel}
            </Badge>
          )}
          {editionLabel && (
            <Badge variant="outline" className="rounded-full px-2 py-0.5 text-[11px]">
              {editionLabel}
            </Badge>
          )}
          {platformLabel && (
            <Badge variant="outline" className="rounded-full px-2 py-0.5 text-[11px]">
              {platformLabel}
            </Badge>
          )}
        </div>
        <span className="inline-flex items-center gap-1 shrink-0">
          <Clock3 className="h-3.5 w-3.5" />
          {formatRelativeDate(player.updatedAt)}
        </span>
      </div>
    </Link>
  );
}
