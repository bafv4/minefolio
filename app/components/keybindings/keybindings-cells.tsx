// /keybindings の TanStack Table 用セル部品。
// 旧 keybindings.tsx の PlayerRow / RemapRow / CustomActionListRow / MouseSettingsRow を
// セル単位に分解し、再利用可能にしたもの。
import { Link } from "react-router";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { MinecraftAvatar } from "@/components/minecraft-avatar";
import { cn } from "@/lib/utils";
import {
  getKeyLabel,
  getKeyCombinationLabel,
  isUnbound,
  normalizeKeyCode,
} from "@/lib/keybindings";
import {
  getRemapSourceLabel,
  getRemapOutputLabel,
  type KeyRemapType,
} from "@/lib/remap-utils";
import {
  calculateCm360,
  calculateCursorSpeed,
  WINDOWS_POINTER_MULTIPLIERS,
} from "@/lib/mouse-settings";
import { truncateByVisualWidth } from "@/lib/text-width";
import { useT } from "@/hooks/use-locale";

/** 走者列の最小データ */
export type PlayerSummary = {
  slug: string;
  mcid: string | null;
  uuid: string | null;
  displayName: string | null;
  customSkinUrl: string | null;
};


/* ============================================================
 * 走者セル（左端 sticky）
 * ========================================================== */

export function RunnerCell({
  player,
  variant = "default",
}: {
  player: PlayerSummary;
  /** compact: モバイル向け縦並び（頭を大きめ＋名前を下に小さく） */
  variant?: "default" | "compact";
}) {
  const name = player.displayName ?? player.mcid ?? player.slug;

  if (variant === "compact") {
    return (
      <Link
        to={`/player/${player.slug}`}
        className="flex flex-col items-center gap-1 hover:opacity-80 transition-opacity w-full min-w-0 text-center"
      >
        <MinecraftAvatar
          uuid={player.uuid}
          skinUrl={player.customSkinUrl}
          size={40}
          className="rounded-sm shrink-0"
        />
        <span className="w-full truncate text-xs font-medium leading-tight">
          {name}
        </span>
      </Link>
    );
  }

  return (
    <Link
      to={`/player/${player.slug}`}
      className="flex items-center gap-2 hover:opacity-80 transition-opacity min-w-0 w-full"
    >
      <MinecraftAvatar
        uuid={player.uuid}
        skinUrl={player.customSkinUrl}
        size={28}
        className="rounded-sm shrink-0"
      />
      <div className="min-w-0">
        <p className="font-medium text-sm truncate">{name}</p>
      </div>
    </Link>
  );
}

/* ============================================================
 * KeyBadge — 修飾キー組み合わせ対応のキー表示
 * ========================================================== */

export function KeyBadge({
  keyCode,
  keyboardLayout,
  customKeyNames,
}: {
  keyCode: string;
  keyboardLayout?: string | null;
  /** カスタムキー keyCode → 表示名。標準ラベルより優先して使用する。 */
  customKeyNames?: Record<string, string>;
}) {
  const t = useT();
  if (isUnbound(keyCode)) {
    return <span className="text-muted-foreground/40">-</span>;
  }
  // カスタムキー名があれば最優先（正規化前後どちらの keyCode でも引けるようにする）
  const customName =
    customKeyNames?.[keyCode] ?? customKeyNames?.[normalizeKeyCode(keyCode)];
  const label =
    customName ??
    (keyCode.includes("+")
      ? getKeyCombinationLabel(t, keyCode, keyboardLayout)
      : getKeyLabel(t, keyCode, keyboardLayout));
  const truncated = truncateByVisualWidth(label);
  const isMouse =
    keyCode.startsWith("Mouse") || keyCode.toLowerCase().includes("mouse");

  const badge = (
    <Badge
      variant="secondary"
      className={cn(
        "font-mono text-xs px-1.5 py-0.5",
        isMouse &&
          "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
      )}
    >
      {truncated}
    </Badge>
  );
  return label !== truncated ? (
    <Tooltip>
      <TooltipTrigger asChild>
        <span>{badge}</span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  ) : (
    badge
  );
}

