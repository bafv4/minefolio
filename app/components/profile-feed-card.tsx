import { Link } from "react-router";
import { Badge } from "@/components/ui/badge";
import { MinecraftAvatar } from "@/components/minecraft-avatar";
import { User, Clock3, LayoutGrid, List } from "lucide-react";
import { Button } from "@/components/ui/button";
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
                <span className="rounded-full border border-border/70 bg-background px-2 py-0.5 text-[11px] leading-none">
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
              <User className="h-3 w-3 shrink-0" />
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
          <Clock3 className="h-3 w-3" />
          {formatRelativeDate(player.updatedAt)}
        </span>
      </div>
    </Link>
  );
}

/** Compact list row for players */
export function ProfileFeedListItem({ player }: { player: ProfileFeedCardPlayer }) {
  const displayName = player.displayName ?? player.mcid ?? player.slug;
  const userRoleLabel =
    player.role === "runner"
      ? t("common.runner")
      : player.role === "viewer"
        ? t("common.viewer")
        : null;
  const editionLabel = player.mainEdition === "java" ? "Java" : player.mainEdition === "bedrock" ? "Bedrock" : null;

  return (
    <Link
      to={`/player/${player.slug}`}
      prefetch="intent"
      className="flex items-center gap-3 py-3 px-1 -mx-1 rounded hover:bg-muted/50 transition-colors group"
    >
      <div className="h-9 w-9 shrink-0 rounded-lg overflow-hidden">
        {player.uuid ? (
          <MinecraftAvatar uuid={player.uuid} size={36} />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-muted text-xs font-semibold text-muted-foreground">
            {displayName[0]?.toUpperCase() ?? "?"}
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium group-hover:text-primary transition-colors">
            {displayName}
          </span>
          {player.mcid && (
            <span className="text-xs text-muted-foreground shrink-0">@{player.mcid}</span>
          )}
        </div>
        {player.shortBio && (
          <p className="text-xs text-muted-foreground line-clamp-1">{player.shortBio}</p>
        )}
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {userRoleLabel && (
          <Badge variant="secondary" className="rounded-full px-2 py-0.5 text-[11px]">
            {userRoleLabel}
          </Badge>
        )}
        {editionLabel && (
          <Badge variant="outline" className="rounded-full px-2 py-0.5 text-[11px]">
            {editionLabel}
          </Badge>
        )}
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground ml-1">
          <Clock3 className="h-3 w-3" />
          {formatRelativeDate(player.updatedAt)}
        </span>
      </div>
    </Link>
  );
}

export function PlayerViewToggle({
  viewMode,
  onChange,
}: {
  viewMode: "card" | "list";
  onChange: (mode: "card" | "list") => void;
}) {
  return (
    <div className="flex border rounded-md">
      <Button
        variant={viewMode === "card" ? "default" : "ghost"}
        size="icon"
        className="h-8 w-8 rounded-r-none"
        onClick={() => onChange("card")}
      >
        <LayoutGrid className="h-4 w-4" />
      </Button>
      <Button
        variant={viewMode === "list" ? "default" : "ghost"}
        size="icon"
        className="h-8 w-8 rounded-l-none"
        onClick={() => onChange("list")}
      >
        <List className="h-4 w-4" />
      </Button>
    </div>
  );
}
