import { type ReactNode } from "react";
import {
  ArrowBigUp,
  ChevronUp,
  Command,
  Footprints,
  LayoutGrid,
  Option,
  Package,
  Swords,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useMediaQuery } from "@/hooks/use-media-query";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  getActionLabel,
  getKeyLabel,
  parseKeyCombination,
  FINGER_LABELS,
  type FingerType,
} from "@/lib/keybindings";
import {
  isSpecialRemapTarget,
  type RemapInfo,
} from "@/lib/remap-utils";
import { RemapTypeBadge } from "@/components/remap-type-badge";

// 修飾キーの lucide アイコン（VirtualKeyboard 本体と同一マップ）
const MODIFIER_ICON_MAP: Record<string, LucideIcon> = {
  Ctrl: ChevronUp,
  Shift: ArrowBigUp,
  Alt: Option,
  Meta: Command,
};

// キーバインドカテゴリのアイコン（操作の種類を示す）
const CATEGORY_ICON_MAP: Record<string, LucideIcon> = {
  movement: Footprints,
  combat: Swords,
  inventory: Package,
  ui: LayoutGrid,
};

// カテゴリ色（CSS 変数 --key-* を直接インライン参照）。
const CATEGORY_COLOR_STYLE: Record<string, React.CSSProperties> = {
  movement: { color: "var(--key-movement)" },
  combat: { color: "var(--key-combat)" },
  inventory: { color: "var(--key-inventory)" },
  ui: { color: "var(--key-ui)" },
};

// 指割り当ての色 dot
const FINGER_DOT_CLASS: Record<FingerType, string> = {
  "left-pinky": "bg-finger-pinky",
  "left-ring": "bg-finger-ring",
  "left-middle": "bg-finger-middle",
  "left-index": "bg-finger-index",
  "left-thumb": "bg-finger-thumb",
  "right-thumb": "bg-finger-thumb",
  "right-index": "bg-finger-index",
  "right-middle": "bg-finger-middle",
  "right-ring": "bg-finger-ring",
  "right-pinky": "bg-finger-pinky",
};

export type KeyInfoBinding = {
  action: string;
  category?: string;
};

export type KeyInfoCustomAction = {
  /** ユーザー定義のアクション名（例: "DPIスイッチ"） */
  actionName: string;
  /** トリガーキー（修飾キー組み合わせ可: "Ctrl+KeyX"） */
  triggerKey: string;
  /** アクションの説明（任意） */
  description?: string | null;
  /** カテゴリ: other / macro / tool */
  category?: string;
};

export type KeyInfoData = {
  /** 表示するキー名（カスタムキーは登録名、通常キーは getKeyLabel の結果） */
  title: string;
  /** このキーに割り当てられた操作の配列 */
  bindings?: KeyInfoBinding[];
  /** このキーに関わるリマップ（複数対応） */
  remaps?: RemapInfo[];
  /** このキーをトリガーとするカスタムアクション（複数対応） */
  customActions?: KeyInfoCustomAction[];
  /** 指割り当て */
  finger?: FingerType;
  /** キーボードレイアウト（JIS/US 判定用） */
  layout?: string | null;
};

// カスタムアクションのカテゴリ表示ラベル（本ファイルは日本語ハードコード方針に合わせる）
const CUSTOM_ACTION_CATEGORY_LABELS: Record<string, string> = {
  other: "その他",
  macro: "マクロ",
  tool: "ツール",
};

/** キーコンビネーション（例: Shift+KeyA）をアイコン chip 列にレンダリング */
function KeyComboChips({
  combo,
  layout,
}: {
  combo: string;
  layout?: string | null;
}) {
  const parsed = parseKeyCombination(combo);
  const baseLabel = getKeyLabel(parsed.keyCode, layout ?? null);
  return (
    <span className="inline-flex items-center gap-0.5">
      {parsed.modifiers.map((m, i) => {
        const Icon = MODIFIER_ICON_MAP[m];
        return (
          <kbd
            key={i}
            className="inline-flex items-center justify-center min-w-5 h-5 px-1 bg-secondary rounded text-[11px] font-mono"
          >
            {Icon ? <Icon className="h-3 w-3" strokeWidth={2.5} /> : m}
          </kbd>
        );
      })}
      <kbd className="inline-flex items-center justify-center min-w-5 h-5 px-1 bg-secondary rounded text-[11px] font-mono">
        {baseLabel}
      </kbd>
    </span>
  );
}

