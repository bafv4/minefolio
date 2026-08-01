import { createTranslator } from "@/lib/messages";
import { localeFromMatches, resolveLocale } from "@/lib/locale";
import { useLoaderData } from "react-router";
import type { Route } from "./+types/stats";
import { createDb } from "@/lib/db";
import { getEnv } from "@/lib/env.server";
import { keybindings, playerConfigs, users } from "@/lib/schema";
import { isOutOfRangeSensitivity, isValidSensitivity, toSensitivityPercent } from "@/lib/mouse-settings";
import { SENSITIVITY_PERCENT_BINS } from "@/lib/keybindings-stats-shared";
import { sql, count } from "drizzle-orm";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { getKeyLabel, getActionLabel } from "@/lib/keybindings";
import { Keyboard, Mouse, ArrowRight, Users } from "lucide-react";
import { useT } from "@/hooks/use-locale";

export const meta: Route.MetaFunction = ({ matches, loaderData }) => {
  const t = createTranslator(localeFromMatches(matches));
  const title = t("stats.metaTitle");
  const description = t("stats.metaDescription");
  const appUrl = loaderData?.appUrl || "https://minefolio.app";
  const ogImage = `${appUrl}/icon.png`;
  return [
    { title },
    { name: "description", content: description },
    { property: "og:type", content: "website" },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:image", content: ogImage },
    { name: "twitter:card", content: "summary" },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
    { name: "twitter:image", content: ogImage },
  ];
};

// 統計対象のアクション（keybindings.tsxと同じ区分）
const STATS_ACTIONS = [
  // 移動
  "sprint",
  "sneak",
  // アクション
  "inventory",
  "swapHands",
  "drop",
  "pickBlock",
  // ホットバー
  "hotbar1",
  "hotbar2",
  "hotbar3",
  "hotbar4",
  "hotbar5",
  "hotbar6",
  "hotbar7",
  "hotbar8",
  "hotbar9",
];

// 統計対象のキー
const STATS_KEYS = [
  // アルファベットキー
  "KeyE",
  "KeyQ",
  "KeyR",
  "KeyF",
  "KeyC",
  "KeyX",
  "KeyZ",
  "KeyG",
  "KeyV",
  // 修飾キー
  "ShiftLeft",
  "ControlLeft",
  "Tab",
  "CapsLock",
  "Space",
  // マウスボタン
  "Mouse0",
  "Mouse1",
  "Mouse2",
  "Mouse3",
  "Mouse4",
  // 数字キー
  "Digit1",
  "Digit2",
  "Digit3",
  "Digit4",
  "Digit5",
  "Digit6",
  "Digit7",
  "Digit8",
  "Digit9",
];

// Minecraft形式のキーコードを統一形式に正規化
function normalizeKeyCodeForStats(keyCode: string): string {
  const lowerKeyCode = keyCode.toLowerCase();

  // key.keyboard.X 形式で単一文字キーの場合
  const keyboardMatch = lowerKeyCode.match(/^key\.keyboard\.([a-z])$/);
  if (keyboardMatch) {
    return `Key${keyboardMatch[1].toUpperCase()}`;
  }

  // key.keyboard.X 形式で数字キーの場合
  const digitMatch = lowerKeyCode.match(/^key\.keyboard\.(\d)$/);
  if (digitMatch) {
    return `Digit${digitMatch[1]}`;
  }

  // マウスボタン
  const mouseMap: Record<string, string> = {
    "key.mouse.left": "Mouse0",
    "key.mouse.right": "Mouse1",
    "key.mouse.middle": "Mouse2",
    "key.mouse.4": "Mouse3",
    "key.mouse.5": "Mouse4",
  };
  if (mouseMap[lowerKeyCode]) {
    return mouseMap[lowerKeyCode];
  }

  // 特殊キー
  const specialMap: Record<string, string> = {
    "key.keyboard.space": "Space",
    "key.keyboard.left.shift": "ShiftLeft",
    "key.keyboard.right.shift": "ShiftRight",
    "key.keyboard.left.control": "ControlLeft",
    "key.keyboard.right.control": "ControlRight",
    "key.keyboard.tab": "Tab",
    "key.keyboard.caps.lock": "CapsLock",
    "key.keyboard.escape": "Escape",
    "key.keyboard.f1": "F1",
    "key.keyboard.f2": "F2",
    "key.keyboard.f3": "F3",
    "key.keyboard.f5": "F5",
  };
  if (specialMap[lowerKeyCode]) {
    return specialMap[lowerKeyCode];
  }

  return keyCode;
}

