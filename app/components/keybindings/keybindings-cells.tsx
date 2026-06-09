// /keybindings の TanStack Table 用セル部品。
// 旧 keybindings.tsx の PlayerRow / RemapRow / CustomActionListRow / MouseSettingsRow を
// セル単位に分解し、再利用可能にしたもの。
import { Link } from "react-router";
import { Star } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { MinecraftAvatar } from "@/components/minecraft-avatar";
import { cn } from "@/lib/utils";
import {
  getKeyLabel,
  getKeyCombinationLabel,
  isUnbound,
} from "@/lib/keybindings";
import {
  getRemapSourceLabel,
  getRemapOutputLabel,
} from "@/lib/remap-utils";
import {
  calculateCm360,
  calculateCursorSpeed,
  WINDOWS_POINTER_MULTIPLIERS,
} from "@/lib/mouse-settings";
import { useCompareBasket, COMPARE_BASKET_LIMIT } from "@/hooks/use-compare-basket";
import { t } from "@/lib/messages";

/** 走者列の最小データ */
export type PlayerSummary = {
  slug: string;
  mcid: string | null;
  uuid: string | null;
  displayName: string | null;
  customSkinUrl: string | null;
};

/* ============================================================
 * 文字幅ユーティリティ（全角=2, 半角=1）
 * ========================================================== */

function getVisualWidth(str: string): number {
  let width = 0;
  for (const char of str) {
    const code = char.charCodeAt(0);
    if (
      (code >= 0x3000 && code <= 0x9fff) ||
      (code >= 0xff00 && code <= 0xffef) ||
      (code >= 0xac00 && code <= 0xd7af)
    ) {
      width += 2;
    } else {
      width += 1;
    }
  }
  return width;
}

function truncateByVisualWidth(str: string, maxWidth = 10): string {
  if (getVisualWidth(str) <= maxWidth) return str;
  let width = 0;
  let result = "";
  for (const char of str) {
    const code = char.charCodeAt(0);
    const charWidth =
      (code >= 0x3000 && code <= 0x9fff) ||
      (code >= 0xff00 && code <= 0xffef) ||
      (code >= 0xac00 && code <= 0xd7af)
        ? 2
        : 1;
    if (width + charWidth > maxWidth - 1) {
      return result + "…";
    }
    result += char;
    width += charWidth;
  }
  return str;
}

/* ============================================================
 * 走者セル（左端 sticky）
 * ========================================================== */

export function RunnerCell({ player }: { player: PlayerSummary }) {
  const basket = useCompareBasket();
  const inBasket = basket.has(player.slug);
  const disabled = !inBasket && basket.isFull;
  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (disabled) return;
    basket.toggle(player.slug);
  };
  return (
    <div className="flex items-center gap-2 min-w-0 w-full">
      <Link
        to={`/player/${player.slug}`}
        className="flex items-center gap-2 hover:opacity-80 transition-opacity min-w-0 flex-1"
      >
        <MinecraftAvatar
          uuid={player.uuid}
          skinUrl={player.customSkinUrl}
          size={28}
          className="rounded-sm shrink-0"
        />
        <div className="min-w-0">
          <p className="font-medium text-sm truncate">
            {player.displayName ?? player.mcid ?? player.slug}
          </p>
        </div>
      </Link>
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled}
        aria-pressed={inBasket}
        aria-label={
          inBasket
            ? "比較バスケットから外す"
            : disabled
            ? `比較バスケットは最大 ${COMPARE_BASKET_LIMIT} 件です`
            : "比較バスケットに追加"
        }
        title={
          inBasket
            ? "比較から外す"
            : disabled
            ? `最大 ${COMPARE_BASKET_LIMIT} 件まで`
            : "比較に追加"
        }
        className={cn(
          "shrink-0 p-1 rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          inBasket
            ? "text-brand hover:bg-brand/10"
            : "text-muted-foreground/50 hover:text-foreground hover:bg-muted",
          disabled && "opacity-30 cursor-not-allowed hover:bg-transparent",
        )}
      >
        <Star
          className={cn("h-4 w-4", inBasket && "fill-brand")}
          aria-hidden
        />
      </button>
    </div>
  );
}

/* ============================================================
 * KeyBadge — 修飾キー組み合わせ対応のキー表示
 * ========================================================== */

export function KeyBadge({
  keyCode,
  keyboardLayout,
}: {
  keyCode: string;
  keyboardLayout?: string | null;
}) {
  if (isUnbound(keyCode)) {
    return <span className="text-muted-foreground/40">-</span>;
  }
  const label = keyCode.includes("+")
    ? getKeyCombinationLabel(keyCode, keyboardLayout)
    : getKeyLabel(keyCode, keyboardLayout);
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
  return label !== truncated ? <span title={label}>{badge}</span> : badge;
}

/** 行データからアクションキー1つを取り出して描画 */
export function ActionKeyCell({
  keyCode,
  keyboardLayout,
}: {
  keyCode: string | undefined;
  keyboardLayout?: string | null;
}) {
  if (!keyCode) return <span className="text-muted-foreground/40">-</span>;
  return <KeyBadge keyCode={keyCode} keyboardLayout={keyboardLayout} />;
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
};

export function RemapCell({
  remaps,
  keyboardLayout,
}: {
  remaps: RemapItem[];
  keyboardLayout?: string | null;
}) {
  if (remaps.length === 0) {
    return <span className="text-muted-foreground/40 text-sm">-</span>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {remaps.map((remap) => (
        <Badge key={remap.id} variant="secondary" className="font-mono text-xs">
          {getRemapSourceLabel(remap.sourceKey, keyboardLayout)} →{" "}
          {getRemapOutputLabel(remap, keyboardLayout)}
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
  if (customActions.length === 0) {
    return <span className="text-muted-foreground/40 text-sm">-</span>;
  }
  return (
    <div className="space-y-1.5">
      {customActions.map((action) => (
        <div key={action.id} className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="font-mono text-xs">
            {getKeyCombinationLabel(action.triggerKey, keyboardLayout)}
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
  if (config?.windowsSpeedMultiplier != null) {
    return (
      <span
        className="font-mono text-sm"
        title={t("keybindings.customMultiplier")}
      >
        x{config.windowsSpeedMultiplier.toFixed(3)}
      </span>
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
