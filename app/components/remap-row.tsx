import { useState, useEffect, useCallback } from "react";
import { isKeyRemapTarget, KEY_REMAP_TYPES, type KeyRemapType } from "@/lib/remap-utils";
import {
  getKeyLabel,
  parseKeyCombination,
  MODIFIER_ORDER,
  MODIFIER_LABELS,
  type Modifier,
} from "@/lib/keybindings";
import { cn } from "@/lib/utils";
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

// 変更先の出力タイプ（種別 KeyRemapType とは別概念）
export type RemapOutputType = "none" | "keyboard" | "special" | "disabled";

/** リマップ行が編集に必要とする最小のエントリ形状 */
export type RemapRowEntry = {
  sourceKey: string;
  targetKey: string | null;
  remapType?: KeyRemapType;
};

function getRemapOutputTypeFromTargetKey(targetKey: string | null | undefined): RemapOutputType {
  if (targetKey == null || targetKey === "") return "disabled";
  return isKeyRemapTarget(targetKey) ? "keyboard" : "special";
}

export function useRemapOutputType(
  targetKey: string | null,
  index: number,
  onUpdate: (index: number, updates: Partial<RemapRowEntry>) => void,
) {
  const outputType = getRemapOutputTypeFromTargetKey(targetKey);
  const [selectedOutputType, setSelectedOutputType] = useState<RemapOutputType>(outputType);

  useEffect(() => {
    if ((selectedOutputType === "special" || selectedOutputType === "keyboard") &&
        (targetKey === "" || targetKey === null)) {
      return;
    }
    setSelectedOutputType(outputType);
  }, [outputType, selectedOutputType, targetKey]);

  const handleOutputTypeChange = useCallback((newType: RemapOutputType) => {
    setSelectedOutputType(newType);
    switch (newType) {
      case "disabled":
        onUpdate(index, { targetKey: null });
        break;
      case "special":
        onUpdate(index, { targetKey: outputType === "special" ? targetKey : "" });
        break;
      case "keyboard":
        onUpdate(index, { targetKey: outputType === "keyboard" && targetKey ? targetKey : "" });
        break;
    }
  }, [index, onUpdate, outputType, targetKey]);

  return { outputType, selectedOutputType, handleOutputTypeChange };
}

