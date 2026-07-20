import { useState } from "react";
import { cn } from "@/lib/utils";
import { getKeyLabel, getKeyCombinationLabel } from "@/lib/keybindings";
import { t } from "@/lib/messages";

const MODIFIER_KEY_CODES = new Set([
  "ShiftLeft", "ShiftRight",
  "ControlLeft", "ControlRight",
  "AltLeft", "AltRight",
  "MetaLeft", "MetaRight",
]);

/** イベントの修飾キー押下状態から表示順どおりの修飾キー配列を作る */
function modifiersFromEvent(e: React.KeyboardEvent): string[] {
  const modifiers: string[] = [];
  if (e.ctrlKey) modifiers.push("Ctrl");
  if (e.shiftKey) modifiers.push("Shift");
  if (e.altKey) modifiers.push("Alt");
  if (e.metaKey) modifiers.push("Meta");
  return modifiers;
}

/**
 * キーキャプチャボタン。フォーカス中にキーを押すとそのキーコードを記録する。
 * allowModifiers 有効時は修飾キー組み合わせ（例: "Ctrl+KeyA"）を構築する。
 * 修飾キーは押した時点では確定しない（押しっぱなしで組み合わせ待ちの表示になる）:
 * - 押しながら非修飾キーを押す → 組み合わせ（"Ctrl+KeyA"）として確定
 * - そのまま離す → 修飾キー単独（"ControlLeft" 等）として確定
 * 何も確定せずフォーカスを外せばキャンセル（元の値を維持）。
 */
export function KeyCaptureButton({
  value,
  placeholder,
  keyboardLayout,
  onCapture,
  allowModifiers = false,
  className,
}: {
  value: string;
  placeholder: string;
  keyboardLayout: string | null;
  onCapture: (keyCode: string) => void;
  allowModifiers?: boolean;
  className?: string;
}) {
  const [isCapturing, setIsCapturing] = useState(false);
  const [heldModifiers, setHeldModifiers] = useState<string[]>([]);

  const finalize = (e: React.KeyboardEvent, keyCode: string) => {
    onCapture(keyCode);
    (e.target as HTMLElement).blur();
  };

  return (
    <button
      type="button"
      onFocus={() => setIsCapturing(true)}
      onBlur={() => {
        setIsCapturing(false);
        setHeldModifiers([]);
      }}
      onKeyDown={(e) => {
        if (!isCapturing) return;
        e.preventDefault();

        if (allowModifiers) {
          if (MODIFIER_KEY_CODES.has(e.code)) {
            // 修飾キーの押下では確定しない: 組み合わせ待ちとして保持表示のみ更新する
            setHeldModifiers(modifiersFromEvent(e));
            return;
          }

          // 非修飾キーの押下で（押下中の修飾キーとの）組み合わせとして確定
          const modifiers = modifiersFromEvent(e);
          finalize(e, modifiers.length > 0 ? [...modifiers, e.code].join("+") : e.code);
        } else {
          // 修飾キーは無視（リマップ先用）
          if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return;
          finalize(e, e.code);
        }
      }}
      onKeyUp={(e) => {
        if (!isCapturing || !allowModifiers) return;
        if (!MODIFIER_KEY_CODES.has(e.code)) return;
        e.preventDefault();
        // 修飾キーを離した = そのキー自身を確定（修飾キー単独のリマップ/トリガー用）。
        // keyup 時点で自身のフラグは落ちているため、他に押しっぱなしの修飾キーが
        // あればその組み合わせ（例: Ctrl 押下中に Shift を離す → "Ctrl+ShiftLeft"）になる
        const modifiers = modifiersFromEvent(e);
        finalize(e, modifiers.length > 0 ? [...modifiers, e.code].join("+") : e.code);
      }}
      className={cn(
        "min-w-28 h-9 px-3 rounded-md border text-sm font-mono transition-colors",
        "bg-secondary/50 hover:bg-secondary/70",
        "focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1",
        isCapturing ? "border-primary" : "border-input",
        className
      )}
    >
      {isCapturing ? (
        <span className="text-muted-foreground">
          {heldModifiers.length > 0
            ? `${heldModifiers.join(" + ")} + …`
            : t(allowModifiers ? "meKeybindings.pressKeyWithModifiers" : "meKeybindings.pressKey")}
        </span>
      ) : value ? (
        <span>
          {allowModifiers
            ? getKeyCombinationLabel(value, keyboardLayout)
            : getKeyLabel(value, keyboardLayout)}
        </span>
      ) : (
        <span className="text-muted-foreground">{placeholder}</span>
      )}
    </button>
  );
}