export async function loader({ request }: Route.LoaderArgs) {
  const t = createTranslator(resolveLocale(request));
  const env = getEnv();
  const db = createDb();

  // 分布グラフの区間ラベル。単位は文字列として渡す（"5%" / "10cm" / "" ）
  const binUpTo = (max: string) => t("stats.binUpTo", { max });
  const binRange = (min: number, max: string) => t("stats.binRange", { min, max });
  const binFrom = (min: string) => t("stats.binFrom", { min });

  // 総ユーザー数
  const [{ totalUsers }] = await db.select({ totalUsers: count() }).from(users);

  // キーバインドを持つユーザー数
  const [{ usersWithKeybindings }] = await db
    .select({
      usersWithKeybindings: sql<number>`COUNT(DISTINCT ${keybindings.userId})`,
    })
    .from(keybindings);

  // 全キーバインドデータを取得
  const allKeybindings = await db
    .select({
      action: keybindings.action,
      keyCode: keybindings.keyCode,
    })
    .from(keybindings);

  // 操作 → キー の統計（各操作にどのキーが割り当てられているか）
  const actionToKeyStats: Record<string, Record<string, number>> = {};
  for (const action of STATS_ACTIONS) {
    actionToKeyStats[action] = {};
  }

  // キー → 操作 の統計（各キーにどの操作が割り当てられているか）
  const keyToActionStats: Record<string, Record<string, number>> = {};
  for (const key of STATS_KEYS) {
    keyToActionStats[key] = {};
  }

  // 集計
  for (const kb of allKeybindings) {
    const normalizedKey = normalizeKeyCodeForStats(kb.keyCode);

    // 操作 → キー
    if (actionToKeyStats[kb.action]) {
      actionToKeyStats[kb.action][normalizedKey] =
        (actionToKeyStats[kb.action][normalizedKey] || 0) + 1;
    }

    // キー → 操作
    if (keyToActionStats[normalizedKey]) {
      keyToActionStats[normalizedKey][kb.action] =
        (keyToActionStats[normalizedKey][kb.action] || 0) + 1;
    }
  }

  // マウス設定の統計
  const mouseConfigs = await db
    .select({
      mouseDpi: playerConfigs.mouseDpi,
      gameSensitivity: playerConfigs.gameSensitivity,
      cm360: playerConfigs.cm360,
      rawInput: playerConfigs.rawInput,
      mouseAcceleration: playerConfigs.mouseAcceleration,
      toggleSprint: playerConfigs.toggleSprint,
    })
    .from(playerConfigs);

  // DPI分布（参考: mchotkeys）
  const dpiDistribution: Record<string, number> = {};
  const dpiRanges = [
    { label: binUpTo("400"), min: 0, max: 399 },
    { label: binRange(400, "799"), min: 400, max: 799 },
    { label: binRange(800, "1199"), min: 800, max: 1199 },
    { label: binRange(1200, "1599"), min: 1200, max: 1599 },
    { label: binRange(1600, "1999"), min: 1600, max: 1999 },
    { label: binRange(2000, "2399"), min: 2000, max: 2399 },
    { label: binRange(2400, "3199"), min: 2400, max: 3199 },
    { label: binFrom("3200"), min: 3200, max: Infinity },
  ];

  for (const range of dpiRanges) {
    dpiDistribution[range.label] = 0;
  }

  for (const config of mouseConfigs) {
    if (config.mouseDpi) {
      for (const range of dpiRanges) {
        if (config.mouseDpi >= range.min && config.mouseDpi <= range.max) {
          dpiDistribution[range.label]++;
          break;
        }
      }
    }
  }

  // 感度分布（内部値 0..1 を表示 0〜200% に換算してから区分に振り分ける。
  // 区分の実体は keybindings-stats-shared.ts の SENSITIVITY_PERCENT_BINS
  // （キー配置統計の SENSITIVITY_RANGES と共有）。ラベルはこちらでロケールに合わせて生成する
  const sensitivityDistribution: Record<string, number> = {};
  const sensRanges = SENSITIVITY_PERCENT_BINS.map(({ min, max }) => ({
    min,
    max,
    label: min === 0 ? binUpTo(`${max + 1}%`) : binRange(min, `${max}%`),
  }));

  for (const range of sensRanges) {
    sensitivityDistribution[range.label] = 0;
  }

  // 非null・範囲外（表示200%超 / 0%未満）だった人数。UIで「除外」の注記に使う
  // （未設定=nullは元々対象外なのでここには含めない）
  let sensitivityExcludedCount = 0;

  for (const config of mouseConfigs) {
    // 範囲外（内部値 0..1 を外れる）感度は母数から除外する（キー配置統計と同じ方針）
    if (!isValidSensitivity(config.gameSensitivity)) {
      if (isOutOfRangeSensitivity(config.gameSensitivity)) sensitivityExcludedCount++;
      continue;
    }
    const sensitivityPercent = toSensitivityPercent(config.gameSensitivity);
    if (sensitivityPercent == null) continue;

    for (const range of sensRanges) {
      if (sensitivityPercent >= range.min && sensitivityPercent <= range.max) {
        sensitivityDistribution[range.label]++;
        break;
      }
    }
  }

  // cm/360分布（参考: mchotkeys のcm/180を2倍）
  const cm360Distribution: Record<string, number> = {};
  const cm360Ranges = [
    { label: binUpTo("10cm"), min: 0, max: 9 },
    { label: binRange(10, "15cm"), min: 10, max: 14 },
    { label: binRange(15, "20cm"), min: 15, max: 19 },
    { label: binRange(20, "30cm"), min: 20, max: 29 },
    { label: binRange(30, "40cm"), min: 30, max: 39 },
    { label: binRange(40, "50cm"), min: 40, max: 49 },
    { label: binRange(50, "70cm"), min: 50, max: 69 },
    { label: binRange(70, "100cm"), min: 70, max: 99 },
    { label: binFrom("100cm"), min: 100, max: Infinity },
  ];

  for (const range of cm360Ranges) {
    cm360Distribution[range.label] = 0;
  }

  for (const config of mouseConfigs) {
    if (config.cm360) {
      for (const range of cm360Ranges) {
        if (config.cm360 >= range.min && config.cm360 <= range.max) {
          cm360Distribution[range.label]++;
          break;
        }
      }
    }
  }

  // 設定オプションの統計
  let rawInputEnabled = 0;
  let rawInputDisabled = 0;
  let mouseAccelEnabled = 0;
  let mouseAccelDisabled = 0;
  let toggleSprintEnabled = 0;
  let toggleSprintDisabled = 0;

  for (const config of mouseConfigs) {
    if (config.rawInput === true) rawInputEnabled++;
    else if (config.rawInput === false) rawInputDisabled++;

    if (config.mouseAcceleration === true) mouseAccelEnabled++;
    else if (config.mouseAcceleration === false) mouseAccelDisabled++;

    if (config.toggleSprint === true) toggleSprintEnabled++;
    else if (config.toggleSprint === false) toggleSprintDisabled++;
  }

  return {
    totalUsers,
    usersWithKeybindings,
    actionToKeyStats,
    keyToActionStats,
    appUrl: env.APP_URL || "https://minefolio.app",
    mouseStats: {
      totalConfigs: mouseConfigs.length,
      dpiDistribution,
      sensitivityDistribution,
      sensitivityExcludedCount,
      cm360Distribution,
      rawInput: { enabled: rawInputEnabled, disabled: rawInputDisabled },
      mouseAcceleration: {
        enabled: mouseAccelEnabled,
        disabled: mouseAccelDisabled,
      },
      toggleSprint: {
        enabled: toggleSprintEnabled,
        disabled: toggleSprintDisabled,
      },
    },
  };
}

