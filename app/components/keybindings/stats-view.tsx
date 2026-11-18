import { Fragment, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { parseAsStringEnum, useQueryState } from "nuqs";
import { Keyboard, Mouse, Users, TrendingUp, Table2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getActionLabel, getKeyLabel, isUnbound } from "@/lib/keybindings";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/empty-state";
import { MinecraftAvatar } from "@/components/minecraft-avatar";
import { MOUSE_KEY_BADGE_CLASS } from "@/components/keybindings/keybindings-cells";
import { useT, useLocale } from "@/hooks/use-locale";
import { getLocalizedDisplayName } from "@/lib/slug";
// 値は非 .server モジュールから取る（.server はクライアントバンドルに入れられない）
import { UNASSIGNED_INPUT_KEY } from "@/lib/keybindings-stats-shared";
import {
  buildKeybindingsTableHref,
  MAX_USERS_IN_LINK,
  tabForAction,
  type BindCondition,
  type Tab,
} from "@/lib/keybindings-search-params";
import type {
  BooleanSettingStats,
  KeyActionStats,
  KeybindingStats,
  F3RemapStats,
  KeybindingsStatsData,
  PlayerInfo,
  RangeStatWithPlayers,
} from "@/lib/keybindings-stats.server";

interface StatsViewProps {
  data: KeybindingsStatsData;
}

/**
 * 走者一覧ダイアログから開く表の行き先。tab はその操作が載っているタブ。
 * bind は、人数が多くて users を URL に載せられないときの代わり（その操作＝そのキーの走者を表で絞り込む）
 */
type TableTarget = { tab: Tab; bind?: BindCondition };
type PlayerClickHandler = (title: string, players: PlayerInfo[], target?: TableTarget) => void;

/** 割合の表記（整数の %、四捨五入）。見える文・行の名前・バーの値で共有する */
function formatPercent(percentage: number): string {
  return String(Math.round(percentage));
}

/** 統計ビュー内のサブタブ（URL の statsTab）。表の `tab` とは別名にする（ビュー切替リンクが tab を引き継ぐため） */
const STATS_TABS = ["keyboard", "keys", "mouse"] as const;
const statsTabParser = parseAsStringEnum([...STATS_TABS]).withDefault("keyboard");

export function StatsView({ data }: StatsViewProps) {
  const t = useT();
  const locale = useLocale();
  const {
    keybindingStats,
    f3RemapStats,
    dpiStats,
    cm180Stats,
    sensitivityStats,
    rawInputStats,
    mouseAccelerationStats,
    toggleSprintStats,
    keyActionStats,
    registeredPlayers,
    publicProfiles,
    playersWithKeybindings,
    playersWithMouseSettings,
  } = data;

  // 描画するのはデータのあるキーだけ
  const keysWithData = keyActionStats.filter((k) => k.totalCount > 0);

  const [statsTab, setStatsTab] = useQueryState("statsTab", statsTabParser);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogTitle, setDialogTitle] = useState("");
  const [dialogPlayers, setDialogPlayers] = useState<PlayerInfo[]>([]);
  const [dialogTarget, setDialogTarget] = useState<TableTarget | undefined>();

  const openPlayersDialog: PlayerClickHandler = (title, players, target) => {
    setDialogTitle(title);
    setDialogPlayers(players);
    setDialogTarget(target);
    setDialogOpen(true);
  };

  // この一覧の走者を表で見るリンク。users にスラッグを載せるのは MAX_USERS_IN_LINK 人まで
  // （それ以上は URL が長くなりすぎるため）。超えたときは操作＝キーの条件があればそれで代える
  const tableHref =
    dialogTarget && dialogPlayers.length > 0
      ? dialogPlayers.length <= MAX_USERS_IN_LINK
        ? buildKeybindingsTableHref({
            tab: dialogTarget.tab,
            users: dialogPlayers.map((p) => p.slug),
          })
        : dialogTarget.bind
          ? buildKeybindingsTableHref({ tab: dialogTarget.tab, bind: [dialogTarget.bind] })
          : null
      : null;

  return (
    <div className="flex-1 flex flex-col space-y-6">
      {/* 概要: 人数は母集団が分かる名前で出す（母集団はそれぞれ違う） */}
      <section aria-labelledby="kb-stats-overview-heading">
        <h2 id="kb-stats-overview-heading" className="sr-only">
          {t("keybindingsStats.overviewHeading")}
        </h2>
        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <OverviewTile
            icon={<Users className="h-4 w-4" />}
            label={t("keybindingsStats.registeredCount")}
            note={t("keybindingsStats.registeredCountNote")}
            value={registeredPlayers}
          />
          <OverviewTile
            icon={<Keyboard className="h-4 w-4" />}
            label={t("keybindingsStats.keybindingsRegistered")}
            note={t("keybindingsStats.keybindingsRegisteredNote")}
            value={playersWithKeybindings}
          />
          <OverviewTile
            icon={<Mouse className="h-4 w-4" />}
            label={t("keybindingsStats.mouseRegistered")}
            note={t("keybindingsStats.mouseRegisteredNote")}
            value={playersWithMouseSettings}
          />
          <OverviewTile
            icon={<Users className="h-4 w-4" />}
            label={t("keybindingsStats.publicProfiles")}
            note={t("keybindingsStats.publicProfilesNote")}
            value={publicProfiles}
          />
        </dl>
        <p className="mt-2 text-xs text-muted-foreground">{t("keybindingsStats.scopeNote")}</p>
      </section>

      {/* タブ（選択は URL に残す） */}
      <Tabs
        value={statsTab}
        onValueChange={(v) => void setStatsTab(v as (typeof STATS_TABS)[number])}
        className="w-full"
      >
        <TabsList>
          <TabsTrigger value="keyboard" className="gap-1.5">
            <Keyboard className="h-4 w-4" />
            {t("keybindingsStats.keyboardTab")}
          </TabsTrigger>
          <TabsTrigger value="keys" className="gap-1.5">
            <Keyboard className="h-4 w-4" />
            {t("keybindingsStats.keysTab")}
          </TabsTrigger>
          <TabsTrigger value="mouse" className="gap-1.5">
            <Mouse className="h-4 w-4" />
            {t("keybindingsStats.mouseTab")}
          </TabsTrigger>
        </TabsList>

        {/* キーボード統計 */}
        <TabsContent value="keyboard">
          <h2 className="sr-only">{t("keybindingsStats.keyboardTab")}</h2>
          <div className="grid gap-x-8 gap-y-8 md:grid-cols-2 lg:grid-cols-3">
            {keybindingStats.map((stat) => (
              <Fragment key={stat.action}>
                <KeybindingStatCard stat={stat} onPlayerClick={openPlayersDialog} />
                {/* ダッシュ切替は「ダッシュ」の欄のすぐ後ろ */}
                {stat.action === "sprint" && (
                  <BooleanDistribution
                    id="kb-stat-togglesprint"
                    title={t("keybindingsStats.toggleSprint")}
                    name={t("keybindingsStats.toggleSprint")}
                    stats={toggleSprintStats}
                    onPlayerClick={openPlayersDialog}
                  />
                )}
              </Fragment>
            ))}
            <F3RemapStatCard stat={f3RemapStats} onPlayerClick={openPlayersDialog} />
          </div>
        </TabsContent>

        {/* キー → 操作の統計 */}
        <TabsContent value="keys">
          <h2 className="sr-only">{t("keybindingsStats.keysTab")}</h2>
          {keysWithData.length === 0 ? (
            <EmptyState
              size="compact"
              icon={<Keyboard className="h-5 w-5" />}
              title={t("keybindingsStats.noData")}
              description={t("keybindingsStats.keysEmptyDescription")}
            />
          ) : (
            <>
              <p className="mb-4 text-sm text-muted-foreground">
                {t("keybindingsStats.keyActionNote")}
              </p>
              <div className="grid gap-x-8 gap-y-8 md:grid-cols-2 lg:grid-cols-3">
                {keysWithData.map((stat) => (
                  <KeyActionStatCard
                    key={stat.keyCode}
                    stat={stat}
                    onPlayerClick={openPlayersDialog}
                  />
                ))}
              </div>
            </>
          )}
        </TabsContent>

        {/* マウス統計 */}
        <TabsContent value="mouse">
          <h2 className="sr-only">{t("keybindingsStats.mouseTab")}</h2>
          <div className="grid gap-x-8 gap-y-8 lg:grid-cols-2">
            <RangeDistribution
              id="kb-stat-dpi"
              title={t("keybindingsStats.dpiDistribution")}
              description={
                t("keybindingsStats.dataCount", { count: dpiStats.totalCount }) +
                (dpiStats.average != null
                  ? ` / ${t("keybindingsStats.average", { value: dpiStats.average })}`
                  : "") +
                (dpiStats.median != null
                  ? ` / ${t("keybindingsStats.median", { value: dpiStats.median })}`
                  : "")
              }
              // DPI の区分は幅がそろっていない。棒の長さは人数の割合であることを添える
              note={t("keybindingsStats.barNote")}
              ranges={dpiStats.ranges}
              dialogTitle={(label) => t("keybindingsStats.dialogDpi", { label })}
              onPlayerClick={openPlayersDialog}
            />
            <RangeDistribution
              id="kb-stat-cm180"
              title={t("keybindingsStats.turnDistanceDistribution")}
              description={
                t("keybindingsStats.dataCount", { count: cm180Stats.totalCount }) +
                (cm180Stats.average != null
                  ? ` / ${t("keybindingsStats.average", { value: `${cm180Stats.average.toFixed(1)}cm` })}`
                  : "") +
                (cm180Stats.median != null
                  ? ` / ${t("keybindingsStats.median", { value: `${cm180Stats.median.toFixed(1)}cm` })}`
                  : "")
              }
              ranges={cm180Stats.ranges}
              dialogTitle={(label) => t("keybindingsStats.dialogTurnDistance", { label })}
              onPlayerClick={openPlayersDialog}
            />
            <RangeDistribution
              id="kb-stat-sensitivity"
              title={t("keybindingsStats.inGameSensitivityDistribution")}
              description={
                t("keybindingsStats.dataCount", { count: sensitivityStats.totalCount }) +
                (sensitivityStats.average != null
                  ? ` / ${t("keybindingsStats.average", { value: `${sensitivityStats.average}%` })}`
                  : "")
              }
              // 有効範囲外で母数から外した人数（いる場合だけ注記する）
              note={
                sensitivityStats.excludedCount > 0
                  ? t("keybindingsStats.excludedOutOfRange", {
                      count: sensitivityStats.excludedCount,
                    })
                  : undefined
              }
              ranges={sensitivityStats.ranges}
              dialogTitle={(label) => t("keybindingsStats.dialogSensitivity", { label })}
              onPlayerClick={openPlayersDialog}
            />

            <BooleanDistribution
              id="kb-stat-rawinput"
              title={t("keybindingsStats.rawInputSetting")}
              name="Raw Input"
              stats={rawInputStats}
              target={{ tab: "mouse" }}
              onPlayerClick={openPlayersDialog}
            />
            <BooleanDistribution
              id="kb-stat-mouseacceleration"
              title={t("keybindingsStats.mouseAcceleration")}
              name={t("keybindingsStats.mouseAcceleration")}
              stats={mouseAccelerationStats}
              target={{ tab: "mouse" }}
              onPlayerClick={openPlayersDialog}
            />
          </div>
        </TabsContent>
      </Tabs>

      {/* 走者一覧ダイアログ */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>{dialogTitle}</DialogTitle>
            <DialogDescription>
              {t("keybindingsStats.dialogDescription", { count: dialogPlayers.length })}
            </DialogDescription>
          </DialogHeader>
          {tableHref && (
            <Button asChild variant="outline" size="sm" className="self-start max-md:min-h-11">
              <Link to={tableHref} onClick={() => setDialogOpen(false)}>
                <Table2 aria-hidden />
                {t("keybindingsStats.openInTable", { count: dialogPlayers.length })}
              </Link>
            </Button>
          )}
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
                    alt=""
                    className="rounded-lg shrink-0"
                  />
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate">
                      {getLocalizedDisplayName(player, locale)}
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

/** 概要の 1 件（箱にしないタイル。人数と、その母集団の説明） */
function OverviewTile({
  icon,
  label,
  note,
  value,
}: {
  icon: ReactNode;
  label: string;
  note: string;
  value: number;
}) {
  return (
    <div className="rounded-xl bg-secondary/50 p-3">
      <dt className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
        {icon}
        {label}
      </dt>
      <dd className="mt-1 text-2xl font-bold tabular-nums">{value}</dd>
      <p className="mt-1 text-xs text-muted-foreground">{note}</p>
    </div>
  );
}

/** 統計 1 件の欄（箱にしない。見出し h3 + 補足 + 中身）。親のタブ見出し（sr-only の h2）の下に置く */
function StatBlock({
  id,
  icon,
  title,
  description,
  note,
  children,
}: {
  id: string;
  icon?: ReactNode;
  title: string;
  description?: string;
  note?: string;
  children?: ReactNode;
}) {
  return (
    <section aria-labelledby={`${id}-heading`} className="min-w-0 space-y-3">
      <div className="space-y-0.5">
        <h3 id={`${id}-heading`} className="flex items-center gap-2 text-base font-semibold">
          {icon}
          {title}
        </h3>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
        {note && <p className="text-xs text-muted-foreground">{note}</p>}
      </div>
      {children}
    </section>
  );
}

/** 区分ごとの人数分布（DPI・振り向き・感度で共通） */
function RangeDistribution({
  id,
  title,
  description,
  note,
  ranges,
  dialogTitle,
  onPlayerClick,
}: {
  id: string;
  title: string;
  description: string;
  note?: string;
  ranges: RangeStatWithPlayers[];
  dialogTitle: (label: string) => string;
  onPlayerClick: PlayerClickHandler;
}) {
  const t = useT();
  return (
    <StatBlock
      id={id}
      icon={<TrendingUp className="h-5 w-5 text-primary" />}
      title={title}
      description={description}
      note={note}
    >
      <div className="space-y-3">
        {ranges.map((range) => (
          <button
            key={range.label}
            type="button"
            className="w-full text-left space-y-1 hover:bg-muted/50 rounded-md p-1 -m-1 max-md:min-h-11 transition-colors cursor-pointer disabled:cursor-default disabled:hover:bg-transparent"
            disabled={range.count === 0}
            aria-label={t("keybindingsStats.rangeRowAria", {
              label: range.label,
              count: range.count,
              percent: formatPercent(range.percentage),
            })}
            onClick={() =>
              onPlayerClick(dialogTitle(range.label), range.players, { tab: "mouse" })
            }
          >
            <div className="flex justify-between text-sm">
              <span>{range.label}</span>
              <span className="text-muted-foreground">
                {t("keybindingsStats.peoplePercent", {
                  count: range.count,
                  percent: formatPercent(range.percentage),
                })}
              </span>
            </div>
            <Progress
              value={range.percentage}
              aria-label={range.label}
              aria-valuetext={t("keybindingsStats.peoplePercent", {
                count: range.count,
                percent: formatPercent(range.percentage),
              })}
              className="h-2"
            />
          </button>
        ))}
      </div>
    </StatBlock>
  );
}

/** ON / OFF の 2 値設定の分布（Raw Input・マウス加速・ダッシュ切替で共通）。name は読み上げとダイアログの題に使う設定名 */
function BooleanDistribution({
  id,
  title,
  name,
  stats,
  target,
  onPlayerClick,
}: {
  id: string;
  title: string;
  name: string;
  stats: BooleanSettingStats;
  /** 表の行き先。その設定が表の列に無いときは渡さない（リンクなし） */
  target?: TableTarget;
  onPlayerClick: PlayerClickHandler;
}) {
  const t = useT();
  return (
    <StatBlock
      id={id}
      icon={<TrendingUp className="h-5 w-5 text-primary" />}
      title={title}
      description={t("keybindingsStats.dataCount", { count: stats.totalCount })}
    >
      <div className="space-y-4">
        {(
          [
            { on: true, count: stats.onCount, players: stats.onPlayers },
            { on: false, count: stats.offCount, players: stats.offPlayers },
          ] as const
        ).map(({ on, count, players }) => {
          const percentage = stats.totalCount > 0 ? (count / stats.totalCount) * 100 : 0;
          const label = `${name} ${on ? "ON" : "OFF"}`;
          return (
            <button
              key={on ? "on" : "off"}
              type="button"
              className="w-full text-left space-y-1 hover:bg-muted/50 rounded-md p-1 -m-1 max-md:min-h-11 transition-colors cursor-pointer disabled:cursor-default disabled:hover:bg-transparent"
              disabled={count === 0}
              aria-label={t("keybindingsStats.rangeRowAria", {
                label,
                count,
                percent: formatPercent(percentage),
              })}
              onClick={() => onPlayerClick(label, players, target)}
            >
              <div className="flex justify-between text-sm">
                <span className="flex items-center gap-2">
                  {/* ON / OFF はどちらも同じ見た目（設定値に優劣の色を付けない） */}
                  <Badge variant="secondary">{on ? "ON" : "OFF"}</Badge>
                </span>
                <span className="text-muted-foreground">
                  {t("keybindingsStats.peoplePercent", {
                    count,
                    percent: formatPercent(percentage),
                  })}
                </span>
              </div>
              <Progress
                value={percentage}
                aria-label={label}
                aria-valuetext={t("keybindingsStats.peoplePercent", {
                  count,
                  percent: formatPercent(percentage),
                })}
                className="h-2"
              />
            </button>
          );
        })}
      </div>
    </StatBlock>
  );
}

/** キー → 操作の統計 1 キーぶん（そのキーに割り当てられている操作の上位） */
function KeyActionStatCard({
  stat,
  onPlayerClick,
}: {
  stat: KeyActionStats;
  onPlayerClick: PlayerClickHandler;
}) {
  const t = useT();
  const title = getKeyLabel(t, stat.keyCode);
  return (
    <StatBlock
      id={`kb-stat-key-${stat.keyCode}`}
      title={title}
      description={t("keybindingsStats.dataCount", { count: stat.totalCount })}
    >
      <div className="space-y-2">
        {stat.topActions.map((entry, index) => {
          const label = getActionLabel(t, entry.action);
          return (
            <StatRow
              key={entry.action}
              index={index}
              label={label}
              isMouse={false}
              count={entry.count}
              percentage={entry.percentage}
              onClick={() =>
                onPlayerClick(`${title}: ${label}`, entry.players, keyTarget(entry.action, stat.keyCode))
              }
            />
          );
        })}
      </div>
    </StatBlock>
  );
}

/** キーの統計 1 行から、その操作/** キーの統計 1 行から、その操作が載っている表のタブと、操作＝キーの条件を作る */
function keyTarget(action: string, keyCode: string): TableTarget | undefined {
  const tab = tabForAction(action);
  if (!tab) return undefined;
  // 未割り当ての走者群は「そのキー」では絞り込めない（bind は割り当てのあるキーだけを比べる）
  return isUnbound(keyCode) ? { tab } : { tab, bind: { action, keyCode } };
}

function KeybindingStatCard({
  stat,
  onPlayerClick,
}: {
  stat: KeybindingStats;
  onPlayerClick: PlayerClickHandler;
}) {
  const t = useT();
  const title = t(stat.labelKey);
  if (stat.totalCount === 0) {
    return (
      <StatBlock
        id={`kb-stat-${stat.action}`}
        title={title}
        description={t("keybindingsStats.noData")}
      />
    );
  }

  return (
    <StatBlock
      id={`kb-stat-${stat.action}`}
      title={title}
      description={t("keybindingsStats.dataCount", { count: stat.totalCount })}
    >
      <div className="space-y-2">
        {stat.topKeys.map((key, index) => {
          // 未割り当て（不使用）は「-」というキーではなく「未割り当て」として出す（F3 欄の未設定と同じ扱い）
          const label = isUnbound(key.keyCode)
            ? t("keybindingsStats.unassigned")
            : getKeyLabel(t, key.keyCode);
          return (
            <StatRow
              key={key.keyCode}
              index={index}
              label={label}
              isMouse={isMouseKey(key.keyCode)}
              count={key.count}
              percentage={key.percentage}
              onClick={() =>
                onPlayerClick(`${title}: ${label}`, key.players, keyTarget(stat.action, key.keyCode))
              }
            />
          );
        })}
      </div>
    </StatBlock>
  );
}

function F3RemapStatCard({
  stat,
  onPlayerClick,
}: {
  stat: F3RemapStats;
  onPlayerClick: PlayerClickHandler;
}) {
  const t = useT();
  if (stat.totalCount === 0) {
    return (
      <StatBlock
        id="kb-stat-f3"
        title={t("keybindingsStats.f3InputKey")}
        description={t("keybindingsStats.noData")}
      />
    );
  }

  return (
    <StatBlock
      id="kb-stat-f3"
      title={t("keybindingsStats.f3InputKey")}
      description={t("keybindingsStats.dataCount", { count: stat.totalCount })}
    >
      <div className="space-y-2">
        {stat.topTargets.map((target, index) => {
          // 集計側は未設定行を内部キーでまとめている。表示時に訳へ差し替える
          const label =
            target.targetKey === UNASSIGNED_INPUT_KEY
              ? t("keybindingsStats.unassigned")
              : getKeyLabel(t, target.targetKey);
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
              onClick={() =>
                onPlayerClick(
                  dialogTitle,
                  target.players,
                  // F3 のままの走者はリマップ行を持たず、表のリマップタブに出ないのでリンクしない
                  target.targetKey === "F3" ? undefined : { tab: "remaps" },
                )
              }
            />
          );
        })}
      </div>
    </StatBlock>
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
  const t = useT();
  return (
    <button
      type="button"
      className="w-full text-left space-y-1 hover:bg-muted/50 rounded-md p-1 -m-1 max-md:min-h-11 transition-colors cursor-pointer"
      // 子の「5.」「キー名」「2人 (1%)」がつながって「5.21人」と読まれないよう、まとまった文にする
      aria-label={t("keybindingsStats.rowAria", {
        rank: index + 1,
        label,
        count,
        percent: formatPercent(percentage),
      })}
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
                  isMouse && MOUSE_KEY_BADGE_CLASS,
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
            percent: formatPercent(percentage),
          })}
        </span>
      </div>
      <Progress
        value={percentage}
        aria-label={label}
        aria-valuetext={t("keybindingsStats.peoplePercent", {
          count,
          percent: formatPercent(percentage),
        })}
        className="h-1.5"
      />
    </button>
  );
}
