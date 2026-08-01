import { useState, useMemo, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RemapRow, DialogRemapRow } from "@/components/remap-row";
import { keyCaptureEscapeGuard } from "@/components/key-capture-button";
import { VirtualKeyboard } from "@/components/virtual-keyboard";
import {
  SearchCraftListEditor,
  arrayMove,
  type SearchCraftDraft,
} from "@/components/search-craft-editor";
import {
  simulateRemapOutput,
  type RemapInfo,
  type SimulatedKeyOutput,
} from "@/lib/remap-utils";
import { getKeyLabel, parseKeyCombination } from "@/lib/keybindings";
import { draftId } from "@/lib/search-craft-templates";
import { useT } from "@/hooks/use-locale";
import { Eraser, Keyboard, Plus } from "lucide-react";

/**
 * サーチクラフト×キーリマップの編集ワークベンチ。
 * /playground とテンプレートエディタ（作成・編集）で同一構成を共有する:
 * バーチャルキーボード（キークリックでリマップ登録）→ キーリマップ編集 → サーチクラフト編集。
 * タイピングテストはバーチャルキーボードカードのヘッダーにあるボタンから開くモーダル
 */

export type WorkbenchRemap = {
  id: string;
  sourceKey: string;
  // null = 無効、キーコード = キー出力、それ以外の文字列 = 文字出力、"" = 入力待ち
  targetKey: string | null;
};

export type KeyboardLayoutOption = "US" | "JIS" | "US_TKL" | "JIS_TKL";

export const LAYOUT_OPTIONS: KeyboardLayoutOption[] = ["US", "JIS", "US_TKL", "JIS_TKL"];

export function normalizeLayout(value: string | null | undefined): KeyboardLayoutOption {
  return LAYOUT_OPTIONS.includes(value as KeyboardLayoutOption)
    ? (value as KeyboardLayoutOption)
    : "US";
}

/** 計算に使う有効なリマップ（未入力の行は除外、sourceKey 重複は先勝ち） */
export function effectiveRemapsFrom(remaps: WorkbenchRemap[]): RemapInfo[] {
  const seen = new Set<string>();
  const result: RemapInfo[] = [];
  for (const remap of remaps) {
    if (!remap.sourceKey) continue;
    if (remap.targetKey === "") continue; // 変更先が入力待ちの行
    if (seen.has(remap.sourceKey)) continue;
    seen.add(remap.sourceKey);
    result.push({ sourceKey: remap.sourceKey, targetKey: remap.targetKey });
  }
  return result;
}

// ============================================
// タイピングテスト
// ============================================

