// /keybindings の TanStack Table 用セル部品。
// 旧 keybindings.tsx の PlayerRow / RemapRow / CustomActionListRow / MouseSettingsRow を
// セル単位に分解し、再利用可能にしたもの。
import { Link } from "react-router";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { HintTip } from "@/components/hint-tip";
import { MinecraftAvatar } from "@/components/minecraft-avatar";
import { SensitivityWarning } from "@/components/sensitivity-warning";
import { MissingMouseValue, WinSensValue } from "@/components/mouse-setting-values";
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
  isValidSensitivity,
  toSensitivityPercent,
} from "@/lib/mouse-settings";
import {
  cm360MissingReasons,
  cursorSpeedMissingReasons,
} from "@/lib/mouse-settings-reasons";
import { truncateByVisualWidth } from "@/lib/text-width";
import { useT, useLocale } from "@/hooks/use-locale";
import { getLocalizedDisplayName } from "@/lib/slug";

/** マウスキーバッジの強調スタイル（KeyBadge / stats-view で共有） */
export const MOUSE_KEY_BADGE_CLASS = "bg-info/10 text-info border-info/20";

/** 走者列の最小データ */
export type PlayerSummary = {
  slug: string;
  mcid: string | null;
  uuid: string | null;
  displayName: string | null;
  displayNameAlphabet?: string | null;
  customSkinUrl: string | null;
};


/**
 * 空のセルの印。見える「-」は読み上げさせず（aria-hidden）、代わりに sr-only で意味を伝える。
 * 色は muted-foreground のまま（薄くしすぎると背景に対して約 2:1 まで落ちて読めない）。
 * - key: キーが未割り当て　- value: マウスの値が未設定　- none: リマップ・カスタムアクションが無い
 */