function StatBar({
  label,
  count,
  total,
  maxCount,
}: {
  label: string;
  count: number;
  total: number;
  maxCount: number;
}) {
  const t = useT();
  const percentage = total > 0 ? Math.round((count / total) * 100) : 0;
  const barWidth = maxCount > 0 ? (count / maxCount) * 100 : 0;

  return (
    <div className="flex items-center gap-3">
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="w-20 text-sm font-medium truncate">{label}</div>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      <div className="flex-1">
        <Progress value={barWidth} className="h-6" />
      </div>
      <div className="w-20 text-right text-sm text-muted-foreground">
        {count}{t("common.peopleUnit")} ({percentage}%)
      </div>
    </div>
  );
}

function ActionToKeyCard({
  action,
  keyStats,
  totalUsers,
}: {
  action: string;
  keyStats: Record<string, number>;
  totalUsers: number;
}) {
  const t = useT();
  const entries = Object.entries(keyStats)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  if (entries.length === 0) return null;

  const maxCount = entries[0]?.[1] || 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{getActionLabel(t, action)}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {entries.map(([key, count]) => (
          <StatBar
            key={key}
            label={getKeyLabel(t, key)}
            count={count}
            total={totalUsers}
            maxCount={maxCount}
          />
        ))}
      </CardContent>
    </Card>
  );
}