/** リマップ種別（未設定/All/Trigger/Chat）の選択Select */
function RemapTypeSelect({
  value,
  onChange,
  heightClass = "h-9",
  disabledTypes,
}: {
  value: KeyRemapType;
  onChange: (value: KeyRemapType) => void;
  heightClass?: "h-9" | "h-8";
  disabledTypes?: KeyRemapType[];
}) {
  return (
    <Select value={value} onValueChange={(v: KeyRemapType) => onChange(v)}>
      <SelectTrigger className={cn("w-28 text-sm", heightClass)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {KEY_REMAP_TYPES.map((type) => (
          <SelectItem key={type} value={type} disabled={disabledTypes?.includes(type)}>
            {t(`remapType.${type}`)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function RemapRow({
  remap,
  index,
  keyboardLayout,
  onUpdate,
  onDelete,
  showRemapType = false,
  disabledRemapTypes,
}: {
  remap: RemapRowEntry;
  index: number;
  keyboardLayout: string | null;
  onUpdate: (index: number, updates: Partial<RemapRowEntry>) => void;
  onDelete: (index: number) => void;
  showRemapType?: boolean;
  disabledRemapTypes?: KeyRemapType[];
}) {
  const { selectedOutputType, handleOutputTypeChange } = useRemapOutputType(remap.targetKey, index, onUpdate);

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
          value={selectedOutputType}
          onValueChange={(value: RemapOutputType) => handleOutputTypeChange(value)}
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

        {selectedOutputType === "special" ? (
          <Input
            value={remap.targetKey ?? ""}
            onChange={(e) => onUpdate(index, { targetKey: e.target.value })}
            placeholder={t("meKeybindings.enterCharacter")}
            className="w-40 h-9 font-mono text-center text-sm"
          />
        ) : selectedOutputType === "keyboard" ? (
          <KeyCaptureButton
            value={remap.targetKey || ""}
            placeholder={t("meKeybindings.target")}
            keyboardLayout={keyboardLayout}
            onCapture={(key) => onUpdate(index, { targetKey: key })}
            allowModifiers={false}
            className="w-40"
          />
        ) : null}

        {showRemapType && (
          <RemapTypeSelect
            value={remap.remapType ?? "unset"}
            onChange={(value) => onUpdate(index, { remapType: value })}
            disabledTypes={disabledRemapTypes}
          />
        )}

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
 * 修飾キートグル + ベースキー表示。ダイアログ内の行（リマップ / カスタムアクション）で
 * 共通の「クリックしたキーを起点に、修飾キーの組み合わせを選ぶ」UI。
 * flex 行の中に直接並べて使う（このコンポーネント自体はラッパー要素を持たない）。
 */
export function ModifierToggleGroup({
  comboKey,
  baseKeyCode,
  keyboardLayout,
  onChange,
}: {
  /** 現在の組み合わせキー（例: "Ctrl+KeyX"。修飾キーなしならベースキーのみ） */
  comboKey: string;
  baseKeyCode: string;
  keyboardLayout: string | null;
  onChange: (newComboKey: string) => void;
}) {
  const currentModifiers = parseKeyCombination(comboKey).modifiers;

  const toggleModifier = (mod: Modifier) => {
    const newModifiers = currentModifiers.includes(mod)
      ? currentModifiers.filter((m) => m !== mod)
      : [...currentModifiers, mod];

    const newComboKey = newModifiers.length > 0
      ? [
          ...newModifiers.sort((a, b) => MODIFIER_ORDER.indexOf(a) - MODIFIER_ORDER.indexOf(b)),
          baseKeyCode,
        ].join("+")
      : baseKeyCode;

    onChange(newComboKey);
  };

  return (
    <>
      <div className="flex gap-1">
        {MODIFIER_ORDER.map((mod) => (
          <Button
            key={mod}
            type="button"
            variant={currentModifiers.includes(mod) ? "default" : "outline"}
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => toggleModifier(mod)}
          >
            {MODIFIER_LABELS[mod]}
          </Button>
        ))}
      </div>
      <span className="text-muted-foreground">+</span>
      <Badge variant="secondary" className="font-mono text-sm px-2 py-1">
        {getKeyLabel(baseKeyCode, keyboardLayout)}
      </Badge>
    </>
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
  showRemapType = false,
  disabledRemapTypes,
}: {
  remap: RemapRowEntry;
  index: number;
  baseKeyCode: string;
  keyboardLayout: string | null;
  onUpdate: (index: number, updates: Partial<RemapRowEntry>) => void;
  onDelete: (index: number) => void;
  showRemapType?: boolean;
  disabledRemapTypes?: KeyRemapType[];
}) {
  const { selectedOutputType, handleOutputTypeChange } = useRemapOutputType(remap.targetKey, index, onUpdate);

  return (
    <div className="p-3 rounded-lg border bg-secondary/20 space-y-3">
      {/* 修飾キー選択行 */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground shrink-0">{t("meKeybindings.from")}</span>
        <ModifierToggleGroup
          comboKey={remap.sourceKey}
          baseKeyCode={baseKeyCode}
          keyboardLayout={keyboardLayout}
          onChange={(newSourceKey) => onUpdate(index, { sourceKey: newSourceKey })}
        />
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
          value={selectedOutputType}
          onValueChange={(value: RemapOutputType) => handleOutputTypeChange(value)}
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

        {selectedOutputType === "special" ? (
          <Input
            value={remap.targetKey ?? ""}
            onChange={(e) => {
              onUpdate(index, { targetKey: e.target.value });
            }}
            placeholder={t("meKeybindings.enterCharacter")}
            className="w-40 h-8 font-mono text-center text-sm"
          />
        ) : selectedOutputType === "keyboard" ? (
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

      {/* 種別選択行 */}
      {showRemapType && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground shrink-0">{t("remapType.label")}</span>
          <RemapTypeSelect
            value={remap.remapType ?? "unset"}
            onChange={(value) => onUpdate(index, { remapType: value })}
            heightClass="h-8"
            disabledTypes={disabledRemapTypes}
          />
        </div>
      )}
    </div>
  );
}
