// ユーザー絞り込み + 数値範囲フィルタを1つに統合したモーダル。
// - ユーザー絞り込み: 表示するユーザーを検索してリスト登録（即時反映）
// - 操作＝キー: 「ダッシュ = 左Ctrl」のように、操作に割り当てているキーで絞る（ドラフト → 適用で反映）
// - 数値フィルタ: DPI / 感度 / 振り向きの範囲（ドラフト → 適用で反映）
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { SENSITIVITY_PERCENT_MAX } from "@/lib/mouse-settings";
import { Plus, SlidersHorizontal, X } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { KeyCaptureButton, keyCaptureEscapeGuard } from "@/components/key-capture-button";
import { getActionLabel } from "@/lib/keybindings";
import {
  bindConditionLabel,
  collectBoundKeys,
  type BoundKeyRow,
} from "@/lib/keybindings-filter";
import {
  BIND_FILTER_ACTIONS,
  formatBindCondition,
  parseBindConditions,
  upsertBindCondition,
} from "@/lib/keybindings-search-params";
import { useKeybindingsFilters } from "@/hooks/use-keybindings-filters";
import { UserSelectList, type UserFilterPlayer } from "./user-filter";
import { useLocale, useT } from "@/hooks/use-locale";
import type { Locale } from "@/lib/locale";

