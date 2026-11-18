import { createTranslator } from "@/lib/messages";
import { localeFromMatches } from "@/lib/locale";
import { useLoaderData, useSearchParams, Link, type ShouldRevalidateFunctionArgs } from "react-router";
import type { Route } from "./+types/compare";
import { createDb } from "@/lib/db";
import { getEnv } from "@/lib/env.server";
import { users, configPresets } from "@/lib/schema";
import { eq, asc, and, sql } from "drizzle-orm";
import {
  decodePresetConfig,
  decodePresetKeybindings,
  shouldUsePresetSnapshot,
  type PresetSnapshot,
} from "@/lib/preset-read";
import { publiclyReferencableCondition } from "@/lib/users-filter";
import { getActionLabel, getKeyLabel } from "@/lib/keybindings";
import { toSensitivityPercent } from "@/lib/mouse-settings";
import { rtaCareerLabel, rtaCareerView } from "@/lib/rta-career";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { MinecraftAvatar } from "@/components/minecraft-avatar";
import { NoticeBanner } from "@/components/notice-banner";
import { ArrowLeftRight, Check, ChevronsUpDown, GitCompare, User, Users, TriangleAlert } from "lucide-react";
import { useState, useMemo, type ReactNode } from "react";
import { useT, useLocale } from "@/hooks/use-locale";
import { getLocalizedDisplayName } from "@/lib/slug";
import type { Translator } from "@/lib/messages";

export const meta: Route.MetaFunction = ({ matches, loaderData }) => {
  const t = createTranslator(localeFromMatches(matches));
  const title = `${t("compare.title")} - Minefolio`;
  const description = t("compare.description");
  const appUrl = loaderData?.appUrl || "https://minefolio.app";
  const ogImage = `${appUrl}/icon.png`;
  return [
    { title },
    { name: "description", content: description },
    { property: "og:type", content: "website" },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:image", content: ogImage },
    { name: "twitter:card", content: "summary" },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
    { name: "twitter:image", content: ogImage },
  ];
};

// 比較用のアクション一覧
const COMPARE_ACTIONS = [
  // 移動
  { action: "forward", category: "movement" },
  { action: "back", category: "movement" },
  { action: "left", category: "movement" },
  { action: "right", category: "movement" },
  { action: "jump", category: "movement" },
  { action: "sneak", category: "movement" },
  { action: "sprint", category: "movement" },
  // 戦闘
  { action: "attack", category: "combat" },
  { action: "use", category: "combat" },
  { action: "pickBlock", category: "combat" },
  { action: "drop", category: "combat" },
  // インベントリ
  { action: "inventory", category: "inventory" },
  { action: "swapHands", category: "inventory" },
  { action: "hotbar1", category: "inventory" },
  { action: "hotbar2", category: "inventory" },
  { action: "hotbar3", category: "inventory" },
  { action: "hotbar4", category: "inventory" },
  { action: "hotbar5", category: "inventory" },
  { action: "hotbar6", category: "inventory" },
  { action: "hotbar7", category: "inventory" },
  { action: "hotbar8", category: "inventory" },
  { action: "hotbar9", category: "inventory" },
  // UI
  { action: "togglePerspective", category: "ui" },
  { action: "fullscreen", category: "ui" },
  { action: "chat", category: "ui" },
  { action: "command", category: "ui" },
];

// ラベルは描画時に t() で解決する（モジュール評価時はロケールが未確定）
const categoryLabelsOf = (t: Translator): Record<string, string> => ({
  movement: t("compare.movement"),
  combat: t("compare.combat"),
  inventory: t("compare.inventory"),
  ui: "UI",
});

// 比較用に取得するメイン（公開用）プリセットのスナップショット列
const MAIN_PRESET_COLUMNS = {
  id: true,
  isActive: true,
  keybindingsData: true,
  playerConfigData: true,
  remapsData: true,
  fingerAssignmentsData: true,
} as const;

// 公開比較はメイン（公開用）プリセットのスナップショットを優先する。
// メインが無いユーザー、およびメインが編集中（isActive＝ライブが現在適用中の設定そのもの）の
// ユーザーはライブへフォールバックする（判定は shouldUsePresetSnapshot に集約）。
// スナップショットを使う場合、null の種別は「空」であり編集中のライブデータを混ぜない。
// デコード行はライブ行と構造互換のためキャストで型を維持する。
function applyMainPreset<
  P extends {
    id: string;
    keybindings: unknown;
    keyRemaps: unknown;
    playerConfig: unknown;
    configPresets: (PresetSnapshot & { id: string; isActive: boolean })[];
  },
