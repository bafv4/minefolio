import { useState } from "react";
import { cn } from "@/lib/utils";
import { getKeyLabel, getKeyCombinationLabel } from "@/lib/keybindings";
import { useT } from "@/hooks/use-locale";

const MODIFIER_KEY_CODES = new Set([
  "ShiftLeft", "ShiftRight",
  "ControlLeft", "ControlRight",
  "AltLeft", "AltRight",
  "MetaLeft", "MetaRight",
]);

// マウスのサイドボタン（戻る/進む）を入力として受け付ける。
// MouseEvent.button: 3=戻る(Back)、4=進む(Forward)。
// アプリのキーコードは Mouse3=サイド1 / Mouse4=サイド2 なので、
// 進む→サイド1(Mouse3)、戻る→サイド2(Mouse4) に対応づける。
const MOUSE_SIDE_BUTTON_CODES: Record<number, string> = {
  4: "Mouse3", // Forward → サイド1
  3: "Mouse4", // Back → サイド2
};

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
 * 修飾キーは押した時点では確定しない（離す＝単独 / 他キー＝別扱い を待つ）:
 * - allowModifiers=true（トリガー・変更元）: 押しながら非修飾キー → 組み合わせ
 *   （"Ctrl+KeyA"）、そのまま離す → 修飾キー単独（"ControlLeft" 等）
 * - allowModifiers=false（リマップ先＝単一キーのみ）: 非修飾キー → その基底キー
 *   （押下中の修飾キーは無視）、修飾キーをそのまま離す → 修飾キー単独
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
  const t = useT();
  const [isCapturing, setIsCapturing] = useState(false);
  const [heldModifiers, setHeldModifiers] = useState<string[]>([]);

  const finalize = (e: React.SyntheticEvent, keyCode: string) => {
    onCapture(keyCode);
    (e.currentTarget as HTMLElement).blur();
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

        if (MODIFIER_KEY_CODES.has(e.code)) {
          // 修飾キーの押下では確定しない（離す＝単独 / 他キー＝別扱い を待つ）。
          // これにより allowModifiers=false でも修飾キー単独をリマップ先に指定できる。
          setHeldModifiers(modifiersFromEvent(e));
          return;
        }

        if (allowModifiers) {
          // 非修飾キーの押下で（押下中の修飾キーとの）組み合わせとして確定
          const modifiers = modifiersFromEvent(e);
          finalize(e, modifiers.length > 0 ? [...modifiers, e.code].join("+") : e.code);
        } else {
          // リマップ先は単一キーのみ: 押下中の修飾キーは無視し基底キーだけ確定
          finalize(e, e.code);
        }
      }}
      onKeyUp={(e) => {
        if (!isCapturing) return;
        if (!MODIFIER_KEY_CODES.has(e.code)) return;
        e.preventDefault();
        if (allowModifiers) {
          // 修飾キーを離した = そのキー自身を確定。keyup 時点で自身のフラグは
          // 落ちているため、他に押しっぱなしの修飾キーがあればその組み合わせ
          // （例: Ctrl 押下中に Shift を離す → "Ctrl+ShiftLeft"）になる
          const modifiers = modifiersFromEvent(e);
          finalize(e, modifiers.length > 0 ? [...modifiers, e.code].join("+") : e.code);
        } else {
          // リマップ先は単一キーのみ: 離した修飾キー単独で確定（組み合わせにしない）
          finalize(e, e.code);
        }
      }}
      onMouseDown={(e) => {
        // マウスのサイドボタン（戻る/進む）を入力として受け付ける（トリガー・変更元用）。
        // 変更先（allowModifiers=false）はキーボードキー限定のため対象外。
        if (!allowModifiers) return;
        const code = MOUSE_SIDE_BUTTON_CODES[e.button];
        if (!code) return; // 左/中/右クリックは通常どおり（フォーカス等）
        e.preventDefault();
        finalize(e, code);
      }}
      onAuxClick={(e) => {
        // 戻る/進むボタンによるブラウザの履歴移動を抑止する
        if (allowModifiers && MOUSE_SIDE_BUTTON_CODES[e.button]) e.preventDefault();
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
          {allowModifiers && heldModifiers.length > 0
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
