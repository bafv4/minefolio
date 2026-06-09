// 比較ビュー: バスケットに入れた走者（最大 5 件）をセクション別に並列比較。
// セクション = キー配置 / リマップ / マウス / カスタムアクション。
import { useMemo, useState, type ReactElement } from "react";
import { Link } from "react-router";
import { Star, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MinecraftAvatar } from "@/components/minecraft-avatar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  getActionLabel,
  getKeyLabel,
  normalizeKeyCode,
} from "@/lib/keybindings";
import { useCompareBasket } from "@/hooks/use-compare-basket";
import { useKeybindingsFilters } from "@/hooks/use-keybindings-filters";
import {
  KeyBadge,
  RemapCell,
  CustomActionCell,
  DpiCell,
  SensitivityCell,
  Cm360Cell,
  WindowsSpeedCell,
  CursorSpeedCell,
  RawInputCell,
  AccelerationCell,
  type RemapItem,
  type CustomActionItem,
  type MouseConfig,
} from "./keybindings-cells";

type ComparePlayer = {
  id: string;
  slug: string;
  mcid: string | null;
  uuid: string | null;
  displayName: string | null;
  customSkinUrl: string | null;
  keybindings: Array<{ id: string; action: string; keyCode: string; category: string }>;
  keyRemaps: RemapItem[];
  customActions: CustomActionItem[];
  playerConfig: MouseConfig;
};

const KEYBOARD_ACTIONS = [
  "forward",
  "back",
  "left",
  "right",
  "sprint",
  "sneak",
  "jump",
  "inventory",
  "swapHands",
  "drop",
  "pickBlock",
  "attack",
  "use",
  "hotbar1",
  "hotbar2",
  "hotbar3",
  "hotbar4",
  "hotbar5",
  "hotbar6",
  "hotbar7",
  "hotbar8",
  "hotbar9",
] as const;

const MOUSE_ROWS: Array<{ key: string; label: string; Cell: (props: { config: MouseConfig }) => ReactElement }> = [
  { key: "dpi", label: "DPI", Cell: DpiCell },
  { key: "sensitivity", label: "ゲーム内感度", Cell: SensitivityCell },
  { key: "cm360", label: "振り向き", Cell: Cm360Cell },
  { key: "winSens", label: "Win Sens", Cell: WindowsSpeedCell },
  { key: "cursorSpeed", label: "Cursor Speed", Cell: CursorSpeedCell },
  { key: "rawInput", label: "Raw Input", Cell: RawInputCell },
  { key: "accel", label: "Mouse Accel", Cell: AccelerationCell },
];

interface CompareViewProps {
  players: ComparePlayer[];
  /** ログインユーザーの slug（自分強調表示用、任意） */
  currentUserSlug?: string | null;
}

