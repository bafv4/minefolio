import { useState, type ReactNode } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { KeyDialogSection } from "@/components/keybindings/key-dialog-section";
import { useT } from "@/hooks/use-locale";

interface PickerBinding {
  id: string;
  keyCode: string | null | undefined;
}

/**
 * キー設定ダイアログの「操作割り当て」の中身。
 * 先頭に操作の検索欄、その下に「このキーの現在の割り当て」を常に表示し、区分（移動／インベントリ／戦闘・UI など）は
 * 既定で畳む（割り当て済みの区分と、検索中は開く）。チェックボックスの行そのものは `renderRow` で呼び出し側が描く
 * （保存の挙動・データの形は呼び出し側のまま）。別のキーを編集し直すときは呼び出し側が `key` を変えて作り直す。
 */
export function KeyActionPicker<KB extends PickerBinding>({
  groups,
  editingKeyCode,
  getLabel,
  renderRow,
}: {
  groups: { key: string; label: string; bindings: KB[] }[];
  editingKeyCode: string | null;
  /** 検索と現在の割り当ての表示に使う操作名 */
  getLabel: (kb: KB) => string;
  renderRow: (kb: KB) => ReactNode;
}) {
  const t = useT();
  const [query, setQuery] = useState("");
  const normalized = query.trim().toLowerCase();
  const searching = normalized.length > 0;

  // 閉じるアニメーション中は editingKeyCode が null になる。null のまま未割り当て（keyCode === null）と一致させない
  const assigned = editingKeyCode
    ? groups.flatMap((g) => g.bindings).filter((kb) => kb.keyCode === editingKeyCode)
    : [];

  const visibleGroups = groups
    .map((g) => ({
      ...g,
      bindings: searching
        ? g.bindings.filter((kb) => getLabel(kb).toLowerCase().includes(normalized))
        : g.bindings,
    }))
    .filter((g) => g.bindings.length > 0);

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("meKeybindings.actionSearchPlaceholder")}
          aria-label={t("meKeybindings.actionSearchLabel")}
          className="pl-8 max-md:h-11"
        />
      </div>

      <div className="text-xs">
        <p className="mb-1 font-medium text-muted-foreground">{t("meKeybindings.currentAssignments")}</p>
        {assigned.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5">
            {assigned.map((kb) => (
              <li key={kb.id} className="rounded bg-secondary/80 px-2 py-1 text-sm">
                {getLabel(kb)}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground">{t("meKeybindings.noCurrentAssignments")}</p>
        )}
      </div>

      {/* live 領域は常に置き、文だけを差し替える（領域ごと後から差し込むと読み上げられないことがある） */}
      <p className={visibleGroups.length === 0 ? "py-2 text-center text-sm text-muted-foreground" : "sr-only"} role="status">
        {visibleGroups.length === 0 ? t("meKeybindings.noActionMatches") : ""}
      </p>
      {visibleGroups.length === 0 ? null : (
        <div className="space-y-2">
          {visibleGroups.map((group) => {
            const assignedInGroup = group.bindings.filter((kb) => kb.keyCode === editingKeyCode).length;
            return (
              <KeyDialogSection
                // 検索の開始・終了で開閉の初期値を取り直す（入力のたびには作り直さない）
                key={`${group.key}-${searching ? "search" : "browse"}`}
                defaultOpen={searching || assignedInGroup > 0}
                title={group.label}
                summary={
                  assignedInGroup > 0 ? t("meKeybindings.sectionCount", { count: assignedInGroup }) : undefined
                }
              >
                <div className="space-y-1.5">{group.bindings.map((kb) => renderRow(kb))}</div>
              </KeyDialogSection>
            );
          })}
        </div>
      )}
    </div>
  );
}
