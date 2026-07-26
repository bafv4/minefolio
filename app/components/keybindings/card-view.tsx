// /keybindings の「ビジュアル」カードビュー（view=grid）。
// 各ランナーをカードで一覧し、読み取り専用のコンパクトな VirtualKeyboard で
// キー配置を視覚的にスキャンできるようにする。発見・参考用途が主目的。
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { ArrowRight, WandSparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { MinecraftAvatar } from "@/components/minecraft-avatar";
import {
  VirtualKeyboard,
  VirtualMouse,
  keybindingsToMap,
  type FingerAssignment,
} from "@/components/virtual-keyboard";
import { RemapViewToggle } from "@/components/remap-view-toggle";
import { filterRemapsForContext, toUiRemaps, type RemapContext } from "@/lib/remap-utils";
import {
  DpiCell,
  SensitivityCell,
  Cm360Cell,
} from "./keybindings-cells";
import type { KeybindingsRow } from "./keybindings-columns";
import { useT, useLocale } from "@/hooks/use-locale";
import { getLocalizedDisplayName } from "@/lib/slug";

function parseFingers(json: string | null | undefined): FingerAssignment {
  if (!json) return {};
  try {
    return JSON.parse(json) as FingerAssignment;
  } catch {
    return {};
  }
}

export function CardView({ players }: { players: KeybindingsRow[] }) {
  const t = useT();
  // Trigger/Chat 表示切替は全カード共通（プロフィールページと同じセグメント）。
  // 種別付き（trigger/chat）リマップを持つプレイヤーが1人もいなければ両表示が同一のため出さない
  const [remapView, setRemapView] = useState<RemapContext>("trigger");
  const hasTypedRemaps = useMemo(
    () =>
      players.some((p) =>
        p.keyRemaps.some((r) => r.remapType === "trigger" || r.remapType === "chat"),
      ),
    [players],
  );

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
      {hasTypedRemaps && (
        <div className="flex justify-end">
          <RemapViewToggle value={remapView} onChange={setRemapView} />
        </div>
      )}
      {players.map((player, index) => (
        <RunnerKeyboardCard key={player.id} player={player} remapView={remapView} index={index} />
      ))}
    </div>
  );
}

// 初期ビューポート分は即時描画し、それ以降は IntersectionObserver で画面内に入ってから
// キーボード/マウス描画をマウントする（画面外カード数分の VirtualKeyboard 生成コストを回避）。
const INITIAL_VISIBLE_COUNT = 3;

// メモ化 + content-visibility:auto で、多人数時に画面外カードの描画コストを抑える。
const RunnerKeyboardCard = memo(function RunnerKeyboardCard({
  player,
  remapView,
  index,
}: {
  player: KeybindingsRow;
  remapView: RemapContext;
  index: number;
}) {
  const t = useT();
  const locale = useLocale();
  const cardRef = useRef<HTMLDivElement>(null);
  // SSR/クライアント初期レンダーで一致させるため、index のみで判定する（typeof IntersectionObserver
  // による分岐は行わない。非対応環境のフォールバックは直下の useEffect 側で処理する）。
  const [visible, setVisible] = useState(() => index < INITIAL_VISIBLE_COUNT);

  useEffect(() => {
    if (visible) return;
    const el = cardRef.current;
    // IntersectionObserver 非対応環境では全カードを即時可視扱いにフォールバック
    if (!el || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.unobserve(el);
        }
      },
      { rootMargin: "600px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [visible]);

  const layout = (player.playerConfig?.keyboardLayout || "US") as
    | "US"
    | "JIS"
    | "US_TKL"
    | "JIS_TKL";

  // 非仮想化リストのため、フィルタ変更による再レンダーで全カードが再計算されないようメモ化。
  const { fingerAssignments, remaps, keybindingsMap, customKeyboardKeys, customButtons } =
    useMemo(
      () => ({
        fingerAssignments: parseFingers(player.playerConfig?.fingerAssignments),
        // 一覧カードのキーボードは選択中の表示文脈（Trigger/Chat）のリマップに絞る
        remaps: toUiRemaps(filterRemapsForContext(player.keyRemaps, remapView)),
        keybindingsMap: keybindingsToMap(player.keybindings),
        customKeyboardKeys: (player.customKeys ?? [])
          .filter((ck) => ck.category === "keyboard")
          .map((ck) => ({ code: ck.keyCode, label: ck.keyName })),
        customButtons: (player.customKeys ?? []).map((ck) => ({
          code: ck.keyCode,
          label: ck.keyName,
          category: ck.category as "mouse" | "keyboard",
        })),
      }),
      [player.playerConfig?.fingerAssignments, player.keyRemaps, player.keybindings, player.customKeys, remapView],
    );

  const remapCount = player.keyRemaps.length;
  const customActionCount = player.customActions.length;

  return (
    <Card
      ref={cardRef}
      className="flex flex-col [content-visibility:auto] [contain-intrinsic-size:auto_560px]"
    >
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
              {getLocalizedDisplayName(player, locale)}
            </p>
          </Link>
          <Badge variant="outline" className="text-[10px] shrink-0">
            {layout.replace("_", " ")}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="pt-0 pb-4 flex flex-col gap-3">
        {/* キーボード + マウス（カスタムボタン含む）。広い画面では横並び。読み取り専用。
            画面外のカードは IntersectionObserver で可視化されるまでプレースホルダーに留め、
            VirtualKeyboard/VirtualMouse の生成コストを可視分のみに抑える。 */}
        {visible ? (
          <div className="flex flex-col lg:flex-row lg:items-start gap-4">
            <div className="custom-scrollbar overflow-x-auto pb-1 min-w-0 lg:flex-1">
              <VirtualKeyboard
                layout={layout}
                keybindings={keybindingsMap}
                fingerAssignments={fingerAssignments}
                remaps={remaps}
                customActions={player.customActions}
                customKeys={customKeyboardKeys}
                showActionLabels
                showFingerAssignments
                showRemaps
                hideNumpad
              />
            </div>
            <div className="custom-scrollbar overflow-x-auto pb-1 shrink-0">
              <VirtualMouse
                keybindings={keybindingsMap}
                fingerAssignments={fingerAssignments}
                remaps={remaps}
                customActions={player.customActions}
                customButtons={customButtons}
                showActionLabels
                showFingerAssignments
                showRemaps
              />
            </div>
          </div>
        ) : (
          <div className="h-[420px] rounded-md bg-muted/30 animate-pulse" />
        )}

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