function RemapRow({
  remap,
  layout,
}: {
  remap: RemapInfo;
  layout?: string | null;
}) {
  const isDisabled = remap.targetKey === null;
  return (
    <div className="space-y-0.5">
      <div className="flex flex-wrap items-center gap-1 text-xs">
        <KeyComboChips combo={remap.sourceKey} layout={layout} />
        <span className="text-muted-foreground">→</span>
        {isDisabled ? (
          <span className="text-muted-foreground italic">無効化</span>
        ) : remap.targetKey && isSpecialRemapTarget(remap.targetKey) ? (
          <kbd className="inline-flex items-center justify-center px-1 h-5 bg-secondary rounded text-[11px] font-mono">
            <span className="text-muted-foreground/50">「</span>
            {remap.targetKey}
            <span className="text-muted-foreground/50">」</span>
          </kbd>
        ) : remap.targetKey ? (
          <KeyComboChips combo={remap.targetKey} layout={layout} />
        ) : null}
        <RemapTypeBadge remapType={remap.remapType} className="ml-1" />
      </div>
      {(remap.software || remap.notes) && (
        <div className="ml-1 space-y-0.5">
          {remap.software && (
            <p className="text-[10px] text-muted-foreground">
              ツール: {remap.software}
            </p>
          )}
          {remap.notes && (
            <p className="text-[10px] text-muted-foreground">{remap.notes}</p>
          )}
        </div>
      )}
    </div>
  );
}

/** Tooltip と Dialog で共有する Body 部分（タイトル含めない） */
function KeyInfoBody({ info }: { info: KeyInfoData }) {
  const { bindings = [], remaps = [], customActions = [], finger, layout = null } = info;
  return (
    <div className="space-y-2 text-foreground">
      {remaps.length > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] font-semibold text-muted-foreground/80 uppercase tracking-wider">
            リマップ
          </p>
          <div className="space-y-1.5">
            {remaps.map((r, i) => (
              <RemapRow key={i} remap={r} layout={layout} />
            ))}
          </div>
        </div>
      )}
      {bindings.length > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] font-semibold text-muted-foreground/80 uppercase tracking-wider">
            操作
          </p>
          <div className="space-y-0.5">
            {bindings.map((b, i) => {
              const CategoryIcon = b.category ? CATEGORY_ICON_MAP[b.category] : undefined;
              const colorStyle = b.category ? CATEGORY_COLOR_STYLE[b.category] : undefined;
              return (
                <div key={i} className="flex items-center gap-1.5 text-xs">
                  {CategoryIcon && (
                    <CategoryIcon
                      className="h-3.5 w-3.5 shrink-0"
                      style={colorStyle}
                      strokeWidth={2.25}
                      aria-hidden
                    />
                  )}
                  <span>{getActionLabel(b.action)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {customActions.length > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] font-semibold text-muted-foreground/80 uppercase tracking-wider">
            カスタムアクション
          </p>
          <div className="space-y-1.5">
            {customActions.map((ca, i) => {
              const categoryLabel = ca.category
                ? CUSTOM_ACTION_CATEGORY_LABELS[ca.category]
                : undefined;
              return (
                <div key={i} className="space-y-0.5">
                  <div className="flex flex-wrap items-center gap-1 text-xs">
                    <KeyComboChips combo={ca.triggerKey} layout={layout} />
                    <span className="text-muted-foreground">→</span>
                    <span className="font-medium">{ca.actionName}</span>
                    {categoryLabel && (
                      <span className="text-[10px] text-muted-foreground">
                        ({categoryLabel})
                      </span>
                    )}
                  </div>
                  {ca.description && (
                    <p className="ml-1 text-[10px] text-muted-foreground whitespace-pre-line">
                      {ca.description}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
      {finger && (
        <div className="flex items-center gap-1.5 text-xs pt-1 border-t border-border/40">
          <span
            className={cn(
              "inline-block w-2 h-2 rounded-full",
              FINGER_DOT_CLASS[finger],
            )}
            aria-hidden
          />
          <span className="text-muted-foreground">
            指: {FINGER_LABELS[finger]}
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * キー要素をラップし、デスクトップでは Tooltip、モバイル（< md）では Dialog でキー情報を表示する。
 *
 * - 情報がない (`bindings` も `remaps` も `customActions` も `finger` も空) かつ `alwaysShow=false` の場合は素通し。
 * - `alwaysShow=true` のときは情報が無くてもタイトルだけの Tooltip/Dialog を出す（カスタムキー用）。
 */
export function KeyInfoTrigger({
  children,
  info,
  alwaysShow = false,
}: {
  children: ReactNode;
  info: KeyInfoData;
  alwaysShow?: boolean;
}) {
  const hasInfo =
    (info.bindings?.length ?? 0) > 0 ||
    (info.remaps?.length ?? 0) > 0 ||
    (info.customActions?.length ?? 0) > 0 ||
    !!info.finger;

  // SSR ではデスクトップとして扱い、ハイドレーション後にモバイルなら Dialog に切替
  const isMobile = useMediaQuery("(max-width: 767px)", false);

  if (!alwaysShow && !hasInfo) return <>{children}</>;

  if (isMobile) {
    return (
      <Dialog>
        <DialogTrigger asChild>{children}</DialogTrigger>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base">{info.title}</DialogTitle>
          </DialogHeader>
          <KeyInfoBody info={info} />
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent className="p-3 max-w-xs">
        <p className="font-semibold text-sm mb-2">{info.title}</p>
        <KeyInfoBody info={info} />
      </TooltipContent>
    </Tooltip>
  );
}