function TypingTestArea({ remaps }: { remaps: RemapInfo[] }) {
  const t = useT();
  const [entries, setEntries] = useState<SimulatedKeyOutput[]>([]);
  const [isFocused, setIsFocused] = useState(false);

  // 解決結果を反映する。Backspace（物理キー・またはBackspaceにリマップされたキー）は
  // 直前の入力を1つ削除する。それ以外は履歴に追加する
  const applyResult = useCallback((result: SimulatedKeyOutput) => {
    if (result.outputKeyCode === "Backspace") {
      setEntries((prev) => prev.slice(0, -1));
    } else {
      setEntries((prev) => [...prev, result]);
    }
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) {
        // 修飾キー単独のリマップ（例: ShiftLeft → KeyE）だけを処理する
        const result = simulateRemapOutput(t, e.code, remaps);
        if (result.isRemapped) {
          e.preventDefault();
          applyResult(result);
        }
        return;
      }
      if (e.key === "Escape") {
        (e.target as HTMLElement).blur();
        return;
      }
      e.preventDefault();

      const modifiers: string[] = [];
      if (e.ctrlKey) modifiers.push("Ctrl");
      if (e.shiftKey) modifiers.push("Shift");
      if (e.altKey) modifiers.push("Alt");
      if (e.metaKey) modifiers.push("Meta");
      const combo = modifiers.length > 0 ? [...modifiers, e.code].join("+") : e.code;

      applyResult(simulateRemapOutput(t, combo, remaps));
    },
    [remaps, applyResult],
  );

  const outputText = entries.map((entry) => entry.output ?? "").join("");

  return (
    <div className="space-y-3">
      <div
        tabIndex={0}
        role="textbox"
        aria-label={t("playground.typingTestAria")}
        onKeyDown={handleKeyDown}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        className={`min-h-24 rounded-lg border-2 border-dashed p-4 cursor-text transition-colors focus:outline-none ${
          isFocused ? "border-primary bg-primary/5" : "border-border bg-secondary/20"
        }`}
      >
        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {isFocused ? t("playground.typingTestReady") : t("playground.typingTestPlaceholder")}
          </p>
        ) : (
          <div className="space-y-3">
            <div>
              <p className="text-xs text-muted-foreground mb-1">
                {t("playground.typingTestOutput")}
              </p>
              <p className="font-mono text-lg break-all">
                {outputText || "—"}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">
                {t("playground.typingTestPressed")}
              </p>
              <div className="flex flex-wrap gap-1">
                {entries.map((entry, idx) => (
                  <kbd
                    key={idx}
                    className={
                      entry.isRemapped
                        ? "px-1.5 py-0.5 rounded border border-primary/40 bg-primary/15 text-primary font-mono text-xs"
                        : "px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground font-mono text-xs"
                    }
                  >
                    {entry.pressedLabel}
                  </kbd>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
      <Button
        variant="outline"
        size="sm"
        disabled={entries.length === 0}
        onClick={() => setEntries([])}
      >
        <Eraser className="mr-2 h-4 w-4" />
        {t("playground.clearTypingTest")}
      </Button>
    </div>
  );
}

// ============================================
// ワークベンチ本体
// ============================================

export function SearchCraftWorkbench({
  crafts,
  onCraftsChange,
  remaps,
  onRemapsChange,
  layout,
  onLayoutChange,
}: {
  crafts: SearchCraftDraft[];
  onCraftsChange: (next: SearchCraftDraft[]) => void;
  remaps: WorkbenchRemap[];
  onRemapsChange: (next: WorkbenchRemap[]) => void;
  layout: KeyboardLayoutOption;
  onLayoutChange: (layout: KeyboardLayoutOption) => void;
}) {
  const t = useT();
  const effectiveRemaps = useMemo(() => effectiveRemapsFrom(remaps), [remaps]);

  const updateRemapAt = useCallback(
    (index: number, updates: Partial<WorkbenchRemap>) => {
      onRemapsChange(remaps.map((r, i) => (i === index ? { ...r, ...updates } : r)));
    },
    [remaps, onRemapsChange],
  );

  const deleteRemapAt = useCallback(
    (index: number) => {
      onRemapsChange(remaps.filter((_, i) => i !== index));
    },
    [remaps, onRemapsChange],
  );

  // バーチャルキーボードのキークリック → リマップ登録モーダル
  const [editingKeyCode, setEditingKeyCode] = useState<string | null>(null);

  // タイピングテストモーダル
  const [typingTestOpen, setTypingTestOpen] = useState(false);

  const selectedKeyRemaps = useMemo(() => {
    if (!editingKeyCode) return [];
    return remaps
      .map((r, index) => ({ ...r, _index: index }))
      .filter((r) => parseKeyCombination(r.sourceKey).keyCode === editingKeyCode);
  }, [editingKeyCode, remaps]);

  return (
    <>
      {/* バーチャルキーボード */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="text-lg">{t("playground.keyboardSection")}</CardTitle>
              <CardDescription>{t("playground.keyboardSectionDescription")}</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setTypingTestOpen(true)}>
                <Keyboard className="mr-2 h-4 w-4" />
                {t("playground.typingTestSection")}
              </Button>
              <Select value={layout} onValueChange={(v) => onLayoutChange(v as KeyboardLayoutOption)}>
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LAYOUT_OPTIONS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option.replace("_", " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <VirtualKeyboard
            layout={layout}
            keybindings={{}}
            remaps={effectiveRemaps}
            onKeyClick={setEditingKeyCode}
            showRemaps
            hideNumpad
          />
        </CardContent>
      </Card>

      {/* リマップエディタ */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t("playground.remapSection")}</CardTitle>
          <CardDescription>{t("playground.remapSectionDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          {remaps.length > 0 ? (
            <div className="divide-y border-y">
              {remaps.map((remap, index) => (
                <RemapRow
                  key={remap.id}
                  remap={remap}
                  index={index}
                  keyboardLayout={layout}
                  onUpdate={updateRemapAt}
                  onDelete={deleteRemapAt}
                />
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">
              {t("playground.noRemaps")}
            </p>
          )}
          <Button
            variant="outline"
            size="sm"
            className="mt-4"
            onClick={() =>
              onRemapsChange([
                ...remaps,
                { id: draftId("remap"), sourceKey: "", targetKey: null },
              ])
            }
          >
            <Plus className="mr-2 h-4 w-4" />
            {t("playground.addRemap")}
          </Button>
        </CardContent>
      </Card>

      {/* キー編集ダイアログ（バーチャルキーボードのキークリックで開く） */}
      <Dialog open={!!editingKeyCode} onOpenChange={(open) => !open && setEditingKeyCode(null)}>
        <DialogContent
          className="sm:max-w-md max-h-[80vh] overflow-y-auto"
          onEscapeKeyDown={keyCaptureEscapeGuard}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className="font-mono text-xl">
                {editingKeyCode && getKeyLabel(t, editingKeyCode, layout)}
              </span>
              <span className="text-muted-foreground text-sm font-normal">
                {t("meKeybindings.settingsSuffix")}
              </span>
            </DialogTitle>
            <DialogDescription>{t("playground.remapDialogDescription")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>{t("meKeybindings.keyRemapSetting")}</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  editingKeyCode &&
                  onRemapsChange([
                    ...remaps,
                    { id: draftId("remap"), sourceKey: editingKeyCode, targetKey: "" },
                  ])
                }
              >
                <Plus className="mr-1 h-3 w-3" />
                追加
              </Button>
            </div>

            {selectedKeyRemaps.length > 0 ? (
              <div className="space-y-2 max-h-72 overflow-y-auto">
                {selectedKeyRemaps.map((remap) => (
                  <DialogRemapRow
                    key={remap.id}
                    remap={remap}
                    index={remap._index}
                    baseKeyCode={editingKeyCode ?? ""}
                    keyboardLayout={layout}
                    onUpdate={updateRemapAt}
                    onDelete={deleteRemapAt}
                  />
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-2 border rounded-md bg-muted/30">
                {t("meKeybindings.remapsTitle")}が設定されていません
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* タイピングテストモーダル（バーチャルキーボードカードのボタンから開く） */}
      <Dialog open={typingTestOpen} onOpenChange={setTypingTestOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("playground.typingTestSection")}</DialogTitle>
            <DialogDescription>{t("playground.typingTestSectionDescription")}</DialogDescription>
          </DialogHeader>
          <TypingTestArea remaps={effectiveRemaps} />
        </DialogContent>
      </Dialog>

      {/* サーチクラフト編集 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t("playground.craftSection")}</CardTitle>
          <CardDescription>{t("playground.craftSectionDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          {crafts.length > 0 ? (
            <SearchCraftListEditor
              crafts={crafts}
              remaps={effectiveRemaps}
              onUpdate={(index, updated) =>
                onCraftsChange(crafts.map((c, i) => (i === index ? updated : c)))
              }
              onDelete={(index) => onCraftsChange(crafts.filter((_, i) => i !== index))}
              onReorder={(oldIndex, newIndex) =>
                onCraftsChange(arrayMove(crafts, oldIndex, newIndex))
              }
            />
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">
              {t("meTemplates.noCraftsInEditor")}
            </p>
          )}
          <Button
            variant="outline"
            size="sm"
            className="mt-4"
            onClick={() =>
              onCraftsChange([
                ...crafts,
                { id: draftId("craft"), items: [], searchStr: null, comment: null, timing: null, withShift: false },
              ])
            }
          >
            <Plus className="mr-2 h-4 w-4" />
            {t("playground.addCraft")}
          </Button>
        </CardContent>
      </Card>
    </>
  );
}