export function CompareView({ players, currentUserSlug }: CompareViewProps) {
  const basket = useCompareBasket();
  const { setView } = useKeybindingsFilters();
  const [diffOnly, setDiffOnly] = useState(false);

  if (players.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
        <p className="text-muted-foreground">
          比較する走者がいません。テーブルから ☆ ボタンで追加してください。
        </p>
        <Button onClick={() => setView("table")}>テーブルに戻る</Button>
      </div>
    );
  }

  const gridStyle = {
    gridTemplateColumns: `160px repeat(${players.length}, minmax(140px, 1fr))`,
  };

  // 差分判定: KEYBOARD_ACTIONS のうち、全プレイヤーの正規化済みキーコードが揃っていない行
  const keyboardRows = useMemo(() => {
    return KEYBOARD_ACTIONS.filter((action) => {
      if (!diffOnly) return true;
      const set = new Set(
        players.map((p) =>
          normalizeKeyCode(
            p.keybindings.find((kb) => kb.action === action)?.keyCode ?? "",
          ),
        ),
      );
      return set.size > 1;
    });
  }, [players, diffOnly]);

  return (
    <div className="flex-1 flex flex-col space-y-6">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-bold">
            走者比較 ({players.length})
          </h2>
          <Button
            variant={diffOnly ? "default" : "outline"}
            size="sm"
            onClick={() => setDiffOnly((d) => !d)}
          >
            差分のみ
          </Button>
        </div>
        <Button variant="outline" size="sm" onClick={() => setView("table")}>
          テーブルに戻る
        </Button>
      </div>

      {/* ヘッダー行（走者プロフィール） */}
      <div className="overflow-x-auto">
        <div className="grid items-stretch gap-2 min-w-fit" style={gridStyle}>
          <div className="font-medium text-sm text-muted-foreground self-end pb-2 px-2">
            項目
          </div>
          {players.map((player) => {
            const isSelf = currentUserSlug != null && player.slug === currentUserSlug;
            return (
              <Card
                key={player.slug}
                className={cn("relative", isSelf && "ring-2 ring-brand")}
              >
                <CardContent className="p-3 flex flex-col items-center gap-2">
                  <button
                    type="button"
                    onClick={() => basket.remove(player.slug)}
                    className="absolute top-1 right-1 p-1 rounded hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label="比較から外す"
                  >
                    <X className="h-3.5 w-3.5 text-muted-foreground" />
                  </button>
                  <Link to={`/player/${player.slug}`} className="flex flex-col items-center gap-1">
                    <MinecraftAvatar
                      uuid={player.uuid}
                      skinUrl={player.customSkinUrl}
                      size={48}
                      className="rounded-md"
                    />
                    <p className="font-medium text-sm text-center truncate max-w-full">
                      {player.displayName ?? player.mcid ?? player.slug}
                    </p>
                    {isSelf && (
                      <Badge variant="default" className="gap-1">
                        <Star className="h-3 w-3" /> あなた
                      </Badge>
                    )}
                  </Link>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      {/* キー配置セクション */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">キー配置</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <div className="grid gap-y-1 min-w-fit" style={gridStyle}>
            {keyboardRows.map((action) => (
              <SectionRow
                key={action}
                label={getActionLabel(action)}
                cells={players.map((p) => {
                  const kb = p.keybindings.find((k) => k.action === action);
                  return kb ? (
                    <KeyBadge
                      keyCode={kb.keyCode}
                      keyboardLayout={p.playerConfig?.keyboardLayout}
                    />
                  ) : (
                    <span className="text-muted-foreground/40">-</span>
                  );
                })}
              />
            ))}
            {keyboardRows.length === 0 && (
              <div className="col-span-full text-sm text-muted-foreground py-4 text-center">
                差分のあるキーバインドはありません
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* マウス設定セクション */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">マウス設定</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <div className="grid gap-y-1 min-w-fit" style={gridStyle}>
            {MOUSE_ROWS.map(({ key, label, Cell }) => (
              <SectionRow
                key={key}
                label={label}
                cells={players.map((p) => <Cell config={p.playerConfig} />)}
              />
            ))}
          </div>
        </CardContent>
      </Card>

      {/* リマップセクション */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">リマップ</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <div className="grid gap-y-1 min-w-fit" style={gridStyle}>
            <SectionRow
              label="登録"
              cells={players.map((p) => (
                <RemapCell
                  remaps={p.keyRemaps}
                  keyboardLayout={p.playerConfig?.keyboardLayout}
                />
              ))}
            />
          </div>
        </CardContent>
      </Card>

      {/* カスタムアクションセクション */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">カスタムアクション</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <div className="grid gap-y-1 min-w-fit" style={gridStyle}>
            <SectionRow
              label="登録"
              cells={players.map((p) => (
                <CustomActionCell
                  customActions={p.customActions}
                  keyboardLayout={p.playerConfig?.keyboardLayout}
                />
              ))}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function SectionRow({
  label,
  cells,
}: {
  label: string;
  cells: React.ReactNode[];
}) {
  return (
    <>
      <div className="text-sm text-muted-foreground px-2 py-2 self-center">
        {label}
      </div>
      {cells.map((cell, i) => (
        <div
          key={i}
          className="flex items-center justify-center px-2 py-2 border-l border-border/30 first:border-l-0"
        >
          {cell}
        </div>
      ))}
    </>
  );
}