function parseNumber(value: string): number | null {
  if (value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** 入力が有効範囲（inputMin〜inputMax）の外か。空欄は範囲外にしない */
function isOutOfRange(value: string, inputMin?: number, inputMax?: number): boolean {
  const n = parseNumber(value);
  if (n == null) return false;
  return (inputMin != null && n < inputMin) || (inputMax != null && n > inputMax);
}

/** 数値欄の有効範囲（入力の下限・上限。欄の min/max 属性と範囲外の判定に使う） */
const DPI_INPUT_MIN = 1;
const SENS_INPUT_MIN = 0;
const CM360_INPUT_MIN = 0;

/**
 * min > max（入力の取り違え）は適用をブロックせず自動で入れ替えて救済する。
 * 「0件になって理由が分からない」より、意図どおりの範囲で結果を出すほうが摩擦が少ないため。
 */
function orderedRange(
  min: number | null,
  max: number | null,
): [number | null, number | null] {
  if (min != null && max != null && min > max) return [max, min];
  return [min, max];
}

export function FilterDialog({
  players,
}: {
  players: Array<UserFilterPlayer & Partial<BoundKeyRow>>;
}) {
  const t = useT();
  const locale = useLocale();
  const { params, setParams, activeFilterCount } = useKeybindingsFilters();
  const [open, setOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  // すべてドラフト（「適用」を押すまでクエリは走らせない）
  const [draftUsers, setDraftUsers] = useState<string[]>([]);
  const [draftBinds, setDraftBinds] = useState<string[]>([]);
  const [draftDpiMin, setDraftDpiMin] = useState("");
  const [draftDpiMax, setDraftDpiMax] = useState("");
  const [draftSensMin, setDraftSensMin] = useState("");
  const [draftSensMax, setDraftSensMax] = useState("");
  const [draftCm360Min, setDraftCm360Min] = useState("");
  const [draftCm360Max, setDraftCm360Max] = useState("");

  // 開いたタイミングで draft を URL から同期
  useEffect(() => {
    if (!open) return;
    setDraftUsers(params.users);
    setDraftBinds(parseBindConditions(params.bind).map(formatBindCondition));
    setDraftDpiMin(params.dpiMin != null ? String(params.dpiMin) : "");
    setDraftDpiMax(params.dpiMax != null ? String(params.dpiMax) : "");
    setDraftSensMin(params.sensMin != null ? String(params.sensMin) : "");
    setDraftSensMax(params.sensMax != null ? String(params.sensMax) : "");
    setDraftCm360Min(params.cm360Min != null ? String(params.cm360Min) : "");
    setDraftCm360Max(params.cm360Max != null ? String(params.cm360Max) : "");
  }, [open, params]);

  const toggleDraftUser = (slug: string) =>
    setDraftUsers((prev) =>
      prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug],
    );

  // 「適用」で初めて URL（クエリ）へ反映する。min > max は orderedRange で入れ替えて救済する
  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    // 範囲外の欄があれば適用しない。欄の下にエラーが出ているので、最初の欄へフォーカスを移す
    const invalid = e.currentTarget.querySelector<HTMLInputElement>('[aria-invalid="true"]');
    if (invalid) {
      invalid.focus();
      return;
    }
    const [dpiMin, dpiMax] = orderedRange(parseNumber(draftDpiMin), parseNumber(draftDpiMax));
    const [sensMin, sensMax] = orderedRange(parseNumber(draftSensMin), parseNumber(draftSensMax));
    const [cm360Min, cm360Max] = orderedRange(
      parseNumber(draftCm360Min),
      parseNumber(draftCm360Max),
    );
    setParams({
      users: draftUsers.length > 0 ? draftUsers : null,
      bind: draftBinds.length > 0 ? draftBinds : null,
      dpiMin,
      dpiMax,
      sensMin,
      sensMax,
      cm360Min,
      cm360Max,
    });
    setOpen(false);
  };

  const clearDrafts = () => {
    setDraftUsers([]);
    setDraftBinds([]);
    setDraftDpiMin("");
    setDraftDpiMax("");
    setDraftSensMin("");
    setDraftSensMax("");
    setDraftCm360Min("");
    setDraftCm360Max("");
  };

  const userCount = params.users.length;
  const totalActive = activeFilterCount + (userCount > 0 ? 1 : 0);
  const draftActive =
    draftUsers.length > 0 ||
    draftBinds.length > 0 ||
    [draftDpiMin, draftDpiMax, draftSensMin, draftSensMax, draftCm360Min, draftCm360Max].some(
      (v) => v.trim() !== "",
    );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5 max-md:min-h-11">
          <SlidersHorizontal className="h-4 w-4" />
          {t("keybindings.filter")}
          {totalActive > 0 && (
            <Badge variant="default" className="ml-1 h-4 min-w-4 px-1 text-[10px]">
              {totalActive}
            </Badge>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent
        ref={contentRef}
        showCloseButton={false}
        className="sm:max-w-md max-h-[85vh] flex flex-col"
        // 検索欄へ自動でフォーカスを入れない（スマホではソフトキーボードが画面の半分を覆うため）。
        // キーボード操作の開始点は、ダイアログ自身に置く（Tab で最初の操作に進める）
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          contentRef.current?.focus();
        }}
        // 操作＝キーの「キーを押して指定」中の Escape は、ダイアログを閉じずにキーとして受け取る
        onEscapeKeyDown={keyCaptureEscapeGuard}
      >
        {/* 閉じるボタン: 共有の DialogContent の既定は 16px。md 未満は 44px の押せる範囲にする */}
        <DialogClose className="ring-offset-background focus-visible:ring-ring absolute top-1.5 right-1.5 inline-flex size-11 items-center justify-center rounded-md opacity-70 transition-opacity hover:opacity-100 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-hidden md:top-3 md:right-3 md:size-8">
          <X className="size-4" aria-hidden />
          <span className="sr-only">{t("common.close")}</span>
        </DialogClose>
        <DialogHeader className="pr-10">
          <DialogTitle>{t("keybindings.filter")}</DialogTitle>
          <DialogDescription>
            {t("keybindings.filterDescription")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-6 px-1">
          {/* ユーザー絞り込み（ドラフト） */}
          <div className="space-y-2">
            <Label>{t("keybindings.userFilter")}</Label>
            <UserSelectList
              players={players}
              selected={draftUsers}
              onToggle={toggleDraftUser}
            />
          </div>

          {/* 操作＝キーの絞り込み（ドラフト） */}
          <BindFilterSection
            players={players}
            binds={draftBinds}
            onChange={setDraftBinds}
            locale={locale}
          />

          {/* 数値フィルタ（ドラフト） */}
          <form
            id="keybindings-numeric-filter"
            onSubmit={handleSubmit}
            // 範囲外は欄の下のエラー文で知らせる（ブラウザの吹き出しは出さない）
            noValidate
            className="space-y-4"
          >
            <Label className="text-sm font-medium">
              {t("keybindings.numericFilter")}
            </Label>
            {/* 数値で絞ると、キーボードのタブも含めてマウス設定のある走者だけになる */}
            <p className="text-xs text-muted-foreground">{t("keybindings.numericFilterNote")}</p>
            <FilterRange
              label="DPI"
              min={draftDpiMin}
              max={draftDpiMax}
              onMin={setDraftDpiMin}
              onMax={setDraftDpiMax}
              inputMin={DPI_INPUT_MIN}
            />
            <FilterRange
              label={t("keybindings.inGameSensitivityRange")}
              min={draftSensMin}
              max={draftSensMax}
              onMin={setDraftSensMin}
              onMax={setDraftSensMax}
              suffix="%"
              inputMin={SENS_INPUT_MIN}
              inputMax={SENSITIVITY_PERCENT_MAX}
              hint={t("keybindings.sensitivityRangeHint")}
            />
            <FilterRange
              label={t("keybindings.turnDistanceRange")}
              min={draftCm360Min}
              max={draftCm360Max}
              onMin={setDraftCm360Min}
              onMax={setDraftCm360Max}
              suffix="cm"
              inputMin={CM360_INPUT_MIN}
            />
          </form>
        </div>

        <DialogFooter className="flex-row gap-2 sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            onClick={clearDrafts}
            disabled={!draftActive}
            className="max-md:min-h-11"
          >
            <X className="h-4 w-4 mr-1" />
            {t("keybindings.clearFilter")}
          </Button>
          <Button type="submit" form="keybindings-numeric-filter" className="max-md:min-h-11">
            {t("keybindings.apply")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * 操作＝キーの条件を足す・外す。キーは、選んだ操作に実際に割り当てられているキーの一覧から選ぶ
 * （物理キーのないスマホ・マウスボタンでも選べる）。「キーを押して指定」でも選べる。
 * 同じ操作の条件は置き換える。
 */
function BindFilterSection({
  players,
  binds,
  onChange,
  locale,
}: {
  players: Array<Partial<BoundKeyRow>>;
  binds: string[];
  onChange: (next: string[]) => void;
  locale: Locale;
}) {
  const t = useT();
  const id = useId();
  const [action, setAction] = useState("");
  const [keyCode, setKeyCode] = useState("");

  const rows = useMemo(
    () => players.map((p) => ({ keybindings: p.keybindings ?? [], customKeys: p.customKeys })),
    [players],
  );
  const keyOptions = useMemo(
    () => (action ? collectBoundKeys(t, rows, action, locale) : []),
    [t, rows, action, locale],
  );
  const conditions = parseBindConditions(binds);

  const add = () => {
    if (!action || !keyCode) return;
    onChange(upsertBindCondition(binds, { action, keyCode }));
    setKeyCode("");
  };

  return (
    <div role="group" aria-labelledby={`${id}-label`} className="space-y-2">
      <Label id={`${id}-label`}>{t("keybindings.bindFilter")}</Label>
      <p className="text-xs text-muted-foreground">{t("keybindings.bindFilterHint")}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <Select
          value={action}
          onValueChange={(v) => {
            setAction(v);
            setKeyCode("");
          }}
        >
          <SelectTrigger className="w-full max-md:min-h-11" aria-label={t("keybindings.bindFilterAction")}>
            <SelectValue placeholder={t("keybindings.bindFilterActionPlaceholder")} />
          </SelectTrigger>
          <SelectContent>
            {BIND_FILTER_ACTIONS.map((a) => (
              <SelectItem key={a} value={a} className="max-md:min-h-11">
                {getActionLabel(t, a)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={keyCode} onValueChange={setKeyCode} disabled={!action}>
          <SelectTrigger className="w-full max-md:min-h-11" aria-label={t("keybindings.bindFilterKey")}>
            <SelectValue placeholder={t("keybindings.bindFilterKeyPlaceholder")} />
          </SelectTrigger>
          <SelectContent>
            {keyOptions.length === 0 ? (
              <p className="px-2 py-1.5 text-sm text-muted-foreground">
                {t("keybindings.bindFilterNoKeys")}
              </p>
            ) : (
              keyOptions.map((k) => (
                <SelectItem key={k.keyCode} value={k.keyCode} className="max-md:min-h-11">
                  {k.label}
                </SelectItem>
              ))
            )}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <KeyCaptureButton
          value={keyCode}
          placeholder={t("keybindings.bindFilterCapture")}
          keyboardLayout={null}
          // Tab はキーの取り込み部品へフォーカスが移る途中で押されるので取り込まない（共有部品は変えない）
          onCapture={(code) => {
            if (code !== "Tab") setKeyCode(code);
          }}
          className="max-md:min-h-11"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={add}
          disabled={!action || !keyCode}
          className="max-md:min-h-11"
        >
          <Plus aria-hidden />
          {t("keybindings.bindFilterAdd")}
        </Button>
      </div>
      {conditions.length > 0 && (
        <ul className="space-y-1">
          {conditions.map((c) => (
            <li
              key={c.action}
              className="flex items-center justify-between gap-2 rounded-lg bg-secondary/50 py-0.5 pl-3 text-sm"
            >
              <span className="min-w-0 truncate font-mono">{bindConditionLabel(t, c)}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8 shrink-0 max-md:size-11"
                onClick={() => onChange(binds.filter((b) => !b.startsWith(`${c.action}:`)))}
                aria-label={t("keybindings.removeFilterChip", { label: bindConditionLabel(t, c) })}
              >
                <X aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FilterRange({
  label,
  min,
  max,
  onMin,
  onMax,
  suffix,
  inputMin,
  inputMax,
  hint,
}: {
  label: string;
  min: string;
  max: string;
  onMin: (v: string) => void;
  onMax: (v: string) => void;
  suffix?: string;
  /** number input の min 属性（入力可能な下限） */
  inputMin?: number;
  /** number input の max 属性（入力可能な上限） */
  inputMax?: number;
  /** 入力欄の下に常時出す補足（有効範囲の案内など） */
  hint?: string;
}) {
  const t = useT();
  const id = useId();
  const minId = `${id}-min`;
  const maxId = `${id}-max`;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const minInvalid = isOutOfRange(min, inputMin, inputMax);
  const maxInvalid = isOutOfRange(max, inputMin, inputMax);
  const errorText =
    inputMin != null && inputMax != null
      ? t("keybindings.rangeErrorBetween", { min: inputMin, max: inputMax })
      : inputMin != null
        ? t("keybindings.rangeErrorMin", { min: inputMin })
        : null;
  /** 欄ごとの説明（補足は常に、エラーはその欄が範囲外のときだけ結ぶ） */
  const describedBy = (invalid: boolean) =>
    [hint ? hintId : null, invalid && errorText ? errorId : null].filter(Boolean).join(" ") ||
    undefined;
  // 見える見出しは範囲全体の名前。最小・最大の欄はそれぞれ sr-only の Label で区別する
  return (
    <div role="group" aria-labelledby={`${id}-group`} className="space-y-2">
      <span id={`${id}-group`} className="block text-sm leading-none font-medium">
        {label}
      </span>
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Label htmlFor={minId} className="sr-only">
            {t("keybindings.rangeMinOf", { label })}
          </Label>
          <Input
            id={minId}
            type="number"
            inputMode="decimal"
            min={inputMin}
            max={inputMax}
            value={min}
            onChange={(e) => onMin(e.target.value)}
            placeholder={t("keybindings.rangeMin")}
            aria-invalid={minInvalid || undefined}
            aria-describedby={describedBy(minInvalid)}
            className="max-md:min-h-11"
          />
          {suffix && (
            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">
              {suffix}
            </span>
          )}
        </div>
        <span className="text-muted-foreground text-sm">{t("common.rangeSeparator")}</span>
        <div className="relative flex-1">
          <Label htmlFor={maxId} className="sr-only">
            {t("keybindings.rangeMaxOf", { label })}
          </Label>
          <Input
            id={maxId}
            type="number"
            inputMode="decimal"
            min={inputMin}
            max={inputMax}
            value={max}
            onChange={(e) => onMax(e.target.value)}
            placeholder={t("keybindings.rangeMax")}
            aria-invalid={maxInvalid || undefined}
            aria-describedby={describedBy(maxInvalid)}
            className="max-md:min-h-11"
          />
          {suffix && (
            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">
              {suffix}
            </span>
          )}
        </div>
      </div>
      {hint && (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {(minInvalid || maxInvalid) && errorText && (
        <p id={errorId} className="text-xs text-destructive">
          {errorText}
        </p>
      )}
    </div>
  );
}