>(player: P): Omit<P, "configPresets"> {
  const { configPresets: userPresets, ...rest } = player;
  const main = userPresets[0];
  if (!shouldUsePresetSnapshot(main)) return rest;
  const decoded = decodePresetConfig(main, player.id);
  return {
    ...rest,
    keybindings: decoded.keybindings,
    keyRemaps: decoded.keyRemaps,
    playerConfig: decoded.playerConfig
      ? {
          ...(player.playerConfig ?? {}),
          ...decoded.playerConfig,
          fingerAssignments: decoded.fingerAssignments,
        }
      : null,
  } as unknown as Omit<P, "configPresets">;
}

// 選択用一覧の列（Select の選択肢に使う分）
const SELECT_COLUMNS = {
  mcid: true,
  uuid: true,
  slug: true,
  displayName: true,
  displayNameAlphabet: true,
  customSkinUrl: true,
} as const;

type SelectablePlayer = {
  mcid: string | null;
  uuid: string | null;
  slug: string;
  displayName: string | null;
  displayNameAlphabet: string | null;
  customSkinUrl: string | null;
};

/**
 * URL で指定され loader が表示を許した走者が選択用一覧（公開のみ・上限100人）に無いとき、
 * その走者だけを選択肢の末尾に足す（一覧の方針そのものは変えない）。
 */
function withReferencedPlayers<T extends SelectablePlayer>(
  list: T[],
  referenced: (SelectablePlayer | null | undefined)[],
): SelectablePlayer[] {
  const result: SelectablePlayer[] = [...list];
  for (const p of referenced) {
    if (!p || result.some((x) => x.slug === p.slug)) continue;
    result.push({
      mcid: p.mcid,
      uuid: p.uuid,
      slug: p.slug,
      displayName: p.displayName,
      displayNameAlphabet: p.displayNameAlphabet,
      customSkinUrl: p.customSkinUrl,
    });
  }
  return result;
}

