// /keybindings/visual のカード（md 未満）で、縮小図を補う「キーの割り当て」の折りたたみ。
// 縮小図は inert で読み上げられず、左手側しか映らないため、その走者の割り当てをすべて
// 「操作名 + キー」の対で文字にして並べる。並び順・まとまりは /keybindings の表のタブ（移動 / インベントリ / 戦闘・UI）。
// 中身は開いたときに初めて描く（一覧は件数が多く、md 以上では使わないため）。
import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  getActionLabel,
  getKeyCombinationLabel,
  getKeyLabel,
  isUnbound,
  normalizeKeyCode,
} from "@/lib/keybindings";
import {
  COMBAT_UI_ACTIONS,
  HOTBAR_ACTIONS,
  INVENTORY_ACTIONS,
  MOVEMENT_ACTIONS,
} from "@/lib/keybindings-search-params";
import { getRemapOutputLabel, getRemapSourceLabel } from "@/lib/remap-utils";
import type { Translator } from "@/lib/messages";
import { useT } from "@/hooks/use-locale";
import { buildCustomKeyNames, type CustomActionItem, type RemapItem } from "./keybindings-cells";
import type { KeybindingsRow } from "./keybindings-columns";

/** 表示しない廃止済みの操作（走者画面・/me/keybindings と同じ） */
const DEPRECATED_ACTIONS = ["toggleHud"];

/** 表のタブと同じまとまり・並び順（インベントリはホットバーが先） */
const ACTION_GROUPS = [
  { key: "movement", labelKey: "keybindings.movementTab", actions: [...MOVEMENT_ACTIONS] },
  {
    key: "inventory",
    labelKey: "keybindings.inventoryTab",
    actions: [...HOTBAR_ACTIONS, ...INVENTORY_ACTIONS],
  },
  { key: "combat-ui", labelKey: "keybindings.combatUiTab", actions: [...COMBAT_UI_ACTIONS] },
] as const;

const KBD_CLASS = "rounded bg-secondary/80 px-1.5 py-0.5 font-mono text-xs break-all";
const CHIP_CLASS =
  "inline-flex max-w-full items-center gap-1.5 rounded-md border border-border/60 py-0.5 pr-0.5 pl-2 text-xs";
const GROUP_HEADING_CLASS = "mb-1.5 text-xs font-medium text-muted-foreground";

type Binding = KeybindingsRow["keybindings"][number];

/** 表に載る割り当て（未割り当て・廃止済みを除く）をタブのまとまりに分ける。表に無い操作は最後のまとまりへ */
function groupBindings(bindings: Binding[]) {
  const usable = bindings.filter(
    (kb) => !DEPRECATED_ACTIONS.includes(kb.action) && !isUnbound(kb.keyCode),
  );
  const known = new Set<string>(ACTION_GROUPS.flatMap((g) => g.actions));
  const leftovers = usable.filter((kb) => !known.has(kb.action));
  return ACTION_GROUPS.map((group, index) => {
    const ordered = group.actions.flatMap((action) => usable.filter((kb) => kb.action === action));
    return {
      key: group.key,
      labelKey: group.labelKey,
      bindings: index === ACTION_GROUPS.length - 1 ? [...ordered, ...leftovers] : ordered,
    };
  }).filter((g) => g.bindings.length > 0);
}

/** 割り当ての件数（操作の割り当て＋カスタムアクション）。0 ならアコーディオンを出さない判定に使う */
export function countAssignments(player: Pick<KeybindingsRow, "keybindings" | "customActions">): number {
  return (
    groupBindings(player.keybindings).reduce((n, g) => n + g.bindings.length, 0) +
    player.customActions.length
  );
}

function keyLabelOf(
  t: Translator,
  keyCode: string,
  layout: string | null | undefined,
  customKeyNames: Record<string, string> | undefined,
): string {
  const custom = customKeyNames?.[keyCode] ?? customKeyNames?.[normalizeKeyCode(keyCode)];
  if (custom) return custom;
  return keyCode.includes("+")
    ? getKeyCombinationLabel(t, keyCode, layout)
    : getKeyLabel(t, keyCode, layout);
}

