import { useT } from "@/hooks/use-locale";
import { getFingerLabel, type FingerType } from "@/lib/keybindings";
import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";

/** 指の正準順（中央寄りに手のひら）。保存する配列の順序もこれに揃える。 */
export const FINGER_OPTIONS: FingerType[] = [
  "left-pinky",
  "left-ring",
  "left-middle",
  "left-index",
  "left-thumb",
  "left-palm",
  "right-palm",
  "right-thumb",
  "right-index",
  "right-middle",
  "right-ring",
  "right-pinky",
];

const FINGER_COLOR_CLASSES: Record<FingerType, string> = {
  "left-pinky": "bg-finger-pinky",
  "left-ring": "bg-finger-ring",
  "left-middle": "bg-finger-middle",
  "left-index": "bg-finger-index",
  "left-thumb": "bg-finger-thumb",
  "left-palm": "bg-finger-palm",
  "right-palm": "bg-finger-palm",
  "right-thumb": "bg-finger-thumb",
  "right-index": "bg-finger-index",
  "right-middle": "bg-finger-middle",
  "right-ring": "bg-finger-ring",
  "right-pinky": "bg-finger-pinky",
};

const LEFT_FINGERS = FINGER_OPTIONS.filter((f) => f.startsWith("left-"));
const RIGHT_FINGERS = FINGER_OPTIONS.filter((f) => f.startsWith("right-"));

/** 選択済みの指を正準順に並べ直す（選択順に依存させない） */
export function sortFingers(fingers: Iterable<FingerType>): FingerType[] {
  const set = new Set(fingers);
  return FINGER_OPTIONS.filter((f) => set.has(f));
}

/**
 * 押す指の複数選択トグル。左手6・右手6の2行。トグルは `aria-pressed`（Radix Toggle）で状態を伝える。
 * `onChange` には正準順の配列を渡す（空配列 = 割り当て解除）。
 */
export function FingerToggleGroup({
  value,
  onChange,
  disabled,
}: {
  value: readonly FingerType[];
  onChange: (next: FingerType[]) => void;
  disabled?: boolean;
}) {
  const t = useT();

  const toggle = (finger: FingerType, pressed: boolean) => {
    const next = new Set(value);
    if (pressed) next.add(finger);
    else next.delete(finger);
    onChange(sortFingers(next));
  };

  const renderRow = (fingers: FingerType[]) => (
    <div className="flex flex-wrap gap-1.5">
      {fingers.map((finger) => (
        <Toggle
          key={finger}
          variant="outline"
          size="sm"
          disabled={disabled}
          pressed={value.includes(finger)}
          onPressedChange={(pressed) => toggle(finger, pressed)}
          className="data-[state=on]:border-primary/60"
        >
          <span aria-hidden className={`h-3 w-3 shrink-0 rounded-full ${FINGER_COLOR_CLASSES[finger]}`} />
          {getFingerLabel(t, finger)}
        </Toggle>
      ))}
    </div>
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">{t("meKeybindings.fingerMultiHint")}</p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          disabled={disabled || value.length === 0}
          onClick={() => onChange([])}
        >
          {t("meKeybindings.fingerClear")}
        </Button>
      </div>
      <div className="space-y-1.5">
        {renderRow(LEFT_FINGERS)}
        {renderRow(RIGHT_FINGERS)}
      </div>
    </div>
  );
}
