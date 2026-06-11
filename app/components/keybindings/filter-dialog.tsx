// ユーザー絞り込み + 数値範囲フィルタを1つに統合したモーダル。
// - ユーザー絞り込み: 表示するユーザーを検索してリスト登録（即時反映）
// - 数値フィルタ: DPI / 感度 / 振り向きの範囲（ドラフト → 適用で反映）
import { useEffect, useState, type FormEvent } from "react";
import { SlidersHorizontal, X } from "lucide-react";
import {
  Dialog,
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
import { useKeybindingsFilters } from "@/hooks/use-keybindings-filters";
import { UserSelectList, type UserFilterPlayer } from "./user-filter";
import { t } from "@/lib/messages";

function parseNumber(value: string): number | null {
  if (value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function FilterDialog({ players }: { players: UserFilterPlayer[] }) {
  const { params, setParams, activeFilterCount } = useKeybindingsFilters();
  const [open, setOpen] = useState(false);

  // すべてドラフト（「適用」を押すまでクエリは走らせない）
  const [draftUsers, setDraftUsers] = useState<string[]>([]);
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

  // 「適用」で初めて URL（クエリ）へ反映する
  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setParams({
      users: draftUsers.length > 0 ? draftUsers : null,
      dpiMin: parseNumber(draftDpiMin),
      dpiMax: parseNumber(draftDpiMax),
      sensMin: parseNumber(draftSensMin),
      sensMax: parseNumber(draftSensMax),
      cm360Min: parseNumber(draftCm360Min),
      cm360Max: parseNumber(draftCm360Max),
    });
    setOpen(false);
  };

  const clearDrafts = () => {
    setDraftUsers([]);
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
    [draftDpiMin, draftDpiMax, draftSensMin, draftSensMax, draftCm360Min, draftCm360Max].some(
      (v) => v.trim() !== "",
    );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <SlidersHorizontal className="h-4 w-4" />
          {t("keybindings.filter")}
          {totalActive > 0 && (
            <Badge variant="default" className="ml-1 h-4 min-w-4 px-1 text-[10px]">
              {totalActive}
            </Badge>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md max-h-[85vh] flex flex-col">
        <DialogHeader>
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
              onClear={() => setDraftUsers([])}
            />
          </div>

          {/* 数値フィルタ（ドラフト） */}
          <form
            id="keybindings-numeric-filter"
            onSubmit={handleSubmit}
            className="space-y-4"
          >
            <Label className="text-sm font-medium">
              {t("keybindings.numericFilter")}
            </Label>
            <FilterRange
              label="DPI"
              min={draftDpiMin}
              max={draftDpiMax}
              onMin={setDraftDpiMin}
              onMax={setDraftDpiMax}
              placeholderMin="400"
              placeholderMax="3200"
            />
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
          </form>
        </div>

        <DialogFooter className="flex-row gap-2 sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            onClick={clearDrafts}
            disabled={!draftActive}
          >
            <X className="h-4 w-4 mr-1" />
            {t("keybindings.clearFilter")}
          </Button>
          <Button type="submit" form="keybindings-numeric-filter">
            {t("keybindings.apply")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