export function AssignmentAccordion({
  player,
  remaps,
  count,
  className,
  defaultOpen = false,
}: {
  player: KeybindingsRow;
  /** 表示中の文脈（Trigger / Chat）に絞ったリマップ。キーボードの図と同じものを渡す */
  remaps: RemapItem[];
  /** summary に出す件数（中に並べる物の数。呼び出し側で countAssignments ＋ リマップ数） */
  count: number;
  className?: string;
  /** 初期から開く（一覧で比べる用途。既定は閉じる） */
  defaultOpen?: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(defaultOpen);

  return (
    <details
      className={cn("group", className)}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary className="-mx-1 flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-sm px-1 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <ChevronRight
          className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90 motion-reduce:transition-none"
          aria-hidden
        />
        {t("keybindings.assignmentsSummary", { count })}
      </summary>
      {open && <AssignmentList player={player} remaps={remaps} />}
    </details>
  );
}

function AssignmentList({ player, remaps }: { player: KeybindingsRow; remaps: RemapItem[] }) {
  const t = useT();
  const layout = player.playerConfig?.keyboardLayout;
  const customKeyNames = buildCustomKeyNames(player.customKeys);
  const groups = groupBindings(player.keybindings);

  return (
    <div className="space-y-3 pt-1 pb-1">
      {groups.map((group) => (
        <div key={group.key}>
          <h3 className={GROUP_HEADING_CLASS}>{t(group.labelKey)}</h3>
          {/* 「操作名」と「キー」を対で読ませる（dt / dd） */}
          <dl className="flex flex-wrap gap-1.5">
            {group.bindings.map((kb) => (
              <div key={kb.id} className={CHIP_CLASS}>
                <dt className="min-w-0 break-words">{getActionLabel(t, kb.action)}</dt>
                <dd className="min-w-0">
                  <kbd className={KBD_CLASS}>{keyLabelOf(t, kb.keyCode, layout, customKeyNames)}</kbd>
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ))}

      {player.customActions.length > 0 && (
        <div>
          <h3 className={GROUP_HEADING_CLASS}>{t("keybindings.customActionsTab")}</h3>
          <dl className="flex flex-wrap gap-1.5">
            {player.customActions.map((action: CustomActionItem) => (
              <div key={action.id} className={CHIP_CLASS}>
                <dt className="min-w-0 break-words">{action.actionName}</dt>
                <dd className="min-w-0">
                  <kbd className={KBD_CLASS}>
                    {keyLabelOf(t, action.triggerKey, layout, customKeyNames)}
                  </kbd>
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {remaps.length > 0 && (
        <div>
          <h3 className={GROUP_HEADING_CLASS}>{t("keybindings.remapsTab")}</h3>
          {/* 表のリマップ列（RemapCell）と同じ「Q → P」「B → ×」の表記 */}
          <ul className="flex flex-wrap gap-1.5">
            {remaps.map((remap) => (
              <li key={remap.id} className={cn(KBD_CLASS, "inline-flex max-w-full items-center gap-1")}>
                {getRemapSourceLabel(t, remap.sourceKey, layout, customKeyNames)}
                <span className="text-muted-foreground">→</span>
                {getRemapOutputLabel(t, remap, layout, customKeyNames)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** md 未満で縮小図のラベルを隠す代わりに、主要な移動操作だけを kbd チップで1行（折り返しあり）に並べる */
export function AssignmentHighlights({
  player,
  className,
}: {
  player: KeybindingsRow;
  className?: string;
}) {
  const t = useT();
  const layout = player.playerConfig?.keyboardLayout;
  const customKeyNames = buildCustomKeyNames(player.customKeys);
  const items = MOVEMENT_ACTIONS.flatMap((action) =>
    player.keybindings.filter((kb) => kb.action === action && !isUnbound(kb.keyCode)).slice(0, 1),
  );
  if (items.length === 0) return null;
  return (
    <dl className={cn("flex flex-wrap gap-1.5", className)}>
      {items.map((kb) => (
        <div key={kb.id} className={CHIP_CLASS}>
          <dt className="min-w-0 break-words">{getActionLabel(t, kb.action)}</dt>
          <dd className="min-w-0">
            <kbd className={KBD_CLASS}>{keyLabelOf(t, kb.keyCode, layout, customKeyNames)}</kbd>
          </dd>
        </div>
      ))}
    </dl>
  );
}