/** 行データからアクションキー1つを取り出して描画 */
export function ActionKeyCell({
  keyCode,
  keyboardLayout,
  customKeyNames,
}: {
  keyCode: string | undefined;
  keyboardLayout?: string | null;
  customKeyNames?: Record<string, string>;
}) {
  if (!keyCode) return <span className="text-muted-foreground/40">-</span>;
  return (
    <KeyBadge
      keyCode={keyCode}
      keyboardLayout={keyboardLayout}
      customKeyNames={customKeyNames}
    />
  );
}

// customKeys 配列の参照をキーにマップをキャッシュ。
// 列セルごと（同一行で複数回）に呼ばれても再構築しない。
const customKeyNamesCache = new WeakMap<object, Record<string, string>>();

/** 行の customKeys 配列から keyCode → 表示名マップを生成（参照単位でメモ化） */
export function buildCustomKeyNames(
  customKeys: Array<{ keyCode: string; keyName: string }> | undefined,
): Record<string, string> | undefined {
  if (!customKeys || customKeys.length === 0) return undefined;
  const cached = customKeyNamesCache.get(customKeys);
  if (cached) return cached;
  const map: Record<string, string> = {};
  for (const ck of customKeys) map[ck.keyCode] = ck.keyName;
  customKeyNamesCache.set(customKeys, map);
  return map;
}

/* ============================================================
 * ホットバーセル（hotbar1〜9 をすべて 1 行で表示。折り返さない）
 * 各スロットの上に番号、その下に割り当てキーを並べる。
 * ========================================================== */

type HotbarKeybinding = { action: string; keyCode: string };

export function HotbarSummaryCell({
  keybindings,
  keyboardLayout,
  customKeyNames,
}: {
  keybindings: HotbarKeybinding[];
  keyboardLayout?: string | null;
  customKeyNames?: Record<string, string>;
}) {
  const byAction = new Map(keybindings.map((k) => [k.action, k.keyCode]));
  const slots = Array.from({ length: 9 }, (_, i) => ({
    n: i + 1,
    keyCode: byAction.get(`hotbar${i + 1}`),
  }));

  if (slots.every((s) => s.keyCode == null)) {
    return <span className="text-muted-foreground/40">-</span>;
  }

  return (
    <div className="flex flex-nowrap items-end gap-1">
      {slots.map(({ n, keyCode }) => (
        <span key={n} className="inline-flex flex-col items-center gap-0.5">
          <span className="text-[9px] leading-none text-muted-foreground">{n}</span>
          {keyCode ? (
            <KeyBadge
              keyCode={keyCode}
              keyboardLayout={keyboardLayout}
              customKeyNames={customKeyNames}
            />
          ) : (
            <span className="text-muted-foreground/40 text-xs px-1">-</span>
          )}
        </span>
      ))}
    </div>
  );
}

/* ============================================================
 * リマップセル（複数件を chip 列挙）
 * ========================================================== */

export type RemapItem = {
  id: string;
  sourceKey: string;
  targetKey: string | null;
  software?: string | null;
  notes?: string | null;
  remapType?: KeyRemapType | null;
};

export function RemapCell({
  remaps,
  keyboardLayout,
  customKeyNames,
}: {
  remaps: RemapItem[];
  keyboardLayout?: string | null;
  customKeyNames?: Record<string, string>;
}) {
  const t = useT();
  if (remaps.length === 0) {
    return <span className="text-muted-foreground/40 text-sm">-</span>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {remaps.map((remap) => (
        <Badge key={remap.id} variant="secondary" className="font-mono text-xs">
          {getRemapSourceLabel(t, remap.sourceKey, keyboardLayout, customKeyNames)} →{" "}
          {getRemapOutputLabel(t, remap, keyboardLayout, customKeyNames)}
        </Badge>
      ))}
    </div>
  );
}

/* ============================================================
 * カスタムアクションセル
 * ========================================================== */

export type CustomActionItem = {
  id: string;
  actionName: string;
  category: "other" | "macro" | "tool";
  triggerKey: string;
  description: string | null;
};

