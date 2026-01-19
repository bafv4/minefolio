import { useLoaderData } from "react-router";
import type { Route } from "./+types/stats";
import { createDb } from "@/lib/db";
import { getEnv } from "@/lib/env.server";
import { keybindings, playerConfigs, users } from "@/lib/schema";
import { sql, count } from "drizzle-orm";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { getKeyLabel, getActionLabel } from "@/lib/keybindings";
import { Keyboard, Mouse, ArrowRight, Users } from "lucide-react";

export const meta: Route.MetaFunction = () => {
  return [
    { title: "統計 - Minefolio" },
    {
      name: "description",
      content: "Minecraftスピードランナーのキー配置・マウス設定の統計",
    },
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

export async function loader({ context }: Route.LoaderArgs) {
  const env = context.env ?? getEnv();
  const db = createDb();

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
    { label: "〜400", min: 0, max: 399 },
    { label: "400〜799", min: 400, max: 799 },
    { label: "800〜1199", min: 800, max: 1199 },
    { label: "1200〜1599", min: 1200, max: 1599 },
    { label: "1600〜1999", min: 1600, max: 1999 },
    { label: "2000〜2399", min: 2000, max: 2399 },
    { label: "2400〜3199", min: 2400, max: 3199 },
    { label: "3200〜", min: 3200, max: Infinity },
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

  // 感度分布（参考: mchotkeys）
  const sensitivityDistribution: Record<string, number> = {};
  const sensRanges = [
    { label: "〜5%", min: 0, max: 4 },
    { label: "5〜9%", min: 5, max: 9 },
    { label: "10〜14%", min: 10, max: 14 },
    { label: "15〜19%", min: 15, max: 19 },
    { label: "20〜39%", min: 20, max: 39 },
    { label: "40〜59%", min: 40, max: 59 },
    { label: "60〜79%", min: 60, max: 79 },
    { label: "80〜99%", min: 80, max: 99 },
    { label: "100%", min: 100, max: 100 },
    { label: "101%〜", min: 101, max: Infinity },
  ];

  for (const range of sensRanges) {
    sensitivityDistribution[range.label] = 0;
  }

  for (const config of mouseConfigs) {
    if (config.gameSensitivity) {
      for (const range of sensRanges) {
        if (
          config.gameSensitivity >= range.min &&
          config.gameSensitivity <= range.max
        ) {
          sensitivityDistribution[range.label]++;
          break;
        }
      }
    }
  }

  // cm/360分布（参考: mchotkeys のcm/180を2倍）
  const cm360Distribution: Record<string, number> = {};
  const cm360Ranges = [
    { label: "〜10cm", min: 0, max: 9 },
    { label: "10〜15cm", min: 10, max: 14 },
    { label: "15〜20cm", min: 15, max: 19 },
    { label: "20〜30cm", min: 20, max: 29 },
    { label: "30〜40cm", min: 30, max: 39 },
    { label: "40〜50cm", min: 40, max: 49 },
    { label: "50〜70cm", min: 50, max: 69 },
    { label: "70〜100cm", min: 70, max: 99 },
    { label: "100cm〜", min: 100, max: Infinity },
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
    mouseStats: {
      totalConfigs: mouseConfigs.length,
      dpiDistribution,
      sensitivityDistribution,
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
  const percentage = total > 0 ? Math.round((count / total) * 100) : 0;
  const barWidth = maxCount > 0 ? (count / maxCount) * 100 : 0;

  return (
    <div className="flex items-center gap-3">
      <div className="w-20 text-sm font-medium truncate" title={label}>
        {label}
      </div>
      <div className="flex-1">
        <Progress value={barWidth} className="h-6" />
      </div>
      <div className="w-20 text-right text-sm text-muted-foreground">
        {count}人 ({percentage}%)
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
  const entries = Object.entries(keyStats)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  if (entries.length === 0) return null;

  const maxCount = entries[0]?.[1] || 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{getActionLabel(action)}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {entries.map(([key, count]) => (
          <StatBar
            key={key}
            label={getKeyLabel(key)}
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
  const entries = Object.entries(actionStats)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  if (entries.length === 0) return null;

  const maxCount = entries[0]?.[1] || 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{getKeyLabel(keyCode)}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {entries.map(([action, count]) => (
          <StatBar
            key={action}
            label={getActionLabel(action)}
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
}: {
  title: string;
  distribution: Record<string, number>;
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
  const total = enabled + disabled;
  if (total === 0) return null;

  const maxCount = Math.max(enabled, disabled);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <StatBar label="ON" count={enabled} total={total} maxCount={maxCount} />
        <StatBar
          label="OFF"
          count={disabled}
          total={total}
          maxCount={maxCount}
        />
      </CardContent>
    </Card>
  );
}

export default function StatsPage() {
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
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold">統計</h1>
        <p className="text-muted-foreground mt-1">
          Minecraftスピードランナーのキー配置・マウス設定の統計
        </p>
      </div>

      {/* Summary */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Users className="h-4 w-4" />
        <span>
          {totalUsers}人のプレイヤー（うち{usersWithKeybindings}
          人がキー配置を登録）
        </span>
      </div>

      <Tabs defaultValue="action-to-key" className="space-y-6">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="action-to-key" className="gap-2">
            <span className="hidden sm:inline">操作</span>
            <ArrowRight className="h-4 w-4" />
            <span className="hidden sm:inline">キー</span>
            <span className="sm:hidden">操作→キー</span>
          </TabsTrigger>
          <TabsTrigger value="key-to-action" className="gap-2">
            <span className="hidden sm:inline">キー</span>
            <ArrowRight className="h-4 w-4" />
            <span className="hidden sm:inline">操作</span>
            <span className="sm:hidden">キー→操作</span>
          </TabsTrigger>
          <TabsTrigger value="mouse" className="gap-2">
            <Mouse className="h-4 w-4" />
            <span>マウス設定</span>
          </TabsTrigger>
        </TabsList>

        {/* 操作 → キー */}
        <TabsContent value="action-to-key" className="space-y-6">
          <p className="text-sm text-muted-foreground">
            各操作にどのキーが割り当てられているかの統計
          </p>

          {/* 移動系 */}
          <div className="space-y-4">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Keyboard className="h-5 w-5" />
              移動
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
              アクション
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
              ホットバー
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
            各キーにどの操作が割り当てられているかの統計
          </p>

          {/* アルファベットキー */}
          <div className="space-y-4">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Keyboard className="h-5 w-5" />
              アルファベットキー
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
              修飾キー
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
              マウスボタン
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
              数字キー
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
            マウス設定とゲーム内オプションの統計（{mouseStats.totalConfigs}
            人のデータ）
          </p>

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <DistributionCard
              title="DPI"
              distribution={mouseStats.dpiDistribution}
            />
            <DistributionCard
              title="ゲーム内感度"
              distribution={mouseStats.sensitivityDistribution}
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
              title="マウス加速"
              enabled={mouseStats.mouseAcceleration.enabled}
              disabled={mouseStats.mouseAcceleration.disabled}
            />
            <BooleanStatCard
              title="ダッシュ切替"
              enabled={mouseStats.toggleSprint.enabled}
              disabled={mouseStats.toggleSprint.disabled}
            />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
