import { useState, useEffect, useCallback } from "react";
import { isKeyRemapTarget } from "@/lib/remap-utils";
import { getKeyLabel, parseKeyCombination } from "@/lib/keybindings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { KeyCaptureButton } from "@/components/key-capture-button";
import { ArrowRight, Trash2 } from "lucide-react";
import { t } from "@/lib/messages";

/**
 * リマップ編集行（/me/keybindings のリマップタブと共通のUI・UX）。
 * 変更元: 修飾キー組み合わせ対応のキーキャプチャ。
 * 変更先: 「キー」（単一キーキャプチャ）/「文字」（テキスト入力）/「無効」の3タイプ。
 */

export type RemapType = "none" | "keyboard" | "special" | "disabled";

/** リマップ行が編集に必要とする最小のエントリ形状 */
export type RemapRowEntry = {
  sourceKey: string;
  targetKey: string | null;
};

function getRemapTypeFromTargetKey(targetKey: string | null | undefined): RemapType {
  if (targetKey == null || targetKey === "") return "disabled";
  return isKeyRemapTarget(targetKey) ? "keyboard" : "special";
}

export function useRemapType(
  targetKey: string | null,
  index: number,
  onUpdate: (index: number, updates: Partial<RemapRowEntry>) => void,
) {
  const remapType = getRemapTypeFromTargetKey(targetKey);
  const [selectedRemapType, setSelectedRemapType] = useState<RemapType>(remapType);

  useEffect(() => {
    if ((selectedRemapType === "special" || selectedRemapType === "keyboard") &&
        (targetKey === "" || targetKey === null)) {
      return;
    }
    setSelectedRemapType(remapType);
  }, [remapType, selectedRemapType, targetKey]);

  const handleRemapTypeChange = useCallback((newType: RemapType) => {
    setSelectedRemapType(newType);
    switch (newType) {
      case "disabled":
        onUpdate(index, { targetKey: null });
        break;
      case "special":
        onUpdate(index, { targetKey: remapType === "special" ? targetKey : "" });
        break;
      case "keyboard":
        onUpdate(index, { targetKey: remapType === "keyboard" && targetKey ? targetKey : "" });
        break;
    }
  }, [index, onUpdate, remapType, targetKey]);

  return { remapType, selectedRemapType, handleRemapTypeChange };
}

export function RemapRow({
  remap,
  index,
  keyboardLayout,
  onUpdate,
  onDelete,
}: {
  remap: RemapRowEntry;
  index: number;
  keyboardLayout: string | null;
  onUpdate: (index: number, updates: Partial<RemapRowEntry>) => void;
  onDelete: (index: number) => void;
}) {
  const { selectedRemapType, handleRemapTypeChange } = useRemapType(remap.targetKey, index, onUpdate);

  return (
    <div className="p-3 rounded-lg border bg-secondary/20 space-y-3">
      {/* キー変換行 */}
      <div className="flex flex-wrap items-center gap-2">
        {/* リマップ元（修飾キー対応） */}
        <KeyCaptureButton
          value={remap.sourceKey}
          placeholder={t("meKeybindings.source")}
          keyboardLayout={keyboardLayout}
          onCapture={(key) => onUpdate(index, { sourceKey: key })}
          allowModifiers={true}
        />

        <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />

        <Select
          value={selectedRemapType}
          onValueChange={(value: RemapType) => handleRemapTypeChange(value)}
        >
          <SelectTrigger className="w-24 h-9 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="keyboard">{t("meKeybindings.outputTypeKey")}</SelectItem>
            <SelectItem value="special">{t("meKeybindings.outputTypeCharacter")}</SelectItem>
            <SelectItem value="disabled">{t("meKeybindings.outputTypeDisabled")}</SelectItem>
          </SelectContent>
        </Select>

        {selectedRemapType === "special" ? (
          <Input
            value={remap.targetKey ?? ""}
            onChange={(e) => onUpdate(index, { targetKey: e.target.value })}
            placeholder={t("meKeybindings.enterCharacter")}
            className="w-40 h-9 font-mono text-center text-sm"
          />
        ) : selectedRemapType === "keyboard" ? (
          <KeyCaptureButton
            value={remap.targetKey || ""}
            placeholder={t("meKeybindings.target")}
            keyboardLayout={keyboardLayout}
            onCapture={(key) => onUpdate(index, { targetKey: key })}
            allowModifiers={false}
            className="w-40"
          />
        ) : null}

        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-9 w-9 p-0 text-destructive hover:text-destructive ml-auto"
          onClick={() => onDelete(index)}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

    </div>
  );
}

