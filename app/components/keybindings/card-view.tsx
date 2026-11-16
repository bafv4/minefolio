// /keybindings/visual の「ビジュアル」カードビュー。
// 各ランナーをカードで一覧し、読み取り専用の仮想キーボードでキー配置を視覚的にスキャンできるようにする。
// 発見・参考用途が主目的。
//
// キーボード（実寸 1120px）はカード幅に収まるよう縮小して描く。走者画面のモバイル表示と同じ
// KeyboardScaledPreview を使い、タップ/クリックで実寸の全画面 Dialog が開く（縮小中はツールチップ等の
// 操作は inert。細部は Dialog で見る）。マウスは、キーボードと横に並べても収まる幅があるときだけ横に置き、
// そうでなければキーボードの下に置く。
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { ArrowRight, WandSparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { MinecraftAvatar } from "@/components/minecraft-avatar";
import { KeyboardScaledPreview } from "@/components/keyboard-scaled-preview";
import {
  VirtualKeyboard,
  VirtualMouse,
  keybindingsToMap,
} from "@/components/virtual-keyboard";
import { RemapViewToggle } from "@/components/remap-view-toggle";
import { filterRemapsForContext, toUiRemaps, type RemapContext } from "@/lib/remap-utils";
import {
  DpiCell,
  SensitivityCell,
  Cm360Cell,
} from "./keybindings-cells";
import { KeybindingsEmptyState } from "./keybindings-empty-state";
import type { KeybindingsRow } from "./keybindings-columns";
import { useT, useLocale } from "@/hooks/use-locale";
import { getLocalizedDisplayName } from "@/lib/slug";
import { parseFingerAssignments } from "@/lib/preset-read";

/**
 * 一度に描くカード数。縮小しても 1 枚は約 500px あり、157 人を全部描くとページが 8 万 px 近くになるため、
 * 「さらに表示」で足していく（状態はメモリのみ。URL や localStorage には残さない）。
 */
const PAGE_SIZE = 20;

export function CardView({ players }: { players: KeybindingsRow[] }) {
  const t = useT();
  // Trigger/Chat 表示切替は全カード共通（プロフィールページと同じセグメント）。
  // 種別付き（trigger/chat）リマップを持つプレイヤーが1人もいなければ両表示が同一のため出さない
  const [remapView, setRemapView] = useState<RemapContext>("trigger");
  const [limit, setLimit] = useState(PAGE_SIZE);
  const hasTypedRemaps = useMemo(
    () =>
      players.some((p) =>
        p.keyRemaps.some((r) => r.remapType === "trigger" || r.remapType === "chat"),
      ),
    [players],
  );

  if (players.length === 0) {
    return <KeybindingsEmptyState />;
  }

  const shown = players.slice(0, limit);
  const remaining = players.length - shown.length;

  return (
    <div className="flex flex-col gap-4">
      {hasTypedRemaps && (
        <div className="flex justify-end">
          <RemapViewToggle value={remapView} onChange={setRemapView} />
        </div>
      )}
      {shown.map((player, index) => (
        <RunnerKeyboardCard key={player.id} player={player} remapView={remapView} index={index} />
      ))}
      {remaining > 0 && (
        <div className="flex flex-col items-center gap-2 py-2">
          <p className="text-sm text-muted-foreground tabular-nums" aria-live="polite">
            {t("keybindings.shownCount", { shown: shown.length, total: players.length })}
          </p>
          <Button
            variant="outline"
            className="min-h-11 sm:min-h-8"
            onClick={() => setLimit((n) => n + PAGE_SIZE)}
          >
            {t("keybindings.showMore", { count: Math.min(PAGE_SIZE, remaining) })}
          </Button>
        </div>
      )}
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
        fingerAssignments: parseFingerAssignments(player.playerConfig?.fingerAssignments),
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
  const name = getLocalizedDisplayName(player, locale);

  return (
    <Card
      ref={cardRef}
      className="flex flex-col gap-3 py-5 [content-visibility:auto] [contain-intrinsic-size:auto_520px]"
    >
      <CardHeader className="px-5">
        <div className="flex items-center gap-2 min-w-0">
          <h2 className="min-w-0 flex-1 text-base font-semibold">
            <Link
              to={`/player/${player.slug}`}
              className="flex items-center gap-2 hover:opacity-80 transition-opacity min-w-0"
            >
              <MinecraftAvatar
                uuid={player.uuid}
                skinUrl={player.customSkinUrl}
                size={32}
                alt=""
                className="rounded-lg shrink-0"
              />
              <span className="truncate">{name}</span>
            </Link>
          </h2>
          <Badge variant="outline" className="text-[10px] shrink-0">
            {layout.replace("_", " ")}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="px-5 flex flex-col gap-3">
        {/* キーボード + マウス（カスタムボタン含む）を、カード幅に収まるよう縮小して描く。読み取り専用。
            タップ/クリックで実寸の Dialog が開く。画面外のカードは IntersectionObserver で可視化されるまで
            プレースホルダーに留め、VirtualKeyboard/VirtualMouse の生成コストを可視分のみに抑える。
            @container: 縮小せずにキーボードとマウスが横に並ぶ幅（約 1360px）があるときだけ横並び */}
        {visible ? (
          <div className="@container">
            <KeyboardScaledPreview
              dialogTitle={name}
              expandLabel={t("keybindings.expandKeyboard", { name })}
            >
              <div className="flex flex-col items-start gap-4 @min-[1360px]:flex-row">
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
            </KeyboardScaledPreview>
          </div>
        ) : (
          <div aria-hidden className="h-[300px] rounded-lg bg-muted/30 animate-pulse" />
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