export async function loader({ request }: Route.LoaderArgs) {
  const env = getEnv();
  const appUrl = env.APP_URL || "https://minefolio.app";
  const db = createDb();
  const url = new URL(request.url);

  // RTA歴の経過計算の基準時刻（SSR とハイドレーションで結果を揃える）
  const now = Date.now();

  const p1 = url.searchParams.get("p1");
  const p2 = url.searchParams.get("p2");

  // 走者一覧（選択用）: 一覧なので公開プロフィールのみ。
  // drizzle のクエリは await されるまで実行されないので、各分岐の Promise.all に渡して他クエリと並列に走らせる
  const allPlayersQuery = db.query.users.findMany({
    where: eq(users.profileVisibility, "public"),
    columns: {
      mcid: true,
      uuid: true,
      slug: true,
      displayName: true,
      displayNameAlphabet: true,
      customSkinUrl: true,
    },
    orderBy: [asc(users.slug)],
    limit: 100,
  });

  // p1のみ指定の場合、類似走者を検索（slugで検索）
  if (p1 && !p2) {
    // 比較元・類似度計算用の全ユーザー・選択用一覧は互いに独立なので並列に取得する
    // （類似度計算側はメインプリセットのスナップショットを優先。無いユーザーのみライブ）
    const [allPlayers, player1Raw, allUsersWithKeybindings] = await Promise.all([
      allPlayersQuery,
      db.query.users.findFirst({
        // 非公開（private）は比較対象にしない。限定公開（unlisted）はURL指定なら可
        where: and(
          eq(users.slug, p1),
          publiclyReferencableCondition,
        ),
        with: {
          keybindings: true,
          playerConfig: true,
          keyRemaps: true,
          configPresets: {
            where: eq(configPresets.isMain, true),
            columns: MAIN_PRESET_COLUMNS,
          },
        },
      }),
      db.query.users.findMany({
        where: and(sql`${users.slug} != ${p1}`, eq(users.profileVisibility, "public")),
        columns: {
          id: true,
          mcid: true,
          uuid: true,
          slug: true,
          displayName: true,
          displayNameAlphabet: true,
          customSkinUrl: true,
        },
        with: {
          // 類似度計算に使うのは action / keyCode のみ（メイン持ちユーザーでは未使用のため最小限に）
          keybindings: { columns: { action: true, keyCode: true } },
          configPresets: {
            where: eq(configPresets.isMain, true),
            columns: { id: true, isActive: true, keybindingsData: true },
          },
        },
        limit: 50,
      }),
    ]);

    if (!player1Raw) {
      return {
        allPlayers,
        player1: null,
        player2: null,
        similarPlayers: [],
        notFoundSlugs: [p1],
        appUrl,
        now,
      };
    }
    const player1Data = applyMainPreset(player1Raw);

    // p1のキーバインドをマップ化
    const p1KeyMap: Record<string, string> = {};
    for (const kb of player1Data.keybindings) {
      p1KeyMap[kb.action] = kb.keyCode;
    }

    const similarPlayers = allUsersWithKeybindings
      .map((user) => {
        const mainPreset = user.configPresets[0];
        const userKeybindings = shouldUsePresetSnapshot(mainPreset)
          ? (decodePresetKeybindings(mainPreset.keybindingsData, user.id) ?? [])
          : user.keybindings;
        const userKeyMap: Record<string, string> = {};
        for (const kb of userKeybindings) {
          userKeyMap[kb.action] = kb.keyCode;
        }

        // 一致数を計算
        let matches = 0;
        let total = 0;
        for (const item of COMPARE_ACTIONS) {
          const k1 = p1KeyMap[item.action];
          const k2 = userKeyMap[item.action];
          if (k1 && k2) {
            total++;
            if (k1 === k2) {
              matches++;
            }
          }
        }

        const similarity = total > 0 ? matches / total : 0;
        return {
          mcid: user.mcid,
          uuid: user.uuid,
          slug: user.slug,
          displayName: user.displayName,
          displayNameAlphabet: user.displayNameAlphabet,
          customSkinUrl: user.customSkinUrl,
          matches,
          total,
          similarity,
        };
      })
      .filter((p) => p.total > 0 && p.similarity > 0)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 10);

    return {
      allPlayers: withReferencedPlayers(allPlayers, [player1Data]),
      player1: player1Data,
      player2: null,
      similarPlayers,
      notFoundSlugs: [] as string[],
      appUrl,
      now,
    };
  }

  // 両方指定されていない場合は選択画面のみ（p2 だけ指定のときは、その走者の有無だけ確かめる）
  if (!p1 || !p2) {
    const [allPlayers, p2Only] = await Promise.all([
      allPlayersQuery,
      p2
        ? db.query.users.findFirst({
            where: and(eq(users.slug, p2), publiclyReferencableCondition),
            columns: SELECT_COLUMNS,
          })
        : Promise.resolve(undefined),
    ]);
    return {
      allPlayers: withReferencedPlayers(allPlayers, [p2Only]),
      player1: null,
      player2: null,
      similarPlayers: [],
      notFoundSlugs: p2 && !p2Only ? [p2] : [],
      appUrl,
      now,
    };
  }

  // 両走者のデータを取得（slugで検索・メインプリセットのスナップショット優先）
  const [allPlayers, player1Raw, player2Raw] = await Promise.all([
    allPlayersQuery,
    db.query.users.findFirst({
      // 非公開（private）は比較対象にしない。限定公開（unlisted）はURL指定なら可
      where: and(
        eq(users.slug, p1),
        publiclyReferencableCondition,
      ),
      with: {
        keybindings: true,
        playerConfig: true,
        keyRemaps: true,
        configPresets: {
          where: eq(configPresets.isMain, true),
          columns: MAIN_PRESET_COLUMNS,
        },
      },
    }),
    db.query.users.findFirst({
      where: and(
        eq(users.slug, p2),
        publiclyReferencableCondition,
      ),
      with: {
        keybindings: true,
        playerConfig: true,
        keyRemaps: true,
        configPresets: {
          where: eq(configPresets.isMain, true),
          columns: MAIN_PRESET_COLUMNS,
        },
      },
    }),
  ]);
  const player1Data = player1Raw ? applyMainPreset(player1Raw) : undefined;
  const player2Data = player2Raw ? applyMainPreset(player2Raw) : undefined;

  return {
    allPlayers: withReferencedPlayers(allPlayers, [player1Data, player2Data]),
    player1: player1Data ?? null,
    player2: player2Data ?? null,
    similarPlayers: [],
    notFoundSlugs: [
      ...(player1Data ? [] : [p1]),
      ...(player2Data ? [] : [p2]),
    ],
    appUrl,
    now,
  };
}

// 「違いだけ表示」（?diff=1）だけが変わるナビゲーションではサーバーデータが同一なので再取得しない
export function shouldRevalidate({ currentUrl, nextUrl, defaultShouldRevalidate }: ShouldRevalidateFunctionArgs) {
  const strip = (url: URL) => {
    const p = new URLSearchParams(url.search);
    p.delete("diff");
    return `${url.pathname}?${p.toString()}`;
  };
  if (strip(currentUrl) === strip(nextUrl)) return false;
  return defaultShouldRevalidate;
}

/** 比較の行で、違う行に付ける印（前景色の点＋「異なる」）。色やアイコンだけに頼らず文字で示す */
function DifferentMark() {
  const t = useT();
  return (
    <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium">
      <span aria-hidden="true" className="size-1.5 rounded-full bg-foreground" />
      {t("compare.different")}
    </span>
  );
}

/**
 * 比較ヘッダーに添える RTA歴（設定している走者のみ）。
 * 文言はプロフィールと同じキーを共有し、密度に合わせて 1 行の小さめ表示にする。
 */
function RtaCareerLine({ value, now }: { value: string | null; now: number }) {
  const t = useT();
  const locale = useLocale();
  const view = rtaCareerView(value, locale, new Date(now));
  if (!view) return null;
  return <p className="text-xs text-muted-foreground">{rtaCareerLabel(t, view)}</p>;
}