export function CustomActionCell({
  customActions,
  keyboardLayout,
}: {
  customActions: CustomActionItem[];
  keyboardLayout?: string | null;
}) {
  const t = useT();
  if (customActions.length === 0) {
    return <span className="text-muted-foreground/40 text-sm">-</span>;
  }
  return (
    <div className="space-y-1.5">
      {customActions.map((action) => (
        <div key={action.id} className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="font-mono text-xs">
            {getKeyCombinationLabel(t, action.triggerKey, keyboardLayout)}
          </Badge>
          <span className="text-sm font-medium">{action.actionName}</span>
        </div>
      ))}
    </div>
  );
}

/* ============================================================
 * マウス設定セル群
 * ========================================================== */

export type MouseConfig = {
  keyboardLayout: string | null;
  fingerAssignments?: string | null;
  mouseDpi: number | null;
  gameSensitivity: number | null;
  windowsSpeed: number | null;
  windowsSpeedMultiplier: number | null;
  rawInput: boolean | null;
  mouseAcceleration: boolean | null;
} | null;

export function DpiCell({ config }: { config: MouseConfig }) {
  if (config?.mouseDpi == null) {
    return <span className="text-muted-foreground/40">-</span>;
  }
  return <span className="font-mono text-sm">{config.mouseDpi}</span>;
}

export function SensitivityCell({ config }: { config: MouseConfig }) {
  if (config?.gameSensitivity == null) {
    return <span className="text-muted-foreground/40">-</span>;
  }
  const display = Math.floor(config.gameSensitivity * 200);
  return (
    <span className="font-mono text-sm">
      {display}
      <span className="text-muted-foreground">%</span>
    </span>
  );
}

export function Cm360Cell({ config }: { config: MouseConfig }) {
  if (config == null) {
    return <span className="text-muted-foreground/40">-</span>;
  }
  const cm360 = calculateCm360(
    config.mouseDpi,
    config.gameSensitivity,
    config.rawInput,
    config.windowsSpeed,
    config.windowsSpeedMultiplier,
  );
  if (cm360 == null) {
    return <span className="text-muted-foreground/40">-</span>;
  }
  return (
    <span className="font-mono text-sm">
      {cm360.toFixed(1)}
      <span className="text-muted-foreground">cm</span>
    </span>
  );
}

export function WindowsSpeedCell({ config }: { config: MouseConfig }) {
  const t = useT();
  if (config?.windowsSpeedMultiplier != null) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="font-mono text-sm">
            x{config.windowsSpeedMultiplier.toFixed(3)}
          </span>
        </TooltipTrigger>
        <TooltipContent>{t("keybindings.customMultiplier")}</TooltipContent>
      </Tooltip>
    );
  }
  if (config?.windowsSpeed != null) {
    return (
      <span className="font-mono text-sm">
        {config.windowsSpeed}
        <span className="text-muted-foreground">
          (x
          {WINDOWS_POINTER_MULTIPLIERS[config.windowsSpeed]?.toFixed(3) ??
            "1.000"}
          )
        </span>
      </span>
    );
  }
  return (
    <span className="text-muted-foreground/40">{t("keybindings.noValue")}</span>
  );
}

export function CursorSpeedCell({ config }: { config: MouseConfig }) {
  if (config == null) {
    return <span className="text-muted-foreground/40">-</span>;
  }
  const cursor = calculateCursorSpeed(
    config.mouseDpi,
    config.windowsSpeed,
    config.windowsSpeedMultiplier,
  );
  if (cursor == null) {
    return <span className="text-muted-foreground/40">-</span>;
  }
  return <span className="font-mono text-sm">{cursor}</span>;
}

export function RawInputCell({ config }: { config: MouseConfig }) {
  if (config?.rawInput == null) {
    return <span className="text-muted-foreground/40">-</span>;
  }
  return (
    <Badge
      variant={config.rawInput ? "default" : "secondary"}
      className="text-xs"
    >
      {config.rawInput ? "ON" : "OFF"}
    </Badge>
  );
}

export function AccelerationCell({ config }: { config: MouseConfig }) {
  if (config?.mouseAcceleration == null) {
    return <span className="text-muted-foreground/40">-</span>;
  }
  return (
    <Badge
      variant={config.mouseAcceleration ? "destructive" : "secondary"}
      className="text-xs"
    >
      {config.mouseAcceleration ? "ON" : "OFF"}
    </Badge>
  );
}
