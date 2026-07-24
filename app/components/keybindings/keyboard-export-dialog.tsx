// キーボードビューを画像（PNG）として書き出すためのダイアログ。
// 含める範囲（キーボード/テンキー/マウス）・記載内容（リマップ/指色/操作内容）・
// テーマ（ライト/ダーク/ウルトラダーク）を選んでプレビューし、html-to-image で出力する。
import { useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "next-themes";
import { Check, Copy, Download, ImageDown, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { t } from "@/lib/messages";
import {
  filterRemapsForContext,
  toUiRemaps,
  type RemapContext,
  type RemapInfo,
} from "@/lib/remap-utils";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import {
  VirtualKeyboard,
  VirtualNumpad,
  VirtualMouse,
  FingerLegend,
  keybindingsToMap,
  type FingerAssignment,
} from "@/components/virtual-keyboard";
import { MinecraftAvatar } from "@/components/minecraft-avatar";

type KeyboardLayout = "US" | "JIS" | "US_TKL" | "JIS_TKL";
type ExportTheme = "light" | "dark" | "ultra-dark";

interface KeyboardExportDialogProps {
  layout: KeyboardLayout;
  keybindings: Array<{ action: string; keyCode: string; category: string }>;
  fingerAssignments: FingerAssignment;
  /** 全リマップ（種別付き・未フィルタ）。ダイアログ内で Trigger/Chat を選んで絞り込む */
  remaps: RemapInfo[];
  /** Trigger/Chat の種別付きリマップがあるか（無ければ種別ラジオは出さない） */
  hasTypedRemaps: boolean;
  /** 種別ラジオの初期値（プロフィール側の現在表示に合わせる） */
  initialRemapContext?: RemapContext;
  /** キーボードカテゴリのカスタムキー */
  customKeys: Array<{ code: string; label: string }>;
  /** 全カスタムボタン（マウス用にカテゴリで絞り込む） */
  customButtons: Array<{ code: string; label: string; category: "mouse" | "keyboard" }>;
  isTKL: boolean;
  /** 走者情報ブロック（アバター・名前・MCID）の描画とファイル名に使用 */
  player: {
    uuid: string | null;
    skinUrl: string | null;
    mcid: string | null;
    displayName: string | null;
    slug: string;
  };
}

const THEME_CLASS: Record<ExportTheme, string> = {
  light: "light",
  dark: "dark",
  "ultra-dark": "ultra-dark",
};

export function KeyboardExportDialog({
  layout,
  keybindings,
  fingerAssignments,
  remaps,
  hasTypedRemaps,
  initialRemapContext = "trigger",
  customKeys,
  customButtons,
  isTKL,
  player,
}: KeyboardExportDialogProps) {
  const { resolvedTheme } = useTheme();
  const previewRef = useRef<HTMLDivElement>(null);

  const playerName = player.displayName ?? player.mcid ?? player.slug;

  const [open, setOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [copying, setCopying] = useState(false);
  const [copied, setCopied] = useState(false);
  // クリップボードへの画像書き込みが使えるか（非対応ブラウザではコピーボタンを出さない）
  const [canCopy, setCanCopy] = useState(false);
  useEffect(() => {
    setCanCopy(
      typeof navigator !== "undefined" &&
        !!navigator.clipboard &&
        typeof window !== "undefined" &&
        typeof window.ClipboardItem !== "undefined",
    );
  }, []);

  // 含める範囲
  const [includePlayer, setIncludePlayer] = useState(true);
  const [includeKeyboard, setIncludeKeyboard] = useState(true);
  const [includeNumpad, setIncludeNumpad] = useState(!isTKL);
  const [includeMouse, setIncludeMouse] = useState(true);

  // 記載内容
  const [showRemaps, setShowRemaps] = useState(true);
  const [showFingers, setShowFingers] = useState(true);
  const [showActions, setShowActions] = useState(true);
  // リマップの種別（Trigger/Chat）。種別付きリマップがある場合のみラジオで選べる
  const [remapContext, setRemapContext] = useState<RemapContext>(initialRemapContext);

  // テーマ
  const [exportTheme, setExportTheme] = useState<ExportTheme>("dark");

  const kbMap = useMemo(() => keybindingsToMap(keybindings), [keybindings]);
  // 選択中の種別で絞り込み、表示用形式に変換（プロフィール本体と同じ扱い）
  const remapsForExport = useMemo(
    () => toUiRemaps(filterRemapsForContext(remaps, remapContext)),
    [remaps, remapContext],
  );

  // TKL ではテンキーを出力対象にしない
  const numpadAvailable = !isTKL;
  const numpadSelected = numpadAvailable && includeNumpad;
  const hasDeviceSelection = includeKeyboard || numpadSelected || includeMouse;
  // 指の色を出すときは凡例も表示（キー/ボタンが1つも無ければ凡例も不要）
  const showLegend = showFingers && hasDeviceSelection;
  const hasSelection = hasDeviceSelection || includePlayer;

  const handleOpenChange = (next: boolean) => {
    // 開くたびに現在のアプリテーマ・種別表示を初期選択にする
    if (next) {
      const rt = resolvedTheme;
      if (rt === "light" || rt === "dark" || rt === "ultra-dark") {
        setExportTheme(rt);
      }
      setRemapContext(initialRemapContext);
    }
    setOpen(next);
  };

  const handleExport = async () => {
    const node = previewRef.current;
    if (!node || !hasSelection) return;
    setExporting(true);
    try {
      // html-to-image はキーボードエクスポート時にのみ必要な重量ライブラリのため、
      // 初回ロードの共通チャンクに含めず動的importで取得する
      const { toPng } = await import("html-to-image");
      const dataUrl = await toPng(node, { pixelRatio: 2, cacheBust: true });
      const safeName = (playerName || "keybindings").replace(/[\\/:*?"<>|]+/g, "_");
      const link = document.createElement("a");
      link.download = `${safeName}_keybindings_${exportTheme}.png`;
      link.href = dataUrl;
      link.click();
      toast.success(t("playerProfile.exportSuccess"));
    } catch (err) {
      console.error("keyboard image export failed:", err);
      toast.error(t("playerProfile.exportError"));
    } finally {
      setExporting(false);
    }
  };

  const handleCopy = async () => {
    const node = previewRef.current;
    if (!node || !hasSelection) return;
    setCopying(true);
    try {
      const { toBlob } = await import("html-to-image");
      const blob = await toBlob(node, { pixelRatio: 2, cacheBust: true });
      if (!blob) throw new Error("toBlob returned null");
      await navigator.clipboard.write([
        new ClipboardItem({ [blob.type]: blob }),
      ]);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.success(t("playerProfile.exportCopySuccess"));
    } catch (err) {
      console.error("keyboard image copy failed:", err);
      toast.error(t("playerProfile.exportCopyError"));
    } finally {
      setCopying(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <ImageDown className="h-4 w-4" />
          {t("playerProfile.exportImage")}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("playerProfile.exportDialogTitle")}</DialogTitle>
          <DialogDescription>{t("playerProfile.exportDialogDesc")}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
          {/* コントロール */}
          <div className="space-y-5">
            {/* 含める範囲 */}
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium mb-2">
                {t("playerProfile.exportRange")}
              </legend>
              <CheckboxRow
                id="range-player"
                label={t("playerProfile.exportRangePlayer")}
                checked={includePlayer}
                onCheckedChange={setIncludePlayer}
              />
              <CheckboxRow
                id="range-keyboard"
                label={t("playerProfile.exportRangeKeyboard")}
                checked={includeKeyboard}
                onCheckedChange={setIncludeKeyboard}
              />
              {numpadAvailable && (
                <CheckboxRow
                  id="range-numpad"
                  label={t("playerProfile.exportRangeNumpad")}
                  checked={includeNumpad}
                  onCheckedChange={setIncludeNumpad}
                />
              )}
              <CheckboxRow
                id="range-mouse"
                label={t("playerProfile.exportRangeMouse")}
                checked={includeMouse}
                onCheckedChange={setIncludeMouse}
              />
            </fieldset>

            <Separator />

            {/* 記載内容 */}
            <fieldset className="space-y-3">
              <legend className="text-sm font-medium mb-2">
                {t("playerProfile.exportContent")}
              </legend>
              <SwitchRow
                id="content-remaps"
                label={t("playerProfile.exportContentRemaps")}
                checked={showRemaps}
                onCheckedChange={setShowRemaps}
              />
              {/* リマップの種別（Trigger/Chat）。種別付きリマップがあり、リマップ表示中のみ */}
              {hasTypedRemaps && showRemaps && (
                <div className="ml-1 space-y-1.5 border-l pl-3">
                  <p className="text-xs text-muted-foreground">
                    {t("playerProfile.exportRemapType")}
                  </p>
                  <RadioGroup
                    value={remapContext}
                    onValueChange={(v) => setRemapContext(v as RemapContext)}
                    className="gap-1.5"
                  >
                    <RadioRow
                      id="remap-trigger"
                      value="trigger"
                      label={t("remapType.trigger")}
                    />
                    <RadioRow id="remap-chat" value="chat" label={t("remapType.chat")} />
                  </RadioGroup>
                </div>
              )}
              <SwitchRow
                id="content-fingers"
                label={t("playerProfile.exportContentFingers")}
                checked={showFingers}
                onCheckedChange={setShowFingers}
              />
              <SwitchRow
                id="content-actions"
                label={t("playerProfile.exportContentActions")}
                checked={showActions}
                onCheckedChange={setShowActions}
              />
            </fieldset>

            <Separator />

            {/* テーマ */}
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium mb-2">
                {t("playerProfile.exportTheme")}
              </legend>
              <RadioGroup
                value={exportTheme}
                onValueChange={(v) => setExportTheme(v as ExportTheme)}
                className="gap-2"
              >
                <RadioRow
                  id="theme-light"
                  value="light"
                  label={t("playerProfile.exportThemeLight")}
                />
                <RadioRow
                  id="theme-dark"
                  value="dark"
                  label={t("playerProfile.exportThemeDark")}
                />
                <RadioRow
                  id="theme-ultra-dark"
                  value="ultra-dark"
                  label={t("playerProfile.exportThemeUltraDark")}
                />
              </RadioGroup>
            </fieldset>
          </div>

          {/* プレビュー（このノードを画像化する） */}
          <div className="overflow-auto rounded-lg border bg-muted/40 p-3 max-h-[60vh]">
            <div
              ref={previewRef}
              className={cn(
                THEME_CLASS[exportTheme],
                // プレビューは静的表示（キーのツールチップ等を誤って開かせない）。
                // 画像化は DOM を読むだけなので pointer-events には影響されない。
                "inline-block rounded-lg bg-background text-foreground p-6 pointer-events-none",
              )}
            >
              <div className="flex flex-col items-start gap-4">
                {/* 走者情報（アバター・名前・MCID） */}
                {includePlayer && (
                  <div className="flex items-center gap-3">
                    <MinecraftAvatar
                      uuid={player.uuid}
                      skinUrl={player.skinUrl}
                      mcid={player.mcid}
                      size={48}
                      className="rounded-md shrink-0"
                    />
                    <div className="min-w-0">
                      <p className="font-bold text-base leading-tight">{playerName}</p>
                      {player.mcid && (
                        <p className="text-sm text-muted-foreground leading-tight">
                          @{player.mcid}
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {/* 指の色の凡例（指の色を表示する場合のみ） */}
                {showLegend && <FingerLegend />}

                {includeKeyboard && (
                  <VirtualKeyboard
                    layout={layout}
                    keybindings={kbMap}
                    fingerAssignments={fingerAssignments}
                    remaps={remapsForExport}
                    customKeys={customKeys}
                    showActionLabels={showActions}
                    showFingerAssignments={showFingers}
                    showRemaps={showRemaps}
                    hideNumpad
                  />
                )}
                {(numpadSelected || includeMouse) && (
                  <div className="flex items-start gap-6">
                    {numpadSelected && (
                      <VirtualNumpad
                        keybindings={kbMap}
                        fingerAssignments={fingerAssignments}
                        remaps={remapsForExport}
                        showActionLabels={showActions}
                        showFingerAssignments={showFingers}
                        showRemaps={showRemaps}
                      />
                    )}
                    {includeMouse && (
                      <VirtualMouse
                        keybindings={kbMap}
                        fingerAssignments={fingerAssignments}
                        remaps={remapsForExport}
                        customButtons={customButtons}
                        showActionLabels={showActions}
                        showFingerAssignments={showFingers}
                        showRemaps={showRemaps}
                      />
                    )}
                  </div>
                )}
                {!hasSelection && (
                  <p className="text-sm text-muted-foreground">
                    {t("playerProfile.exportEmpty")}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">{t("common.close")}</Button>
          </DialogClose>
          {canCopy && (
            <Button
              variant="outline"
              onClick={handleCopy}
              disabled={!hasSelection || copying || exporting}
              className="gap-1.5"
            >
              {copying ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : copied ? (
                <Check className="h-4 w-4 text-green-500" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
              {t("playerProfile.exportCopy")}
            </Button>
          )}
          <Button
            onClick={handleExport}
            disabled={!hasSelection || exporting || copying}
            className="gap-1.5"
          >
            {exporting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            {t("playerProfile.exportDownload")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CheckboxRow({
  id,
  label,
  checked,
  onCheckedChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(v) => onCheckedChange(v === true)}
      />
      <Label htmlFor={id} className="text-sm font-normal cursor-pointer">
        {label}
      </Label>
    </div>
  );
}

function SwitchRow({
  id,
  label,
  checked,
  onCheckedChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <Label htmlFor={id} className="text-sm font-normal cursor-pointer">
        {label}
      </Label>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}

function RadioRow({ id, value, label }: { id: string; value: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <RadioGroupItem id={id} value={value} />
      <Label htmlFor={id} className="text-sm font-normal cursor-pointer">
        {label}
      </Label>
    </div>
  );
}