/** 案内に出す slug。極端に長い値は切り詰める */
function truncateSlug(slug: string): string {
  return slug.length > 40 ? `${slug.slice(0, 40)}…` : slug;
}

/** ゲーム内感度の表示用ラベル（%表記）。計算できなければ undefined */
function sensitivityLabel(sensitivity: number | null | undefined): string | undefined {
  const percent = toSensitivityPercent(sensitivity);
  return percent != null ? `${percent}%` : undefined;
}

/**
 * 走者を選ぶコンボボックス（検索欄と候補を1つにまとめた物。見た目は ui/combobox と同じ）。
 * ui/combobox は候補が文字列のラベルだけで、検索が value（slug）にしか当たらないため、ここで Popover＋Command を直接組む。
 * 検索は表示名・アルファベット表記・MCID・slug（cmdk の keywords）。名前は見出し（labelId）＋選択中の名前で読む
 */
function RunnerPicker({
  labelId,
  allPlayers,
  options,
  value,
  onValueChange,
}: {
  labelId: string;
  /** 選択中の名前を引く一覧（相手の走者を除く前） */
  allPlayers: SelectablePlayer[];
  /** 候補（相手で選ばれている走者を除いた一覧） */
  options: SelectablePlayer[];
  value: string;
  onValueChange: (slug: string) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const valueId = `${labelId}-value`;
  // 選択中の走者は loader の一覧（withReferencedPlayers で URL 指定の走者を含む）から引くので、SSR の時点で名前が出る
  const selected = allPlayers.find((p) => p.slug === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          role="combobox"
          aria-expanded={open}
          aria-labelledby={`${labelId} ${valueId}`}
          className="min-h-11 w-full justify-between rounded-md border border-muted-foreground/70 bg-input px-3 font-normal shadow-xs hover:border-ring/50 hover:bg-input sm:min-h-9"
        >
          <span id={valueId} className={cn("flex min-w-0 items-center gap-2", !selected && "text-muted-foreground")}>
            {selected ? (
              <>
                <MinecraftAvatar uuid={selected.uuid} size={20} skinUrl={selected.customSkinUrl} alt="" className="shrink-0" />
                <span className="truncate">{getLocalizedDisplayName(selected, locale)}</span>
              </>
            ) : (
              t("compare.selectRunner")
            )}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command>
          <CommandInput placeholder={t("compare.searchPlaceholder")} aria-label={t("compare.searchPlaceholder")} />
          <CommandList>
            <CommandEmpty>{t("compare.noRunnerMatch")}</CommandEmpty>
            <CommandGroup>
              {options.map((p) => (
                <CommandItem
                  key={p.slug}
                  value={p.slug}
                  keywords={[p.displayName, p.displayNameAlphabet, p.mcid].filter((k): k is string => !!k)}
                  onSelect={() => {
                    if (p.slug !== value) onValueChange(p.slug);
                    setOpen(false);
                  }}
                >
                  <MinecraftAvatar uuid={p.uuid} size={20} skinUrl={p.customSkinUrl} alt="" className="shrink-0" />
                  <span className="min-w-0 truncate">{getLocalizedDisplayName(p, locale)}</span>
                  {p.mcid && <span className="shrink-0 text-xs text-muted-foreground">@{p.mcid}</span>}
                  <Check className={cn("ml-auto h-4 w-4", p.slug === value ? "opacity-100" : "opacity-0")} aria-hidden="true" />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** 比較する走者（列見出しに出す分） */
type CompareColumnPlayer = Pick<SelectablePlayer, "uuid" | "customSkinUrl" | "mcid" | "slug" | "displayName" | "displayNameAlphabet">;

type CompareTableRow = {
  key: string;
  label: string;
  value1: ReactNode;
  value2: ReactNode;
  different: boolean;
};

/**
 * 2人の値を並べる表（キー配置・デバイスで同じ形）。列は「項目｜走者1｜走者2」、列見出しはアバター＋名前。
 * 違う行だけ行全体を中立な面＋「異なる」の文字で示す（一致・両方未設定は装飾なし）
 */
function CompareTable({
  labelledBy,
  firstColumnLabel,
  player1,
  player2,
  rows,
}: {
  labelledBy: string;
  firstColumnLabel: string;
  player1: CompareColumnPlayer;
  player2: CompareColumnPlayer;
  rows: CompareTableRow[];
}) {
  const locale = useLocale();
  const columnHeader = (player: CompareColumnPlayer) => {
    const name = getLocalizedDisplayName(player, locale);
    return (
      <span role="columnheader" title={name} className="flex min-w-0 max-w-28 items-center justify-center gap-1.5 sm:max-w-40">
        <MinecraftAvatar uuid={player.uuid} size={20} skinUrl={player.customSkinUrl} alt="" className="shrink-0" />
        <span className="min-w-0 truncate">{name}</span>
      </span>
    );
  };
  return (
    <div
      role="table"
      aria-labelledby={labelledBy}
      className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-x-4 divide-y divide-border/60"
    >
      <div
        role="row"
        className="col-span-full -mx-2 grid grid-cols-subgrid items-end px-2 pb-2 text-xs font-medium text-muted-foreground"
      >
        <span role="columnheader">{firstColumnLabel}</span>
        {columnHeader(player1)}
        {columnHeader(player2)}
      </div>
      {rows.map((row) => (
        <div
          key={row.key}
          role="row"
          className={cn(
            "col-span-full -mx-2 grid grid-cols-subgrid items-center px-2 py-2",
            row.different && "bg-secondary/50",
          )}
        >
          <div role="rowheader" className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="text-sm">{row.label}</span>
            {row.different && <DifferentMark />}
          </div>
          <div role="cell" className="text-center">{row.value1}</div>
          <div role="cell" className="text-center">{row.value2}</div>
        </div>
      ))}
    </div>
  );
}

function KeyChip({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-block min-w-16 text-center px-2.5 py-1 bg-secondary/80 rounded text-sm font-mono">
      {children}
    </kbd>
  );
}

export default function ComparePage() {
  const t = useT();
  const locale = useLocale();
  const { allPlayers, player1, player2, similarPlayers, notFoundSlugs, now } =
    useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();

  const selectedP1 = searchParams.get("p1") ?? "";
  const selectedP2 = searchParams.get("p2") ?? "";
  // loader が「指定されたが表示できなかった」と返した slug（存在しない・非公開は区別しない）
  const p1Missing = selectedP1 !== "" && notFoundSlugs.includes(selectedP1);
  const p2Missing = selectedP2 !== "" && notFoundSlugs.includes(selectedP2);
  // 「違いだけ表示」。共有・再読み込みで保つため URL の ?diff=1 に載せる（既定はオフ＝全行）
  const diffOnly = searchParams.get("diff") === "1";
  const setDiffOnly = (checked: boolean) => {
    const params = new URLSearchParams(searchParams);
    if (checked) {
      params.set("diff", "1");
    } else {
      params.delete("diff");
    }
    setSearchParams(params, { replace: true, preventScrollReset: true });
  };

  const handleSelectPlayer = (slot: "p1" | "p2", slug: string) => {
    const params = new URLSearchParams(searchParams);
    if (slug) {
      params.set(slot, slug);
    } else {
      params.delete(slot);
    }
    setSearchParams(params);
  };

  // 走者 1 と 2 を入れ替える（URL の p1 / p2 を入れ替える。片方だけ指定でも入れ替える）
  const swapPlayers = () => {
    const params = new URLSearchParams(searchParams);
    params.delete("p1");
    params.delete("p2");
    if (selectedP2) params.set("p1", selectedP2);
    if (selectedP1) params.set("p2", selectedP1);
    setSearchParams(params, { preventScrollReset: true });
  };

  // もう片方で選ばれている走者は候補から外す（同じ走者どうしを比べない）
  const options1 = useMemo(() => allPlayers.filter((p) => !selectedP2 || p.slug !== selectedP2), [allPlayers, selectedP2]);
  const options2 = useMemo(() => allPlayers.filter((p) => !selectedP1 || p.slug !== selectedP1), [allPlayers, selectedP1]);

  // キーバインドをマップ化
  const p1Keybindings = useMemo(() => {
    const map: Record<string, string> = {};
    if (player1?.keybindings) {
      for (const kb of player1.keybindings) {
        map[kb.action] = kb.keyCode;
      }
    }
    return map;
  }, [player1]);

  const p2Keybindings = useMemo(() => {
    const map: Record<string, string> = {};
    if (player2?.keybindings) {
      for (const kb of player2.keybindings) {
        map[kb.action] = kb.keyCode;
      }
    }
    return map;
  }, [player2]);

  // カテゴリ別にグループ化
  const groupedActions = useMemo(() => {
    const groups: Record<string, typeof COMPARE_ACTIONS> = {};
    for (const item of COMPARE_ACTIONS) {
      if (!groups[item.category]) {
        groups[item.category] = [];
      }
      groups[item.category].push(item);
    }
    return groups;
  }, []);

  // 一致・不一致の統計（行の印・「違いだけ表示」と同じ基準 compareValues）。両方未設定（どちらも「-」）は一致に数える
  const stats = useMemo(() => {
    if (!player1 || !player2) return { same: 0, different: 0, total: 0 };

    let same = 0;
    let different = 0;

    for (const item of COMPARE_ACTIONS) {
      const result = compareValues(p1Keybindings[item.action], p2Keybindings[item.action]);
      if (result === "different") different++;
      else same++;
    }

    return { same, different, total: same + different };
  }, [player1, player2, p1Keybindings, p2Keybindings]);

  const runnerSlot = (slot: "p1" | "p2") => {
    const labelId = `compare-${slot}-label`;
    const selected = slot === "p1" ? selectedP1 : selectedP2;
    const missing = slot === "p1" ? p1Missing : p2Missing;
    const player = slot === "p1" ? player1 : player2;
    return (
      <div className="min-w-0 space-y-2">
        <h2 id={labelId} className="text-sm font-medium text-muted-foreground">
          {slot === "p1" ? t("compare.runner1") : t("compare.runner2")}
        </h2>
        <RunnerPicker
          labelId={labelId}
          allPlayers={allPlayers}
          options={slot === "p1" ? options1 : options2}
          value={missing ? "" : selected}
          onValueChange={(v) => handleSelectPlayer(slot, v)}
        />
        {missing && (
          <NoticeBanner tone="warning" icon={TriangleAlert} className="px-3 py-2">
            <span className="break-all">{t("compare.playerNotFound", { slug: truncateSlug(selected) })}</span>
          </NoticeBanner>
        )}
        {player && (
          <Link
            to={`/player/${player.slug}`}
            className="inline-flex min-h-11 items-center gap-2 text-sm text-primary hover:underline sm:min-h-6"
          >
            <User className="h-4 w-4" aria-hidden="true" />
            {t("compare.viewProfile")}
          </Link>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <GitCompare className="h-6 w-6" />
          {t("compare.title")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t("compare.description")}
        </p>
      </div>

      {/* 走者選択（箱にせず、2つの選択欄と入れ替えボタンを1行に。モバイルは縦に積む） */}
      <div className="grid grid-cols-1 items-start gap-3 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:gap-4">
        {runnerSlot("p1")}
        <div className="flex justify-center md:pt-7">
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={swapPlayers}
            disabled={!selectedP1 && !selectedP2}
            aria-label={t("compare.swapRunners")}
            title={t("compare.swapRunners")}
            className="size-11 sm:size-9"
          >
            <ArrowLeftRight className="max-md:rotate-90" aria-hidden="true" />
          </Button>
        </div>
        {runnerSlot("p2")}
      </div>

      {/* 比較結果 */}
      {player1 && player2 && (
        <>
          {/* 統計サマリー */}
          <Card className="gap-3 py-5">
            <CardContent className="px-5">
              <div className="flex flex-wrap items-center justify-center gap-6">
                <div className="flex items-center gap-2">
                  <MinecraftAvatar uuid={player1.uuid} size={40} skinUrl={player1.customSkinUrl} />
                  <div>
                    <p className="font-bold">{getLocalizedDisplayName(player1, locale)}</p>
                    {player1.mcid && <p className="text-xs text-muted-foreground">@{player1.mcid}</p>}
                    <RtaCareerLine value={player1.rtaStartedYearMonth} now={now} />
                  </div>
                </div>
                <div className="text-center px-6">
                  {/* 下の件数はキー配置の表だけを数える（デバイス・設定の表は含めない）ので、対象を明示する */}
                  <p className="mb-1 text-xs font-medium text-muted-foreground">{t("compare.keybindingComparison")}</p>
                  <div className="flex items-center gap-4">
                    <div className="text-center">
                      <p className="text-2xl font-bold">{stats.same}</p>
                      <p className="text-xs text-muted-foreground">{t("compare.same")}</p>
                    </div>
                    <div className="text-center">
                      <p className="text-2xl font-bold">{stats.different}</p>
                      <p className="text-xs text-muted-foreground">{t("compare.different")}</p>
                    </div>
                  </div>
                  {stats.total > 0 && (
                    <p className="text-sm text-muted-foreground mt-2">
                      {t("compare.matchRate", { rate: Math.round((stats.same / stats.total) * 100) })}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <MinecraftAvatar uuid={player2.uuid} size={40} skinUrl={player2.customSkinUrl} />
                  <div>
                    <p className="font-bold">{getLocalizedDisplayName(player2, locale)}</p>
                    {player2.mcid && <p className="text-xs text-muted-foreground">@{player2.mcid}</p>}
                    <RtaCareerLine value={player2.rtaStartedYearMonth} now={now} />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* 違いだけ表示（キー配置・デバイスの両方の表に効く）。ラベルごと押せる */}
          <div className="flex justify-end">
            <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm sm:min-h-8">
              <Switch checked={diffOnly} onCheckedChange={setDiffOnly} />
              {t("compare.diffOnly")}
            </label>
          </div>

          {/* キーバインド比較。デスクトップでは表の幅を絞り、操作名と値の間の視線の往復を減らす */}
          <div className="max-w-3xl space-y-4">
            <h2 className="text-lg font-semibold">{t("compare.keybindingComparison")}</h2>
            {(() => {
              const categories = Object.entries(groupedActions).map(([category, actions]) => {
                const rows: CompareTableRow[] = actions.map((item) => {
                  const key1 = p1Keybindings[item.action];
                  const key2 = p2Keybindings[item.action];
                  return {
                    key: item.action,
                    label: getActionLabel(t, item.action),
                    value1: <KeyChip>{key1 ? getKeyLabel(t, key1) : "-"}</KeyChip>,
                    value2: <KeyChip>{key2 ? getKeyLabel(t, key2) : "-"}</KeyChip>,
                    different: compareValues(key1, key2) === "different",
                  };
                });
                return { category, rows: diffOnly ? rows.filter((row) => row.different) : rows };
              });
              // 「違いだけ表示」で違いの無いカテゴリは、カードを並べずに末尾の1行にまとめる
              const shown = categories.filter((c) => c.rows.length > 0);
              const hiddenCount = categories.length - shown.length;
              return (
                <>
                  {shown.map(({ category, rows }) => {
                    const titleId = `compare-category-${category}`;
                    return (
                      <Card key={category} className="gap-3 py-5">
                        <CardHeader className="px-5">
                          <CardTitle id={titleId} className="text-base">
                            {categoryLabelsOf(t)[category]}
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="px-5">
                          <CompareTable
                            labelledBy={titleId}
                            firstColumnLabel={t("compare.actionColumn")}
                            player1={player1}
                            player2={player2}
                            rows={rows}
                          />
                        </CardContent>
                      </Card>
                    );
                  })}
                  {hiddenCount > 0 && (
                    <p className="text-sm text-muted-foreground">
                      {shown.length === 0 ? t("compare.noDifferences") : t("compare.otherCategoriesNoDifferences")}
                    </p>
                  )}
                </>
              );
            })()}
          </div>

          {/* デバイス・設定の比較（キー配置と同じ形の表） */}
          <div className="max-w-3xl space-y-4">
            <h2 id="compare-device-heading" className="text-lg font-semibold">{t("compare.deviceComparison")}</h2>
            {(() => {
              const onOff = (value: boolean | null | undefined) =>
                value != null ? (value ? t("common.on") : t("common.off")) : undefined;
              const deviceRows = [
                {
                  label: t("compare.mouseDpi"),
                  value1: player1.playerConfig?.mouseDpi?.toString(),
                  value2: player2.playerConfig?.mouseDpi?.toString(),
                },
                {
                  label: t("compare.inGameSensitivity"),
                  value1: sensitivityLabel(player1.playerConfig?.gameSensitivity),
                  value2: sensitivityLabel(player2.playerConfig?.gameSensitivity),
                },
                {
                  label: t("compare.keyboardLayout"),
                  value1: player1.playerConfig?.keyboardLayout ?? undefined,
                  value2: player2.playerConfig?.keyboardLayout ?? undefined,
                },
                {
                  label: t("compare.toggleSprint"),
                  value1: onOff(player1.playerConfig?.toggleSprint),
                  value2: onOff(player2.playerConfig?.toggleSprint),
                },
                {
                  label: "Raw Input",
                  value1: onOff(player1.playerConfig?.rawInput),
                  value2: onOff(player2.playerConfig?.rawInput),
                },
              ];
              const rows: CompareTableRow[] = deviceRows.map((row) => ({
                key: row.label,
                label: row.label,
                value1: <span className="text-sm">{row.value1 ?? "-"}</span>,
                value2: <span className="text-sm">{row.value2 ?? "-"}</span>,
                different: compareValues(row.value1, row.value2) === "different",
              }));
              const visibleRows = diffOnly ? rows.filter((row) => row.different) : rows;
              return (
                <Card className="gap-3 py-5">
                  <CardContent className="px-5">
                    {visibleRows.length === 0 ? (
                      <p className="text-sm text-muted-foreground">{t("compare.noDifferences")}</p>
                    ) : (
                      <CompareTable
                        labelledBy="compare-device-heading"
                        firstColumnLabel={t("compare.item")}
                        player1={player1}
                        player2={player2}
                        rows={visibleRows}
                      />
                    )}
                  </CardContent>
                </Card>
              );
            })()}
          </div>
        </>
      )}

      {/* 類似設定の走者を探す */}
      {player1 && !player2 && (
        <SimilarPlayersSection
          targetPlayer={player1}
          similarPlayers={similarPlayers}
          onSelectPlayer={(mcid) => handleSelectPlayer("p2", mcid)}
        />
      )}
    </div>
  );
}

/**
 * 2人の値の比べ方（キー配置・デバイスの表、要約の件数、「違いだけ表示」、「異なる」の印で共有）。
 * 両方に値があって異なる・片方だけ値がある → "different"、両方に値があって同じ → "same"、両方未設定 → "unset"（違いではない）
 */
function compareValues(value1?: string | null, value2?: string | null): "same" | "different" | "unset" {
  if (!value1 && !value2) return "unset";
  if (!value1 || !value2) return "different";
  return value1 === value2 ? "same" : "different";
}

function SimilarPlayersSection({
  targetPlayer,
  similarPlayers,
  onSelectPlayer,
}: {
  targetPlayer: NonNullable<Awaited<ReturnType<typeof loader>>["player1"]>;
  similarPlayers: Awaited<ReturnType<typeof loader>>["similarPlayers"];
  onSelectPlayer: (slug: string) => void;
}) {
  const t = useT();
  const locale = useLocale();
  return (
    <Card className="gap-3 py-5">
      <CardHeader className="px-5">
        <CardTitle className="flex items-center gap-2">
          <Users className="h-5 w-5" />
          {t("compare.similarTitle")}
        </CardTitle>
        <CardDescription>
          {getLocalizedDisplayName(targetPlayer, locale) + t("compare.similarSuffix")}
        </CardDescription>
      </CardHeader>
      <CardContent className="px-5">
        {similarPlayers.length > 0 ? (
          <div className="space-y-2">
            {similarPlayers.map((player) => (
              <div
                key={player.slug}
                className="flex items-center justify-between p-3 rounded-lg border"
              >
                <div className="flex items-center gap-3">
                  <MinecraftAvatar uuid={player.uuid} size={32} skinUrl={player.customSkinUrl} />
                  <div>
                    <p className="font-medium">{getLocalizedDisplayName(player, locale)}</p>
                    {player.mcid && <p className="text-xs text-muted-foreground">@{player.mcid}</p>}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    {/* 一致率は良し悪しの色を付けない（前景色） */}
                    <p className="font-bold">
                      {Math.round(player.similarity * 100)}%
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t("compare.matched", { matches: player.matches, total: player.total })}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onSelectPlayer(player.slug)}
                    className="min-h-11 sm:min-h-8"
                  >
                    {t("compare.compareButton")}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-4">
            {t("compare.noSimilar")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export function HydrateFallback() {
  return (
    <div className="space-y-6">
      <div>
        <Skeleton className="h-8 w-48 mb-2" />
        <Skeleton className="h-5 w-72" />
      </div>

      {/* 走者選択スケルトン（本物と同じ: 見出し＋選択欄が2つ、間に入れ替えボタン） */}
      <div className="grid grid-cols-1 items-start gap-3 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:gap-4">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className={cn("space-y-2", i === 1 && "order-3")}>
            <Skeleton className="h-5 w-16" />
            <Skeleton className="h-11 w-full sm:h-9" />
          </div>
        ))}
        <div className="order-2 flex justify-center md:pt-7">
          <Skeleton className="size-11 sm:size-9" />
        </div>
      </div>

      {/* 統計サマリースケルトン */}
      <Card className="gap-3 py-5">
        <CardContent className="px-5">
          <div className="flex flex-wrap items-center justify-center gap-6">
            <div className="flex items-center gap-2">
              <Skeleton className="w-10 h-10 rounded-none" />
              <div className="space-y-2">
                <Skeleton className="h-5 w-24" />
                <Skeleton className="h-3 w-16" />
              </div>
            </div>
            <div className="text-center px-6">
              <div className="flex items-center gap-4 mb-2">
                <div className="text-center">
                  <Skeleton className="h-8 w-12 mx-auto mb-1" />
                  <Skeleton className="h-3 w-8 mx-auto" />
                </div>
                <div className="text-center">
                  <Skeleton className="h-8 w-12 mx-auto mb-1" />
                  <Skeleton className="h-3 w-12 mx-auto" />
                </div>
              </div>
              <Skeleton className="h-4 w-24 mx-auto" />
            </div>
            <div className="flex items-center gap-2">
              <Skeleton className="w-10 h-10 rounded-none" />
              <div className="space-y-2">
                <Skeleton className="h-5 w-24" />
                <Skeleton className="h-3 w-16" />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* キーバインド比較スケルトン */}
      <div className="space-y-4">
        <Skeleton className="h-6 w-40" />
        {Array.from({ length: 4 }).map((_, categoryIndex) => (
          <Card key={categoryIndex} className="gap-3 py-5">
            <CardHeader className="px-5">
              <Skeleton className="h-5 w-20" />
            </CardHeader>
            <CardContent className="px-5">
              <div className="divide-y">
                {Array.from({ length: 12 }).map((_, i) => (
                  <div key={i} className="flex items-center justify-between py-2 px-2 -mx-2">
                    <Skeleton className="h-4 w-24" />
                    <div className="flex items-center gap-4">
                      <Skeleton className="h-8 w-20" />
                      <Skeleton className="h-8 w-20" />
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* デバイス・設定の比較スケルトン */}
      <div className="space-y-4">
        <Skeleton className="h-6 w-48" />
        <Card className="gap-3 py-5">
          <CardContent className="px-5">
            <div className="grid grid-cols-3 gap-4">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
              {Array.from({ length: 15 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
