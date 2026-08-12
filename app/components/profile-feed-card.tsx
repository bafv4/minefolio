import { Link } from "react-router";
import { Badge } from "@/components/ui/badge";
import { MinecraftAvatar } from "@/components/minecraft-avatar";
import { User, Clock3 } from "lucide-react";
import { formatRelativeDate } from "@/lib/relative-time";
import { useT, useLocale } from "@/hooks/use-locale";
import { getLocalizedDisplayName } from "@/lib/slug";
import { platformLabel } from "@/lib/platform-label";

export interface ProfileFeedCardPlayer {
  mcid: string | null;
  uuid: string | null;
  slug: string;
  displayName: string | null;
  displayNameAlphabet?: string | null;
  pronouns: string | null;
  role: "runner" | "viewer" | null;
  mainEdition: "java" | "bedrock" | null;
  mainPlatform: "pc_windows" | "pc_mac" | "pc_linux" | "switch" | "mobile" | "other" | null;
  customSkinUrl?: string | null;
  updatedAt: Date;
  shortBio: string | null;
}

export function ProfileFeedCard({ player }: { player: ProfileFeedCardPlayer }) {
  const t = useT();
  const locale = useLocale();
  const displayName = getLocalizedDisplayName(player, locale);
  const userRoleLabel =
    player.role === "runner"
      ? t("common.runner")
      : player.role === "viewer"
        ? t("common.viewer")
        : null;
  const editionLabel = player.mainEdition === "java" ? "Java" : player.mainEdition === "bedrock" ? "Bedrock" : null;
  const platformText = platformLabel(t, player.mainPlatform, "short");
  return (
    <Link
      to={`/player/${player.slug}`}
      prefetch="intent"
      className="group flex flex-col rounded-xl border border-border/70 bg-background/80 p-4 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-sm"
    >
      {/* flex-1 でヘッダー側が余白を吸収し、フッターの水平線位置を兄弟カード間で下端に揃える */}
      <div className="flex flex-1 items-start gap-3">
        <div className="h-12 w-12 shrink-0 rounded-xl">
          {player.uuid ? (
            <MinecraftAvatar uuid={player.uuid} skinUrl={player.customSkinUrl} size={48} />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-muted text-sm font-semibold text-muted-foreground">
              {displayName[0]?.toUpperCase() ?? "?"}
            </div>
          )}
        </div>
        {/* min-h-12 keeps header block height == avatar height, so rows stay aligned across cards
            even when optional fields (@mcid / bio) are missing */}
        <div className="flex min-h-12 min-w-0 flex-1 flex-col justify-center">
          <p className="truncate font-semibold">{displayName}</p>
          {player.mcid && (
            <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
              <p className="min-w-0 truncate">@{player.mcid}</p>
              {player.pronouns && (
                <span className="shrink-0 rounded-full border border-border/70 bg-background px-2 py-0.5 text-[11px] leading-none">
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
      <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5 border-t border-border/60 pt-3 text-xs text-muted-foreground">
        {/* min-h-5: バッジ（約20px）の有無でフッター高が変わり、罫線位置が兄弟カードとずれるのを防ぐ */}
        <div className="flex min-h-5 min-w-0 flex-wrap items-center gap-1.5">
          {userRoleLabel && (
            <Badge variant="secondary" className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px]">
              <User className="h-3 w-3 shrink-0" />
              {userRoleLabel}
            </Badge>
          )}
          {editionLabel && (
            <Badge variant="outline" className="shrink-0 rounded-full px-2 py-0.5 text-[11px]">
              {editionLabel}
            </Badge>
          )}
          {platformText && (
            <Badge variant="outline" className="shrink-0 rounded-full px-2 py-0.5 text-[11px]">
              {platformText}
            </Badge>
          )}
        </div>
        <span className="ml-auto inline-flex shrink-0 items-center gap-1">
          <Clock3 className="h-3 w-3" />
          {formatRelativeDate(t, player.updatedAt)}
        </span>
      </div>
    </Link>
  );
}

/** Compact list row for players */
export function ProfileFeedListItem({ player }: { player: ProfileFeedCardPlayer }) {
  const t = useT();
  const locale = useLocale();
  const displayName = getLocalizedDisplayName(player, locale);
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
          <MinecraftAvatar uuid={player.uuid} skinUrl={player.customSkinUrl} size={36} />
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
          {formatRelativeDate(t, player.updatedAt)}
        </span>
      </div>
    </Link>
  );
}

