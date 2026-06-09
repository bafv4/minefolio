// 検索 + 数値範囲フィルタを集約する右側 Sheet。
// マウス系（DPI / 感度 / 振り向き）のフィルタは全ビューから呼び出し可能。
import { useEffect, useState, type FormEvent } from "react";
import { SlidersHorizontal, X } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useKeybindingsFilters } from "@/hooks/use-keybindings-filters";
import { t } from "@/lib/messages";

function parseNumber(value: string): number | null {
  if (value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function FilterSheet() {
  const { params, setParams, setQ, clearAll, activeFilterCount } = useKeybindingsFilters();
  const [open, setOpen] = useState(false);

  // ローカル draft（適用ボタンで反映）
  const [draftQ, setDraftQ] = useState(params.q);
  const [draftDpiMin, setDraftDpiMin] = useState(
    params.dpiMin != null ? String(params.dpiMin) : "",
  );
  const [draftDpiMax, setDraftDpiMax] = useState(
    params.dpiMax != null ? String(params.dpiMax) : "",
  );
  const [draftSensMin, setDraftSensMin] = useState(
    params.sensMin != null ? String(params.sensMin) : "",
  );
  const [draftSensMax, setDraftSensMax] = useState(
    params.sensMax != null ? String(params.sensMax) : "",
  );
  const [draftCm360Min, setDraftCm360Min] = useState(
    params.cm360Min != null ? String(params.cm360Min) : "",
  );
  const [draftCm360Max, setDraftCm360Max] = useState(
    params.cm360Max != null ? String(params.cm360Max) : "",
  );

  // 開いたタイミングで draft を URL から同期
  useEffect(() => {
    if (!open) return;
    setDraftQ(params.q);
    setDraftDpiMin(params.dpiMin != null ? String(params.dpiMin) : "");
    setDraftDpiMax(params.dpiMax != null ? String(params.dpiMax) : "");
    setDraftSensMin(params.sensMin != null ? String(params.sensMin) : "");
    setDraftSensMax(params.sensMax != null ? String(params.sensMax) : "");
    setDraftCm360Min(params.cm360Min != null ? String(params.cm360Min) : "");
    setDraftCm360Max(params.cm360Max != null ? String(params.cm360Max) : "");
  }, [open, params]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setParams({
      dpiMin: parseNumber(draftDpiMin),
      dpiMax: parseNumber(draftDpiMax),
      sensMin: parseNumber(draftSensMin),
      sensMax: parseNumber(draftSensMax),
      cm360Min: parseNumber(draftCm360Min),
      cm360Max: parseNumber(draftCm360Max),
    });
    setQ(draftQ);
    setOpen(false);
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <SlidersHorizontal className="h-4 w-4" />
          {t("keybindings.numericFilter")}
          {activeFilterCount > 0 && (
            <Badge variant="default" className="ml-1 h-4 min-w-4 px-1 text-[10px]">
              {activeFilterCount}
            </Badge>
          )}
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-md flex flex-col">
        <SheetHeader>
          <SheetTitle>{t("keybindings.filterByRange")}</SheetTitle>
          <SheetDescription>
            検索と数値範囲フィルタで対象走者を絞り込みます
          </SheetDescription>
        </SheetHeader>

        <form
          onSubmit={handleSubmit}
          className="flex-1 overflow-y-auto p-4 space-y-6"
        >
          {/* 検索 */}
          <div className="space-y-2">
            <Label htmlFor="filter-q">{t("keybindings.searchPlaceholder")}</Label>
            <Input
              id="filter-q"
              value={draftQ}
              onChange={(e) => setDraftQ(e.target.value)}
              placeholder="MCID..."
            />
          </div>

          {/* DPI */}
          <FilterRange
            label="DPI"
            min={draftDpiMin}
            max={draftDpiMax}
            onMin={setDraftDpiMin}
            onMax={setDraftDpiMax}
            placeholderMin="400"
            placeholderMax="3200"
          />

          {/* 感度 */}
          <FilterRange
            label={t("keybindings.inGameSensitivityRange")}
            min={draftSensMin}
            max={draftSensMax}
            onMin={setDraftSensMin}
            onMax={setDraftSensMax}
            placeholderMin="0"
            placeholderMax="200"
            suffix="%"
          />

          {/* 振り向き */}
          <FilterRange
            label={t("keybindings.turnDistanceRange")}
            min={draftCm360Min}
            max={draftCm360Max}
            onMin={setDraftCm360Min}
            onMax={setDraftCm360Max}
            placeholderMin="10"
            placeholderMax="60"
            suffix="cm"
          />

          <ActiveFilterList />
        </form>

        <SheetFooter className="flex-row gap-2 sm:flex-row sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              clearAll();
              setOpen(false);
            }}
            disabled={activeFilterCount === 0}
          >
            <X className="h-4 w-4 mr-1" />
            {t("keybindings.clearFilter")}
          </Button>
          <Button onClick={handleSubmit}>適用</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function FilterRange({
  label,
  min,
  max,
  onMin,
  onMax,
  placeholderMin,
  placeholderMax,
  suffix,
}: {
  label: string;
  min: string;
  max: string;
  onMin: (v: string) => void;
  onMax: (v: string) => void;
  placeholderMin?: string;
  placeholderMax?: string;
  suffix?: string;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Input
            type="number"
            inputMode="decimal"
            value={min}
            onChange={(e) => onMin(e.target.value)}
            placeholder={placeholderMin}
          />
          {suffix && (
            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">
              {suffix}
            </span>
          )}
        </div>
        <span className="text-muted-foreground text-sm">〜</span>
        <div className="relative flex-1">
          <Input
            type="number"
            inputMode="decimal"
            value={max}
            onChange={(e) => onMax(e.target.value)}
            placeholder={placeholderMax}
          />
          {suffix && (
            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">
              {suffix}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function ActiveFilterList() {
  const { params, setParams, setQ } = useKeybindingsFilters();
  const chips: Array<{ label: string; onRemove: () => void }> = [];

  if (params.q) {
    chips.push({ label: `検索: ${params.q}`, onRemove: () => setQ("") });
  }
  if (params.dpiMin != null || params.dpiMax != null) {
    chips.push({
      label: `DPI: ${params.dpiMin ?? "-"}〜${params.dpiMax ?? "-"}`,
      onRemove: () => setParams({ dpiMin: null, dpiMax: null }),
    });
  }
  if (params.sensMin != null || params.sensMax != null) {
    chips.push({
      label: `感度: ${params.sensMin ?? "-"}〜${params.sensMax ?? "-"}%`,
      onRemove: () => setParams({ sensMin: null, sensMax: null }),
    });
  }
  if (params.cm360Min != null || params.cm360Max != null) {
    chips.push({
      label: `振り向き: ${params.cm360Min ?? "-"}〜${params.cm360Max ?? "-"}cm`,
      onRemove: () => setParams({ cm360Min: null, cm360Max: null }),
    });
  }

  if (chips.length === 0) return null;

  return (
    <div className="space-y-2 pt-2 border-t">
      <Label className="text-xs text-muted-foreground">適用中のフィルタ</Label>
      <div className="flex flex-wrap gap-1.5">
        {chips.map((chip, i) => (
          <Badge key={i} variant="secondary" className="gap-1">
            {chip.label}
            <button
              type="button"
              onClick={chip.onRemove}
              className="hover:opacity-70"
              aria-label="削除"
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}
      </div>
    </div>
  );
}