export function EmptyMark({
  kind,
  className,
}: {
  kind: "key" | "value" | "none";
  className?: string;
}) {
  const t = useT();
  const label =
    kind === "key"
      ? t("keybindings.unassigned")
      : kind === "value"
        ? t("keybindings.notSet")
        : t("keybindings.noneValue");
  return (
    <span className={cn("text-muted-foreground", className)}>
      <span aria-hidden>-</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

/* ============================================================
 * 走者セル（左端 sticky）
 * ========================================================== */

export function RunnerCell({ player }: { player: PlayerSummary }) {
  const locale = useLocale();
  const name = getLocalizedDisplayName(player, locale);

  // md 未満は縦並び（頭を大きめ＋名前を下に小さく）、md 以上は横並び。幅で描き分けずに
  // 両方の頭を描いて CSS で出し分ける（SSR とずれない）。名前が隣にあるので alt は空
  return (
    <Link
      to={`/player/${player.slug}`}
      className="flex w-full min-w-0 flex-col items-center gap-1 text-center transition-opacity hover:opacity-80 md:flex-row md:gap-2 md:text-left"
    >
      <MinecraftAvatar
        uuid={player.uuid}
        skinUrl={player.customSkinUrl}
        size={40}
        alt=""
        className="shrink-0 rounded-xl md:hidden"
      />
      <MinecraftAvatar
        uuid={player.uuid}
        skinUrl={player.customSkinUrl}
        size={32}
        alt=""
        className="hidden shrink-0 rounded-lg md:block"
      />
      <span className="w-full min-w-0 truncate text-xs font-medium leading-snug md:text-sm">
        {name}
      </span>
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
  maxWidth = 10,
}: {
  keyCode: string;
  keyboardLayout?: string | null;
  /** カスタムキー keyCode → 表示名。標準ラベルより優先して使用する。 */
  customKeyNames?: Record<string, string>;
  /** 表示幅（全角=2）の上限。超えると省略し、全文は HintTip（フォーカス・タップ）で届ける */
  maxWidth?: number;
}) {
  const t = useT();
  if (isUnbound(keyCode)) {
    return <EmptyMark kind="key" />;
  }
  // カスタムキー名があれば最優先（正規化前後どちらの keyCode でも引けるようにする）
  const customName =
    customKeyNames?.[keyCode] ?? customKeyNames?.[normalizeKeyCode(keyCode)];
  const label =
    customName ??
    (keyCode.includes("+")
      ? getKeyCombinationLabel(t, keyCode, keyboardLayout)
      : getKeyLabel(t, keyCode, keyboardLayout));
  const truncated = truncateByVisualWidth(label, maxWidth);
  const isMouse =
    keyCode.startsWith("Mouse") || keyCode.toLowerCase().includes("mouse");

  // 文字入力キーは角の小さい rounded の四角（ui.md 7 章。search-craft-badges の KeyBadge と同じ語彙）。
  // マウスボタンだけ info 色を残す
  const badge = (
    <span
      className={cn(
        "inline-flex h-6 min-w-6 max-w-full items-center justify-center overflow-hidden rounded border border-border/50 bg-secondary/50 px-1.5 font-mono text-xs",
        isMouse && MOUSE_KEY_BADGE_CLASS,
      )}
    >
      {truncated}
    </span>
  );
  // 省略したときは、アクセシブルネームに全文を入れたボタン（キーボード・タップでも全文が届く）
  return label !== truncated ? <HintTip message={label}>{badge}</HintTip> : badge;
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
  if (!keyCode) return <EmptyMark kind="key" />;
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
    return <EmptyMark kind="key" />;
  }

  return (
    // スロットの幅は全行で同じ（グリッドの列）にして、1〜9 の縦位置をそろえる。md 未満は 5 + 4 の 2 段。
    // 長いラベルは省略し、全文は KeyBadge の HintTip で届ける
    <div className="grid w-full grid-cols-5 gap-x-1 gap-y-1.5 md:grid-cols-9">
      {slots.map(({ n, keyCode }) => (
        <span key={n} className="inline-flex min-w-0 flex-col items-center gap-0.5">
          <span className="text-[10px] leading-none text-muted-foreground">{n}</span>
          {keyCode ? (
            <KeyBadge
              keyCode={keyCode}
              keyboardLayout={keyboardLayout}
              customKeyNames={customKeyNames}
              maxWidth={4}
            />
          ) : (
            <EmptyMark kind="key" className="px-1 text-xs" />
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
    return <EmptyMark kind="none" className="text-sm" />;
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
    return <EmptyMark kind="none" className="text-sm" />;
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
    return <EmptyMark kind="value" />;
  }
  return <span className="font-mono text-sm">{config.mouseDpi}</span>;
}

export function SensitivityCell({ config }: { config: MouseConfig }) {
  const display = toSensitivityPercent(config?.gameSensitivity);
  if (display == null) {
    return <EmptyMark kind="value" />;
  }
  // 有効範囲外（内部値 0..1 = 表示 0..200% の外）は値を出しつつ理由を警告表示する。
  // 振り向きは計算されず、統計の集計からも外れ、ソートでも未設定として扱われる。
  if (!isValidSensitivity(config?.gameSensitivity)) {
    return <SensitivityWarning percent={display} />;
  }
  return (
    <span className="font-mono text-sm">
      {display}
      <span className="text-muted-foreground">%</span>
    </span>
  );
}

export function Cm360Cell({ config }: { config: MouseConfig }) {
  const t = useT();
  if (config == null) {
    return <EmptyMark kind="value" />;
  }
  const cm360 = calculateCm360(
    config.mouseDpi,
    config.gameSensitivity,
    config.rawInput,
    config.windowsSpeed,
    config.windowsSpeedMultiplier,
  );
  if (cm360 == null) {
    return <MissingMouseValue reasons={cm360MissingReasons(t, config)} className="text-sm" />;
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
    return <WinSensValue windowsSpeed={config.windowsSpeed} className="font-mono text-sm" />;
  }
  return <EmptyMark kind="value" />;
}

export function CursorSpeedCell({ config }: { config: MouseConfig }) {
  const t = useT();
  if (config == null) {
    return <EmptyMark kind="value" />;
  }
  const cursor = calculateCursorSpeed(
    config.mouseDpi,
    config.windowsSpeed,
    config.windowsSpeedMultiplier,
  );
  if (cursor == null) {
    return (
      <MissingMouseValue reasons={cursorSpeedMissingReasons(t, config)} className="text-sm" />
    );
  }
  return (
    <span className="font-mono text-sm">
      {cursor}
      <span className="text-muted-foreground">DPI</span>
    </span>
  );
}

// ON / OFF はどちらも同じ見た目（文字だけで区別する）。設定値に優劣の色を付けない（走者の自由な選択のため）
export function RawInputCell({ config }: { config: MouseConfig }) {
  if (config?.rawInput == null) {
    return <EmptyMark kind="value" />;
  }
  return (
    <Badge variant="secondary" className="text-xs">
      {config.rawInput ? "ON" : "OFF"}
    </Badge>
  );
}

export function AccelerationCell({ config }: { config: MouseConfig }) {
  if (config?.mouseAcceleration == null) {
    return <EmptyMark kind="value" />;
  }
  return (
    <Badge variant="secondary" className="text-xs">
      {config.mouseAcceleration ? "ON" : "OFF"}
    </Badge>
  );
}