function KeyToActionCard({
  keyCode,
  actionStats,
  totalUsers,
}: {
  keyCode: string;
  actionStats: Record<string, number>;
  totalUsers: number;
}) {
  const t = useT();
  const entries = Object.entries(actionStats)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  if (entries.length === 0) return null;

  const maxCount = entries[0]?.[1] || 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{getKeyLabel(t, keyCode)}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {entries.map(([action, count]) => (
          <StatBar
            key={action}
            label={getActionLabel(t, action)}
            count={count}
            total={totalUsers}
            maxCount={maxCount}
          />
        ))}
      </CardContent>
    </Card>
  );
}

function DistributionCard({
  title,
  distribution,
  footnote,
}: {
  title: string;
  distribution: Record<string, number>;
  /** 分布の下に添える小さな補足（例: 範囲外として除外した件数の注記） */
  footnote?: string;
}) {
  const entries = Object.entries(distribution);
  const total = entries.reduce((sum, [, count]) => sum + count, 0);
  const maxCount = Math.max(...entries.map(([, count]) => count));

  if (total === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {entries.map(([label, count]) => (
          <StatBar
            key={label}
            label={label}
            count={count}
            total={total}
            maxCount={maxCount}
          />
        ))}
        {footnote && <p className="pt-1 text-xs text-muted-foreground">{footnote}</p>}
      </CardContent>
    </Card>
  );
}

function BooleanStatCard({
  title,
  enabled,
  disabled,
}: {
  title: string;
  enabled: number;
  disabled: number;
}) {
  const t = useT();
  const total = enabled + disabled;
  if (total === 0) return null;

  const maxCount = Math.max(enabled, disabled);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <StatBar label={t("common.on")} count={enabled} total={total} maxCount={maxCount} />
        <StatBar
          label={t("common.off")}
          count={disabled}
          total={total}
          maxCount={maxCount}
        />
      </CardContent>
    </Card>
  );
}