/**
 * ダイアログ内リマップ行（キー1つを起点に、修飾キー組み合わせ・出力タイプを編集する）。
 * バーチャルキーボードのキーをクリックして開くモーダル（/me/keybindings のキー編集ダイアログ、
 * /playground のリマップ登録モーダル）で共通して使用する。
 */
export function DialogRemapRow({
  remap,
  index,
  baseKeyCode,
  keyboardLayout,
  onUpdate,
  onDelete,
}: {
  remap: RemapRowEntry;
  index: number;
  baseKeyCode: string;
  keyboardLayout: string | null;
  onUpdate: (index: number, updates: Partial<RemapRowEntry>) => void;
  onDelete: (index: number) => void;
}) {
  // 現在のsourceKeyから修飾キーを抽出
  const parsed = parseKeyCombination(remap.sourceKey);
  const currentModifiers = parsed.modifiers;

  // 修飾キーのトグル
  const toggleModifier = (mod: "Ctrl" | "Shift" | "Alt" | "Meta") => {
    const newModifiers = currentModifiers.includes(mod)
      ? currentModifiers.filter((m) => m !== mod)
      : [...currentModifiers, mod];

    // 新しいsourceKeyを構築
    const newSourceKey = newModifiers.length > 0
      ? [...newModifiers.sort((a, b) => ["Ctrl", "Shift", "Alt", "Meta"].indexOf(a) - ["Ctrl", "Shift", "Alt", "Meta"].indexOf(b)), baseKeyCode].join("+")
      : baseKeyCode;

    onUpdate(index, { sourceKey: newSourceKey });
  };

  const { selectedRemapType, handleRemapTypeChange } = useRemapType(remap.targetKey, index, onUpdate);

  return (
    <div className="p-3 rounded-lg border bg-secondary/20 space-y-3">
      {/* 修飾キー選択行 */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground shrink-0">{t("meKeybindings.from")}</span>
        <div className="flex gap-1">
          {(["Ctrl", "Shift", "Alt", "Meta"] as const).map((mod) => (
            <Button
              key={mod}
              type="button"
              variant={currentModifiers.includes(mod) ? "default" : "outline"}
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => toggleModifier(mod)}
            >
              {mod === "Meta" ? "Win" : mod}
            </Button>
          ))}
        </div>
        <span className="text-muted-foreground">+</span>
        <Badge variant="secondary" className="font-mono text-sm px-2 py-1">
          {getKeyLabel(baseKeyCode, keyboardLayout)}
        </Badge>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 text-destructive hover:text-destructive ml-auto"
          onClick={() => onDelete(index)}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      {/* 出力設定行 */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground shrink-0">{t("meKeybindings.to")}</span>

        {/* 出力タイプ選択 */}
        <Select
          value={selectedRemapType}
          onValueChange={(value: RemapType) => handleRemapTypeChange(value)}
        >
          <SelectTrigger className="w-24 h-8 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="keyboard">{t("meKeybindings.outputTypeKey")}</SelectItem>
            <SelectItem value="special">{t("meKeybindings.outputTypeCharacter")}</SelectItem>
            <SelectItem value="disabled">{t("meKeybindings.outputTypeDisabled")}</SelectItem>
          </SelectContent>
        </Select>

        {selectedRemapType === "special" ? (
          <Input
            value={remap.targetKey ?? ""}
            onChange={(e) => {
              onUpdate(index, { targetKey: e.target.value });
            }}
            placeholder={t("meKeybindings.enterCharacter")}
            className="w-40 h-8 font-mono text-center text-sm"
          />
        ) : selectedRemapType === "keyboard" ? (
          <KeyCaptureButton
            value={remap.targetKey || ""}
            placeholder={t("meKeybindings.target")}
            keyboardLayout={keyboardLayout}
            onCapture={(key) => onUpdate(index, { targetKey: key })}
            allowModifiers={false}
            className="w-40 h-8"
          />
        ) : null}
      </div>
    </div>
  );
}
