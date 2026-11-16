// 表示するユーザーを検索してリスト登録する横断フィルター（表・ビジュアル共通）。
// 値で絞るのではなく「このユーザーだけ表示する」ための絞り込み。
// 選択した slug は URL の `users` パラメータに保存され、applyToPlayers で適用される。
import { useRef } from "react";
import { X, Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { MinecraftAvatar } from "@/components/minecraft-avatar";
import { cn } from "@/lib/utils";
import { useKeybindingsFilters } from "@/hooks/use-keybindings-filters";
import { useT, useLocale } from "@/hooks/use-locale";
import { getLocalizedDisplayName } from "@/lib/slug";
import { bindConditionLabel } from "@/lib/keybindings-filter";
import type { Locale } from "@/lib/locale";

export type UserFilterPlayer = {
  slug: string;
  mcid: string | null;
  displayName: string | null;
  displayNameAlphabet?: string | null;
  uuid: string | null;
  customSkinUrl: string | null;
};

function displayLabel(p: UserFilterPlayer, locale: Locale): string {
  return getLocalizedDisplayName(p, locale);
}

/**
 * ユーザー検索 + 複数選択リスト（制御コンポーネント）。
 * 選択状態は呼び出し側が `selected`/`onToggle`/`onClear` で管理する。
 * フィルターモーダル内では「適用」まで反映しないドラフトとして扱う。
 */
export function UserSelectList({
  players,
  selected,
  onToggle,
}: {
  players: UserFilterPlayer[];
  selected: string[];
  onToggle: (slug: string) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const selectedSet = new Set(selected);
  const selectedCount = selectedSet.size;
  // cmdk は検索のたびに先頭の候補を自動でハイライトし、Enter でそれを選ぶ。値が名前・MCID・slug の連結なので
  // 数字などでもあいまい一致し、黙って誰かが選択に入ってしまう。矢印キー・ポインタで自分から候補に触れる前の Enter は無効にする
  const touchedRef = useRef(false);

  return (
    <Command
      className="border rounded-md"
      onKeyDownCapture={(e) => {
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
          touchedRef.current = true;
        } else if (e.key === "Enter" && !touchedRef.current && !e.nativeEvent.isComposing) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
      onPointerMoveCapture={() => {
        touchedRef.current = true;
      }}
    >
      <CommandInput
        placeholder={t("keybindings.userFilterSearch")}
        onValueChange={() => {
          touchedRef.current = false;
        }}
      />
      <CommandList className="max-h-56">
        <CommandEmpty>{t("keybindings.noPlayers")}</CommandEmpty>
        {selectedCount > 0 && (
          <div className="px-2 py-1.5 border-b">
            <span className="text-xs text-muted-foreground">
              {t("keybindings.userFilterSelected", { count: selectedCount })}
            </span>
          </div>
        )}
        <CommandGroup>
          {players.map((p) => {
            const label = displayLabel(p, locale);
            const isSelected = selectedSet.has(p.slug);
            return (
              <CommandItem
                key={p.slug}
                // cmdk の検索対象。表示名・MCID・slug すべてでヒットさせる。
                value={`${label} ${p.mcid ?? ""} ${p.slug}`}
                onSelect={() => onToggle(p.slug)}
                className="gap-2 max-md:min-h-11"
              >
                <MinecraftAvatar
                  uuid={p.uuid}
                  skinUrl={p.customSkinUrl}
                  size={20}
                  alt=""
                  className="rounded-md shrink-0"
                />
                <span className="truncate flex-1">{label}</span>
                <Check
                  className={cn(
                    "h-4 w-4 shrink-0",
                    isSelected ? "opacity-100" : "opacity-0",
                  )}
                />
              </CommandItem>
            );
          })}
        </CommandGroup>
      </CommandList>
    </Command>
  );
}

/** 数値範囲フィルタ 1 件ぶんのチップ表示（"DPI 400〜800" / "感度 〜50%"） */
function rangeChipLabel(
  name: string,
  min: number | null,
  max: number | null,
  unit: string,
  separator: string,
): string {
  return `${name} ${min ?? ""}${separator}${max ?? ""}${unit}`;
}

/**
 * 効いているフィルタのチップ列（ヘッダー下に表示し、表・ビジュアル横断で見えるようにする）。
 * 選択中のユーザーと、数値範囲（DPI / 感度 / 振り向き）のチップを出し、それぞれここから外せる。
 */
export function UserFilterChips({ players }: { players: UserFilterPlayer[] }) {
  const t = useT();
  const locale = useLocale();
  const {
    params,
    toggleUser,
    setRange,
    clearFilters,
    hasActiveFilters,
    bindConditions,
    removeBindCondition,
  } = useKeybindingsFilters();
  const selectedSet = new Set(params.users);
  const selectedPlayers = players.filter((p) => selectedSet.has(p.slug));
  const sep = t("common.rangeSeparator");

  const ranges = [
    {
      key: "dpi",
      label: rangeChipLabel("DPI", params.dpiMin, params.dpiMax, "", sep),
      active: params.dpiMin != null || params.dpiMax != null,
      clear: () => setRange({ dpiMin: null, dpiMax: null }),
    },
    {
      key: "sens",
      label: rangeChipLabel(
        t("playerProfile.inGameSensitivity"),
        params.sensMin,
        params.sensMax,
        "%",
        sep,
      ),
      active: params.sensMin != null || params.sensMax != null,
      clear: () => setRange({ sensMin: null, sensMax: null }),
    },
    {
      key: "cm360",
      label: rangeChipLabel(
        t("playerProfile.turnDistance"),
        params.cm360Min,
        params.cm360Max,
        "cm",
        sep,
      ),
      active: params.cm360Min != null || params.cm360Max != null,
      clear: () => setRange({ cm360Min: null, cm360Max: null }),
    },
  ].filter((r) => r.active);

  if (!hasActiveFilters) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {selectedPlayers.length > 0 && (
        <span className="text-xs text-muted-foreground">
          {t("keybindings.userFilterActive")}
        </span>
      )}
      {selectedPlayers.map((p) => (
        <Badge key={p.slug} variant="secondary" className="gap-1 pl-1">
          <MinecraftAvatar
            uuid={p.uuid}
            skinUrl={p.customSkinUrl}
            size={16}
            alt=""
            className="rounded-md"
          />
          {displayLabel(p, locale)}
          <button
            type="button"
            onClick={() => toggleUser(p.slug)}
            className="-m-2 p-2 hover:opacity-70"
            aria-label={t("keybindings.removeFilterChip", {
              label: displayLabel(p, locale),
            })}
          >
            <X className="h-3 w-3" />
          </button>
        </Badge>
      ))}
      {bindConditions.map((c) => {
        const label = bindConditionLabel(t, c);
        return (
          <Badge key={c.action} variant="secondary" className="gap-1 font-mono">
            {label}
            <button
              type="button"
              onClick={() => removeBindCondition(c.action)}
              className="-m-2 p-2 hover:opacity-70"
              aria-label={t("keybindings.removeFilterChip", { label })}
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        );
      })}
      {ranges.map((r) => (
        <Badge key={r.key} variant="secondary" className="gap-1 font-mono">
          {r.label}
          <button
            type="button"
            onClick={r.clear}
            className="-m-2 p-2 hover:opacity-70"
            aria-label={t("keybindings.removeFilterChip", { label: r.label })}
          >
            <X className="h-3 w-3" />
          </button>
        </Badge>
      ))}
      <button
        type="button"
        onClick={clearFilters}
        className="inline-flex min-h-11 items-center px-1 text-xs text-muted-foreground hover:text-foreground sm:min-h-6"
      >
        {t("keybindings.clearFilter")}
      </button>
    </div>
  );
}