export default function StatsPage() {
  const t = useT();
  const {
    totalUsers,
    usersWithKeybindings,
    actionToKeyStats,
    keyToActionStats,
    mouseStats,
  } = useLoaderData<typeof loader>();

  // 表示するアクション（データがあるもののみ）
  const actionsWithData = STATS_ACTIONS.filter(
    (action) => Object.keys(actionToKeyStats[action] || {}).length > 0
  );

  // 表示するキー（データがあるもののみ）
  const keysWithData = STATS_KEYS.filter(
    (key) => Object.keys(keyToActionStats[key] || {}).length > 0
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">{t("stats.title")}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {t("stats.headingDescription")}
        </p>
      </div>

      {/* Summary */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Users className="h-4 w-4" />
        <span>
          {t("stats.summary", {
            total: totalUsers,
            suffix: t("stats.summaryPrefix"),
            withKeybindings: usersWithKeybindings,
          })}
        </span>
      </div>

      <Tabs defaultValue="action-to-key" className="w-full">
        <TabsList>
          <TabsTrigger value="action-to-key" className="gap-2">
            <span className="hidden sm:inline">{t("stats.action")}</span>
            <ArrowRight className="h-4 w-4" />
            <span className="hidden sm:inline">{t("stats.key")}</span>
            <span className="sm:hidden">{t("stats.actionToKey")}</span>
          </TabsTrigger>
          <TabsTrigger value="key-to-action" className="gap-2">
            <span className="hidden sm:inline">{t("stats.key")}</span>
            <ArrowRight className="h-4 w-4" />
            <span className="hidden sm:inline">{t("stats.action")}</span>
            <span className="sm:hidden">{t("stats.keyToAction")}</span>
          </TabsTrigger>
          <TabsTrigger value="mouse" className="gap-2">
            <Mouse className="h-4 w-4" />
            <span>{t("stats.mouseSettings")}</span>
          </TabsTrigger>
        </TabsList>

        {/* 操作 → キー */}
        <TabsContent value="action-to-key" className="space-y-6">
          <p className="text-sm text-muted-foreground">
            {t("stats.actionToKeyDescription")}
          </p>

          {/* 移動系 */}
          <div className="space-y-4">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Keyboard className="h-5 w-5" />
              {t("stats.movement")}
            </h2>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {["sprint", "sneak"]
                .filter((action) => actionsWithData.includes(action))
                .map((action) => (
                  <ActionToKeyCard
                    key={action}
                    action={action}
                    keyStats={actionToKeyStats[action]}
                    totalUsers={usersWithKeybindings}
                  />
                ))}
            </div>
          </div>

          {/* アクション系 */}
          <div className="space-y-4">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Keyboard className="h-5 w-5" />
              {t("stats.actionGroup")}
            </h2>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {["inventory", "swapHands", "drop", "pickBlock"]
                .filter((action) => actionsWithData.includes(action))
                .map((action) => (
                  <ActionToKeyCard
                    key={action}
                    action={action}
                    keyStats={actionToKeyStats[action]}
                    totalUsers={usersWithKeybindings}
                  />
                ))}
            </div>
          </div>

          {/* ホットバー */}
          <div className="space-y-4">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Keyboard className="h-5 w-5" />
              {t("stats.hotbar")}
            </h2>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {[
                "hotbar1",
                "hotbar2",
                "hotbar3",
                "hotbar4",
                "hotbar5",
                "hotbar6",
                "hotbar7",
                "hotbar8",
                "hotbar9",
              ]
                .filter((action) => actionsWithData.includes(action))
                .map((action) => (
                  <ActionToKeyCard
                    key={action}
                    action={action}
                    keyStats={actionToKeyStats[action]}
                    totalUsers={usersWithKeybindings}
                  />
                ))}
            </div>
          </div>
        </TabsContent>

        {/* キー → 操作 */}
        <TabsContent value="key-to-action" className="space-y-6">
          <p className="text-sm text-muted-foreground">
            {t("stats.keyToActionDescription")}
          </p>

          {/* アルファベットキー */}
          <div className="space-y-4">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Keyboard className="h-5 w-5" />
              {t("stats.alphabetKey")}
            </h2>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {[
                "KeyE",
                "KeyQ",
                "KeyR",
                "KeyF",
                "KeyC",
                "KeyX",
                "KeyZ",
                "KeyG",
                "KeyV",
              ]
                .filter((key) => keysWithData.includes(key))
                .map((key) => (
                  <KeyToActionCard
                    key={key}
                    keyCode={key}
                    actionStats={keyToActionStats[key]}
                    totalUsers={usersWithKeybindings}
                  />
                ))}
            </div>
          </div>

          {/* 修飾キー */}
          <div className="space-y-4">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Keyboard className="h-5 w-5" />
              {t("stats.modifierKey")}
            </h2>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {["ShiftLeft", "ControlLeft", "Tab", "CapsLock", "Space"]
                .filter((key) => keysWithData.includes(key))
                .map((key) => (
                  <KeyToActionCard
                    key={key}
                    keyCode={key}
                    actionStats={keyToActionStats[key]}
                    totalUsers={usersWithKeybindings}
                  />
                ))}
            </div>
          </div>

          {/* マウスボタン */}
          <div className="space-y-4">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Mouse className="h-5 w-5" />
              {t("stats.mouseButton")}
            </h2>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {["Mouse0", "Mouse1", "Mouse2", "Mouse3", "Mouse4"]
                .filter((key) => keysWithData.includes(key))
                .map((key) => (
                  <KeyToActionCard
                    key={key}
                    keyCode={key}
                    actionStats={keyToActionStats[key]}
                    totalUsers={usersWithKeybindings}
                  />
                ))}
            </div>
          </div>

          {/* 数字キー */}
          <div className="space-y-4">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Keyboard className="h-5 w-5" />
              {t("stats.numberKey")}
            </h2>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {[
                "Digit1",
                "Digit2",
                "Digit3",
                "Digit4",
                "Digit5",
                "Digit6",
                "Digit7",
                "Digit8",
                "Digit9",
              ]
                .filter((key) => keysWithData.includes(key))
                .map((key) => (
                  <KeyToActionCard
                    key={key}
                    keyCode={key}
                    actionStats={keyToActionStats[key]}
                    totalUsers={usersWithKeybindings}
                  />
                ))}
            </div>
          </div>
        </TabsContent>

        {/* マウス設定 */}
        <TabsContent value="mouse" className="space-y-6">
          <p className="text-sm text-muted-foreground">
            {t("stats.mouseSettingsDescription", { count: mouseStats.totalConfigs })}
          </p>

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <DistributionCard
              title="DPI"
              distribution={mouseStats.dpiDistribution}
            />
            <DistributionCard
              title={t("stats.inGameSensitivity")}
              distribution={mouseStats.sensitivityDistribution}
              footnote={
                mouseStats.sensitivityExcludedCount > 0
                  ? t("stats.sensitivityExcludedNote", {
                      count: mouseStats.sensitivityExcludedCount,
                    })
                  : undefined
              }
            />
            <DistributionCard
              title="cm/360"
              distribution={mouseStats.cm360Distribution}
            />
            <BooleanStatCard
              title="Raw Input"
              enabled={mouseStats.rawInput.enabled}
              disabled={mouseStats.rawInput.disabled}
            />
            <BooleanStatCard
              title={t("stats.mouseAcceleration")}
              enabled={mouseStats.mouseAcceleration.enabled}
              disabled={mouseStats.mouseAcceleration.disabled}
            />
            <BooleanStatCard
              title={t("stats.dashToggle")}
              enabled={mouseStats.toggleSprint.enabled}
              disabled={mouseStats.toggleSprint.disabled}
            />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
