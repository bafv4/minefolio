import { useState } from "react";
import { Link } from "react-router";
import { Keyboard, Mouse, Users, TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getKeyLabel } from "@/lib/keybindings";
import { cn } from "@/lib/utils";
import { MinecraftAvatar } from "@/components/minecraft-avatar";
import { t } from "@/lib/messages";
import type {
  KeybindingStats,
  F3RemapStats,
  KeybindingsStatsData,
  PlayerInfo,
} from "@/lib/keybindings-stats.server";

interface StatsViewProps {
  data: KeybindingsStatsData;
}

export function StatsView({ data }: StatsViewProps) {
  const {
    keybindingStats,
    f3RemapStats,
    dpiStats,
    cm180Stats,
    sensitivityStats,
    rawInputStats,
    totalPlayers,
    playersWithKeybindings,
    playersWithMouseSettings,
  } = data;

  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogTitle, setDialogTitle] = useState("");
  const [dialogPlayers, setDialogPlayers] = useState<PlayerInfo[]>([]);

  const openPlayersDialog = (title: string, players: PlayerInfo[]) => {
    setDialogTitle(title);
    setDialogPlayers(players);
    setDialogOpen(true);
  };

  return (
    <div className="flex-1 flex flex-col space-y-6">
      {/* 概要 */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t("keybindingsStats.registeredCount")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold flex items-center gap-2">
              <Users className="h-5 w-5 text-muted-foreground" />
              {totalPlayers}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t("keybindingsStats.keybindingsRegistered")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold flex items-center gap-2">
              <Keyboard className="h-5 w-5 text-muted-foreground" />
              {playersWithKeybindings}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {totalPlayers > 0
                ? `${((playersWithKeybindings / totalPlayers) * 100).toFixed(1)}%`
                : "0%"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t("keybindingsStats.mouseRegistered")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold flex items-center gap-2">
              <Mouse className="h-5 w-5 text-muted-foreground" />
              {playersWithMouseSettings}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {totalPlayers > 0
                ? `${((playersWithMouseSettings / totalPlayers) * 100).toFixed(1)}%`
                : "0%"}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* タブ */}
      <Tabs defaultValue="keyboard" className="w-full">
        <TabsList>
          <TabsTrigger value="keyboard" className="gap-1.5">
            <Keyboard className="h-4 w-4" />
            {t("keybindingsStats.keyboardTab")}
          </TabsTrigger>
          <TabsTrigger value="mouse" className="gap-1.5">
            <Mouse className="h-4 w-4" />
            {t("keybindingsStats.mouseTab")}
          </TabsTrigger>
        </TabsList>

        {/* キーボード統計 */}
        <TabsContent value="keyboard" className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {keybindingStats.map((stat) => (
              <KeybindingStatCard
                key={stat.action}
                stat={stat}
                onPlayerClick={openPlayersDialog}
              />
            ))}
            <F3RemapStatCard stat={f3RemapStats} onPlayerClick={openPlayersDialog} />
          </div>
        </TabsContent>

        {/* マウス統計 */}
        <TabsContent value="mouse" className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5" />
                  {t("keybindingsStats.dpiDistribution")}
                </CardTitle>
                <CardDescription>
                  {t("keybindingsStats.dataCount", { count: dpiStats.totalCount })}
                  {dpiStats.average != null &&
                    ` / ${t("keybindingsStats.average", { value: dpiStats.average })}`}
                  {dpiStats.median != null &&
                    ` / ${t("keybindingsStats.median", { value: dpiStats.median })}`}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {dpiStats.ranges.map((range) => (
                    <button
                      key={range.label}
                      type="button"
                      className="w-full text-left space-y-1 hover:bg-muted/50 rounded-md p-1 -m-1 transition-colors cursor-pointer disabled:cursor-default disabled:hover:bg-transparent"
                      disabled={range.count === 0}
                      onClick={() =>
                        openPlayersDialog(
                          t("keybindingsStats.dialogDpi", { label: range.label }),
                          range.players,
                        )
                      }
                    >
                      <div className="flex justify-between text-sm">
                        <span>{range.label}</span>
                        <span className="text-muted-foreground">
                          {t("keybindingsStats.peoplePercent", {
                            count: range.count,
                            percent: range.percentage.toFixed(1),
                          })}
                        </span>
                      </div>
                      <Progress value={range.percentage} className="h-2" />
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5" />
                  {t("keybindingsStats.turnDistanceDistribution")}
                </CardTitle>
                <CardDescription>
                  {t("keybindingsStats.dataCount", { count: cm180Stats.totalCount })}
                  {cm180Stats.average != null &&
                    ` / ${t("keybindingsStats.average", { value: `${cm180Stats.average.toFixed(1)}cm` })}`}
                  {cm180Stats.median != null &&
                    ` / ${t("keybindingsStats.median", { value: `${cm180Stats.median.toFixed(1)}cm` })}`}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {cm180Stats.ranges.map((range) => (
                    <button
                      key={range.label}
                      type="button"
                      className="w-full text-left space-y-1 hover:bg-muted/50 rounded-md p-1 -m-1 transition-colors cursor-pointer disabled:cursor-default disabled:hover:bg-transparent"
                      disabled={range.count === 0}
                      onClick={() =>
                        openPlayersDialog(
                          t("keybindingsStats.dialogTurnDistance", { label: range.label }),
                          range.players,
                        )
                      }
                    >
                      <div className="flex justify-between text-sm">
                        <span>{range.label}</span>
                        <span className="text-muted-foreground">
                          {t("keybindingsStats.peoplePercent", {
                            count: range.count,
                            percent: range.percentage.toFixed(1),
                          })}
                        </span>
                      </div>
                      <Progress value={range.percentage} className="h-2" />
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5" />
                  {t("keybindingsStats.inGameSensitivityDistribution")}
                </CardTitle>
                <CardDescription>
                  {t("keybindingsStats.dataCount", { count: sensitivityStats.totalCount })}
                  {sensitivityStats.average != null &&
                    ` / ${t("keybindingsStats.average", { value: `${sensitivityStats.average}%` })}`}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {sensitivityStats.ranges.map((range) => (
                    <button
                      key={range.label}
                      type="button"
                      className="w-full text-left space-y-1 hover:bg-muted/50 rounded-md p-1 -m-1 transition-colors cursor-pointer disabled:cursor-default disabled:hover:bg-transparent"
                      disabled={range.count === 0}
                      onClick={() =>
                        openPlayersDialog(
                          t("keybindingsStats.dialogSensitivity", { label: range.label }),
                          range.players,
                        )
                      }
                    >
                      <div className="flex justify-between text-sm">
                        <span>{range.label}</span>
                        <span className="text-muted-foreground">
                          {t("keybindingsStats.peoplePercent", {
                            count: range.count,
                            percent: range.percentage.toFixed(1),
                          })}
                        </span>
                      </div>
                      <Progress value={range.percentage} className="h-2" />
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5" />
                  {t("keybindingsStats.rawInputSetting")}
                </CardTitle>
                <CardDescription>
                  {t("keybindingsStats.dataCount", { count: rawInputStats.totalCount })}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <button
                    type="button"
                    className="w-full text-left space-y-1 hover:bg-muted/50 rounded-md p-1 -m-1 transition-colors cursor-pointer disabled:cursor-default disabled:hover:bg-transparent"
                    disabled={rawInputStats.onCount === 0}
                    onClick={() =>
                      openPlayersDialog("Raw Input ON", rawInputStats.onPlayers)
                    }
                  >
                    <div className="flex justify-between text-sm">
                      <span className="flex items-center gap-2">
                        <Badge>ON</Badge>
                      </span>
                      <span className="text-muted-foreground">
                        {rawInputStats.onCount}
                        {t("common.peopleUnit")} (
                        {rawInputStats.totalCount > 0
                          ? (
                              (rawInputStats.onCount / rawInputStats.totalCount) *
                              100
                            ).toFixed(1)
                          : 0}
                        %)
                      </span>
                    </div>
                    <Progress
                      value={
                        rawInputStats.totalCount > 0
                          ? (rawInputStats.onCount / rawInputStats.totalCount) * 100
                          : 0
                      }
                      className="h-2"
                    />
                  </button>
                  <button
                    type="button"
                    className="w-full text-left space-y-1 hover:bg-muted/50 rounded-md p-1 -m-1 transition-colors cursor-pointer disabled:cursor-default disabled:hover:bg-transparent"
                    disabled={rawInputStats.offCount === 0}
                    onClick={() =>
                      openPlayersDialog("Raw Input OFF", rawInputStats.offPlayers)
                    }
                  >
                    <div className="flex justify-between text-sm">
                      <span className="flex items-center gap-2">
                        <Badge variant="secondary">OFF</Badge>
                      </span>
                      <span className="text-muted-foreground">
                        {rawInputStats.offCount}
                        {t("common.peopleUnit")} (
                        {rawInputStats.totalCount > 0
                          ? (
                              (rawInputStats.offCount / rawInputStats.totalCount) *
                              100
                            ).toFixed(1)
                          : 0}
                        %)
                      </span>
                    </div>
                    <Progress
                      value={
                        rawInputStats.totalCount > 0
                          ? (rawInputStats.offCount / rawInputStats.totalCount) * 100
                          : 0
                      }
                      className="h-2"
                    />
                  </button>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      {/* 走者一覧ダイアログ */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>{dialogTitle}</DialogTitle>
          </DialogHeader>
          <div className="overflow-y-auto flex-1 -mx-6 px-6">
            <div className="space-y-2">
              {dialogPlayers.map((player) => (
                <Link
                  key={player.slug}
                  to={`/player/${player.slug}`}
                  className="flex items-center gap-3 p-2 rounded-md hover:bg-muted transition-colors"
                  onClick={() => setDialogOpen(false)}
                >
                  <MinecraftAvatar
                    uuid={player.uuid}
                    skinUrl={player.customSkinUrl}
                    size={32}
                    className="rounded-sm shrink-0"
                  />
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate">
                      {player.displayName ?? player.mcid ?? player.slug}
                    </p>
                    {player.mcid && (
                      <p className="text-xs text-muted-foreground">@{player.mcid}</p>
                    )}
                  </div>
                </Link>
              ))}
              {dialogPlayers.length === 0 && (
                <p className="text-muted-foreground text-sm text-center py-4">
                  {t("keybindingsStats.emptyDialog")}
                </p>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function KeybindingStatCard({
  stat,
  onPlayerClick,
}: {
  stat: KeybindingStats;
  onPlayerClick: (title: string, players: PlayerInfo[]) => void;
}) {
  if (stat.totalCount === 0) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{stat.label}</CardTitle>
          <CardDescription>{t("keybindingsStats.noData")}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{stat.label}</CardTitle>
        <CardDescription>
          {t("keybindingsStats.dataCount", { count: stat.totalCount })}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {stat.topKeys.map((key, index) => {
            const label = getKeyLabel(key.keyCode);
            return (
              <StatRow
                key={key.keyCode}
                index={index}
                label={label}
                isMouse={isMouseKey(key.keyCode)}
                count={key.count}
                percentage={key.percentage}
                onClick={() => onPlayerClick(`${stat.label}: ${label}`, key.players)}
              />
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function F3RemapStatCard({
  stat,
  onPlayerClick,
}: {
  stat: F3RemapStats;
  onPlayerClick: (title: string, players: PlayerInfo[]) => void;
}) {
  if (stat.totalCount === 0) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{t("keybindingsStats.f3InputKey")}</CardTitle>
          <CardDescription>{t("keybindingsStats.noData")}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{t("keybindingsStats.f3InputKey")}</CardTitle>
        <CardDescription>
          {t("keybindingsStats.dataCount", { count: stat.totalCount })}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {stat.topTargets.map((target, index) => {
            const label = getKeyLabel(target.targetKey);
            const dialogTitle =
              target.targetKey === "F3"
                ? t("keybindingsStats.f3DefaultInput")
                : t("keybindingsStats.f3WithKey", { key: label });
            return (
              <StatRow
                key={target.targetKey}
                index={index}
                label={label}
                isMouse={isMouseKey(target.targetKey)}
                count={target.count}
                percentage={target.percentage}
                onClick={() => onPlayerClick(dialogTitle, target.players)}
              />
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function isMouseKey(keyCode: string): boolean {
  return keyCode.startsWith("Mouse") || keyCode.toLowerCase().includes("mouse");
}

/** 統計カードの1行（順位 + キー名バッジ + 割合 + バー）。KeybindingStatCard/F3RemapStatCard 共通。 */
function StatRow({
  index,
  label,
  isMouse,
  count,
  percentage,
  onClick,
}: {
  index: number;
  label: string;
  isMouse: boolean;
  count: number;
  percentage: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="w-full text-left space-y-1 hover:bg-muted/50 rounded-md p-1 -m-1 transition-colors cursor-pointer"
      onClick={onClick}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 min-w-0">
          <span className="text-sm text-muted-foreground w-4 shrink-0">
            {index + 1}.
          </span>
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge
                variant="secondary"
                className={cn(
                  "font-mono text-xs px-2 min-w-0 max-w-full overflow-hidden",
                  isMouse &&
                    "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
                )}
              >
                <span className="truncate">{label}</span>
              </Badge>
            </TooltipTrigger>
            <TooltipContent>{label}</TooltipContent>
          </Tooltip>
        </span>
        <span className="text-xs text-muted-foreground shrink-0 tabular-nums">
          {t("keybindingsStats.peoplePercent", {
            count,
            percent: percentage.toFixed(0),
          })}
        </span>
      </div>
      <Progress value={percentage} className="h-1.5" />
    </button>
  );
}
