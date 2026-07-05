import { useState } from "react";
import { cn } from "@/lib/utils";
import { getKeyLabel, getKeyCombinationLabel } from "@/lib/keybindings";
import { t } from "@/lib/messages";

/**
 * キーキャプチャボタン。フォーカス中にキーを押すとそのキーコードを記録する。
 * allowModifiers 有効時は修飾キー組み合わせ（例: "Ctrl+KeyA"）を構築する。
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
  return (
    <button
      type="button"
      onFocus={() => setIsCapturing(true)}
      onBlur={() => setIsCapturing(false)}
      onKeyDown={(e) => {
        if (!isCapturing) return;
        e.preventDefault();

        if (allowModifiers) {
          // 修飾キー単独の場合
          const modifierKeyCodes = [
            "ShiftLeft", "ShiftRight",
            "ControlLeft", "ControlRight",
            "AltLeft", "AltRight",
            "MetaLeft", "MetaRight",
          ];
          if (modifierKeyCodes.includes(e.code)) {
            onCapture(e.code);
            (e.target as HTMLElement).blur();
            return;
          }

          // 修飾キー組み合わせを構築
          const modifiers: string[] = [];
          if (e.ctrlKey) modifiers.push("Ctrl");
          if (e.shiftKey) modifiers.push("Shift");
          if (e.altKey) modifiers.push("Alt");
          if (e.metaKey) modifiers.push("Meta");
          const combo = modifiers.length > 0
            ? [...modifiers, e.code].join("+")
            : e.code;
          onCapture(combo);
        } else {
          // 修飾キーは無視（リマップ先用）
          if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return;
          onCapture(e.code);
        }
        (e.target as HTMLElement).blur();
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
        <span className="text-muted-foreground">{t("meKeybindings.pressKey")}</span>
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
