// /keybindings の「ビジュアル」カードビュー（view=grid）。
// 各ランナーをカードで一覧し、読み取り専用のコンパクトな VirtualKeyboard で
// キー配置を視覚的にスキャンできるようにする。発見・参考用途が主目的。
import { memo, useMemo } from "react";
import { Link } from "react-router";
import { ArrowRight, WandSparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { MinecraftAvatar } from "@/components/minecraft-avatar";
import {
  VirtualKeyboard,
  keybindingsToMap,
  type FingerAssignment,
} from "@/components/virtual-keyboard";
import { toUiRemaps } from "@/lib/remap-utils";
import {
  DpiCell,
  SensitivityCell,
  Cm360Cell,
} from "./keybindings-cells";
import type { KeybindingsRow } from "./keybindings-columns";
import { t } from "@/lib/messages";

function parseFingers(json: string | null | undefined): FingerAssignment {
  if (!json) return {};
  try {
    return JSON.parse(json) as FingerAssignment;
  } catch {
    return {};
  }
}

export function CardView({ players }: { players: KeybindingsRow[] }) {
  if (players.length === 0) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-muted-foreground rounded-lg border bg-card">
        {t("keybindings.noPlayers")}
      </div>
    );
  }

  // キーボードは原寸（baseSize 60）で描画し横はみ出しはカード内スクロールで吸収するため、
  // カードは 1 カラムで縦に積む（プロフィール画面と同じ表示方針）。
  return (
    <div className="flex flex-col gap-4">
      {players.map((player) => (
        <RunnerKeyboardCard key={player.id} player={player} />
      ))}
    </div>
  );
}

// メモ化 + content-visibility:auto で、多人数時に画面外カードの描画コストを抑える。
const RunnerKeyboardCard = memo(function RunnerKeyboardCard({
  player,
}: {
  player: KeybindingsRow;
}) {
  const layout = (player.playerConfig?.keyboardLayout || "US") as
    | "US"
    | "JIS"
    | "US_TKL"
    | "JIS_TKL";

  // 非仮想化リストのため、フィルタ変更による再レンダーで全カードが再計算されないようメモ化。
  const { fingerAssignments, remaps, keybindingsMap, customKeyboardKeys } =
    useMemo(
      () => ({
        fingerAssignments: parseFingers(player.playerConfig?.fingerAssignments),
        remaps: toUiRemaps(player.keyRemaps),
        keybindingsMap: keybindingsToMap(player.keybindings),
        customKeyboardKeys: (player.customKeys ?? [])
          .filter((ck) => ck.category === "keyboard")
          .map((ck) => ({ code: ck.keyCode, label: ck.keyName })),
      }),
      [player.playerConfig?.fingerAssignments, player.keyRemaps, player.keybindings, player.customKeys],
    );

  const remapCount = player.keyRemaps.length;
  const customActionCount = player.customActions.length;

  return (
    <Card className="flex flex-col [content-visibility:auto] [contain-intrinsic-size:auto_420px]">
      <CardHeader className="py-3">
        <div className="flex items-center gap-2 min-w-0">
          <Link
            to={`/player/${player.slug}`}
            className="flex items-center gap-2 hover:opacity-80 transition-opacity min-w-0 flex-1"
          >
            <MinecraftAvatar
              uuid={player.uuid}
              skinUrl={player.customSkinUrl}
              size={32}
              className="rounded-sm shrink-0"
            />
            <p className="font-medium text-sm truncate">
              {player.displayName ?? player.mcid ?? player.slug}
            </p>
          </Link>
          <Badge variant="outline" className="text-[10px] shrink-0">
            {layout.replace("_", " ")}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="pt-0 pb-4 flex flex-col gap-3">
        {/* ビジュアルキーボード（読み取り専用・コンパクト） */}
        <div className="overflow-x-auto pb-1 w-full">
          <VirtualKeyboard
            layout={layout}
            keybindings={keybindingsMap}
            fingerAssignments={fingerAssignments}
            remaps={remaps}
            customKeys={customKeyboardKeys}
            showActionLabels
            showFingerAssignments
            showRemaps
            hideNumpad
          />
        </div>

        {/* マウス要約 + リマップ/カスタムアクション件数 */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
          <MouseStat label="DPI">
            <DpiCell config={player.playerConfig} />
          </MouseStat>
          <MouseStat label={t("keybindings.inGameSensitivityRange")}>
            <SensitivityCell config={player.playerConfig} />
          </MouseStat>
          <MouseStat label={t("keybindings.turnDistanceRange")}>
            <Cm360Cell config={player.playerConfig} />
          </MouseStat>
          {remapCount > 0 && (
            <Badge variant="secondary" className="gap-1 text-xs">
              <ArrowRight className="h-3 w-3" />
              {t("keybindings.remapsTab")} {remapCount}
            </Badge>
          )}
          {customActionCount > 0 && (
            <Badge variant="secondary" className="gap-1 text-xs">
              <WandSparkles className="h-3 w-3" />
              {t("keybindings.customActionsTab")} {customActionCount}
            </Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
});

function MouseStat({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </span>
  );
}
