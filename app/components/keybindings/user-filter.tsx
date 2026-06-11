// 表示するユーザーを検索してリスト登録する横断フィルター（表・ビジュアル共通）。
// 値で絞るのではなく「このユーザーだけ表示する」ための絞り込み。
// 選択した slug は URL の `users` パラメータに保存され、applyToPlayers で適用される。
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
import { t } from "@/lib/messages";

export type UserFilterPlayer = {
  slug: string;
  mcid: string | null;
  displayName: string | null;
  uuid: string | null;
  customSkinUrl: string | null;
};

function displayLabel(p: UserFilterPlayer): string {
  return p.displayName ?? p.mcid ?? p.slug;
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
  onClear,
}: {
  players: UserFilterPlayer[];
  selected: string[];
  onToggle: (slug: string) => void;
  onClear: () => void;
}) {
  const selectedSet = new Set(selected);
  const selectedCount = selectedSet.size;

  return (
    <Command className="border rounded-md">
      <CommandInput placeholder={t("keybindings.userFilterSearch")} />
      <CommandList className="max-h-56">
        <CommandEmpty>{t("keybindings.noPlayers")}</CommandEmpty>
        {selectedCount > 0 && (
          <div className="flex items-center justify-between px-2 py-1.5 border-b">
            <span className="text-xs text-muted-foreground">
              {t("keybindings.userFilterSelected", { count: selectedCount })}
            </span>
            <button
              type="button"
              onClick={onClear}
              className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
            >
              <X className="h-3 w-3" />
              {t("keybindings.clearFilter")}
            </button>
          </div>
        )}
        <CommandGroup>
          {players.map((p) => {
            const label = displayLabel(p);
            const isSelected = selectedSet.has(p.slug);
            return (
              <CommandItem
                key={p.slug}
                // cmdk の検索対象。表示名・MCID・slug すべてでヒットさせる。
                value={`${label} ${p.mcid ?? ""} ${p.slug}`}
                onSelect={() => onToggle(p.slug)}
                className="gap-2"
              >
                <MinecraftAvatar
                  uuid={p.uuid}
                  skinUrl={p.customSkinUrl}
                  size={20}
                  className="rounded-sm shrink-0"
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

/** 選択中ユーザーのチップ列（ヘッダー下に表示し、横断で見えるようにする）。 */
export function UserFilterChips({ players }: { players: UserFilterPlayer[] }) {
  const { params, toggleUser, clearUsers } = useKeybindingsFilters();
  const selectedSet = new Set(params.users);
  const selectedPlayers = players.filter((p) => selectedSet.has(p.slug));

  if (selectedPlayers.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-muted-foreground">
        {t("keybindings.userFilterActive")}
      </span>
      {selectedPlayers.map((p) => (
        <Badge key={p.slug} variant="secondary" className="gap-1 pl-1">
          <MinecraftAvatar
            uuid={p.uuid}
            skinUrl={p.customSkinUrl}
            size={16}
            className="rounded-sm"
          />
          {displayLabel(p)}
          <button
            type="button"
            onClick={() => toggleUser(p.slug)}
            className="hover:opacity-70"
            aria-label={t("keybindings.clearFilter")}
          >
            <X className="h-3 w-3" />
          </button>
        </Badge>
      ))}
      <button
        type="button"
        onClick={clearUsers}
        className="text-xs text-muted-foreground hover:text-foreground"
      >
        {t("keybindings.clearFilter")}
      </button>
    </div>
  );
}
