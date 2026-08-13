import { createTranslator } from "@/lib/messages";
import { localeFromMatches, resolveLocale } from "@/lib/locale";
import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useLoaderData, useFetcher, Link, type ShouldRevalidateFunctionArgs } from "react-router";
import type { Route } from "./+types/search-craft";
import { Skeleton } from "@/components/ui/skeleton";
import { createDb } from "@/lib/db";
import { createAuth } from "@/lib/auth";
import { getSession } from "@/lib/session";
import { getEnv } from "@/lib/env.server";
import { users, searchCrafts, searchCraftLoops, configPresets } from "@/lib/schema";
import { eq, asc, and } from "drizzle-orm";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { createId } from "@paralleldrive/cuid2";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Search,
  AlertCircle,
  Settings,
  Copy,
  Share2,
} from "lucide-react";
import { FloatingSaveBar } from "@/components/floating-save-bar";
import { SearchCraftTimingBoard } from "@/components/search-craft-editor";
import type { SearchCraftTiming } from "@/lib/search-craft-templates";
import { toUiRemaps } from "@/lib/remap-utils";
import { parseTemplateCrafts, parseTemplateLoops } from "@/lib/search-craft-templates";
import {
  parseLoopSteps,
  isValidLoopStepsShape,
  remapLoopSteps,
  type LoopStepData,
} from "@/lib/search-craft-loops";
import {
  resolveRowVariations,
  searchCraftColumnValues,
  type SearchCraftVariation,
} from "@/lib/search-craft-variations";
import { useT } from "@/hooks/use-locale";
import { syncActivePresetSnapshot, assertPresetIsActive, PresetMismatchError } from "@/lib/preset-utils";
import { configHistory } from "@/lib/schema";
import { PresetSelector } from "@/components/preset-selector";
import { PresetSwitchLock } from "@/components/preset-switch-lock";

export const meta: Route.MetaFunction = ({ matches }) => {
  const t = createTranslator(localeFromMatches(matches));
  return [{ title: t("meSearchCraft.title") }];
};

// 再検証を制御：actionの結果に応じてのみ再検証
export function shouldRevalidate({ actionResult, defaultShouldRevalidate, formAction, currentUrl, nextUrl }: ShouldRevalidateFunctionArgs) {
  if (actionResult !== undefined) {
    return defaultShouldRevalidate;
  }
  // /me/presets でのアクション（プリセット切替・作成・削除）の後は再検証する
  if (formAction === "/me/presets") {
    return true;
  }
  // PresetSelector の focus 再検証（別タブでのプリセット切替検知）を通すため、
  // revalidator 起点（アクション無し・URL 不変）の再検証は既定の判断に任せる
  if (!formAction && currentUrl.href === nextUrl.href) {
    return defaultShouldRevalidate;
  }
  return false;
}

type SearchCraftItem = {
  id: string;
  sequence: number;
  items: string[];
  keys: string[];
  comment: string | null;
  timing: "ow" | "bastion" | "bastion_fort" | "fortress" | "blinded" | "other" | null;
  /** 複数サーチ文字列バリエーション（単一の真実。searchStr/withShift スカラーは持たない） */
  variations: SearchCraftVariation[];
};

type SearchCraftLoopItem = {
  id: string;
  steps: LoopStepData[];
  comment: string | null;
  timing: SearchCraftTiming | null;
};


export async function loader({ request }: Route.LoaderArgs) {
  const t = createTranslator(resolveLocale(request));
  const env = getEnv();
  const db = createDb();
  const auth = createAuth(db, env);

  const session = await getSession(request, auth);

  const user = await db.query.users.findFirst({
    where: eq(users.discordId, session.user.id),
    with: {
      searchCrafts: {
        orderBy: [asc(searchCrafts.sequence)],
      },
      searchCraftLoops: {
        orderBy: [asc(searchCraftLoops.sequence)],
      },
      keyRemaps: true,
      configPresets: {
        columns: {
          id: true,
          name: true,
          isActive: true,
          isMain: true,
          searchCraftsData: true,
          searchCraftLoopsData: true,
        },
      },
    },
  });

  if (!user) {
    throw new Response(t("meSearchCraft.userNotFound"), { status: 404 });
  }

  // Parse JSON fields
  const crafts: SearchCraftItem[] = user.searchCrafts.map((craft) => ({
    id: craft.id,
    sequence: craft.sequence,
    items: JSON.parse(craft.items) as string[],
    keys: JSON.parse(craft.keys) as string[],
    comment: craft.comment,
    timing: craft.timing ?? null,
    variations: resolveRowVariations(craft),
  }));

  const loops: SearchCraftLoopItem[] = user.searchCraftLoops.map((loop) => ({
    id: loop.id,
    steps: parseLoopSteps(loop.steps),
    comment: loop.comment,
    timing: loop.timing ?? null,
  }));

  // 全プリセットを取得（コピー機能用）
  const allPresets = user.configPresets;

  // アクティブなプリセットを取得
  const activePreset = allPresets.find((p) => p.isActive);

  return {
    userId: user.id,
    crafts,
    loops,
    // 入力キーのライブプレビュー用（表示専用）
    remaps: toUiRemaps(user.keyRemaps),
    activePreset: activePreset ? { id: activePreset.id, name: activePreset.name } : null,
    hasPresets: allPresets.length > 0,
    presets: allPresets.map((p) => ({
      id: p.id,
      name: p.name,
      isActive: p.isActive,
      isMain: p.isMain,
      hasSearchCrafts: !!p.searchCraftsData,
      searchCraftsData: p.searchCraftsData,
      searchCraftLoopsData: p.searchCraftLoopsData,
    })),
  };
}

// ローディング中に表示するスケルトンUI（ナビゲーション時用）。
// 現行のタイミングブロック型レイアウト（PresetSelector 帯 + SearchCraftTimingBoard の
// ブロックカード群）に合わせた骨組みにする（旧フラット行UIの骨組みは使わない）。
export function HydrateFallback() {
  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <Skeleton className="h-8 w-36 mb-2" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-11 sm:h-10 w-full sm:w-20" />
      </div>

      {/* PresetSelector 相当の帯 */}
      <div className="rounded-lg border bg-card p-3 sm:p-4 shadow-sm">
        <Skeleton className="h-10 w-full sm:w-80" />
      </div>

      {/* タイミングブロックカード */}
      <div className="space-y-4">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-border/70 bg-background/80">
            <div className="flex items-center gap-2 border-b border-border/60 px-4 py-2.5">
              <Skeleton className="h-2.5 w-2.5 rounded-full" />
              <Skeleton className="h-4 w-24" />
            </div>
            <div className="space-y-3 px-4 py-3">
              <Skeleton className="h-14 w-full" />
              {i === 0 && <Skeleton className="h-14 w-full" />}
              <Skeleton className="h-8 w-28" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export async function action({ request }: Route.ActionArgs) {
  const t = createTranslator(resolveLocale(request));
  const env = getEnv();
  const db = createDb();
  const auth = createAuth(db, env);

  const session = await getSession(request, auth);

  const user = await db.query.users.findFirst({
    where: eq(users.discordId, session.user.id),
  });

  if (!user) {
    return { error: t("meSearchCraft.userNotFound") };
  }

  const formData = await request.formData();
  const actionType = formData.get("_action") as string;
  const presetId = (formData.get("presetId") as string | null) || null;

  try {
    await assertPresetIsActive(db, user.id, presetId);
  } catch (e) {
    if (e instanceof PresetMismatchError) {
      return { error: t("mePresets.staleSession") };
    }
    throw e;
  }

  // サーチクラフトはプリセットのスナップショットに含まれるデータのため、
  // アクティブなプリセットが無い状態では保存できない（UIのグレーアウトだけでなくサーバー側でも拒否）。
  // プリセットが無いまま書き込むと syncActivePresetSnapshot が無言でスキップされ、
  // どのプリセットにも属さないデータになってしまう。
  const activePresetRow = await db.query.configPresets.findFirst({
    where: and(eq(configPresets.userId, user.id), eq(configPresets.isActive, true)),
    columns: { id: true },
  });
  if (!activePresetRow) {
    return { error: t("meSearchCraft.presetRequired") };
  }

  if (actionType === "saveAll") {
    const craftsJson = formData.get("crafts") as string;
    // loops フィールド自体が未送信（null）＝ Loop 機能追加前の古いタブ等からの保存。
    // これを "[]" 相当に倒すと、保存のたびに既存 Loop が無警告で全消去されてしまうため、
    // フィールドが本当に存在しない場合は DB の既存 loops をフォールバックとして採用する
    // （明示的に "[]" が送信された場合＝新しいクライアントでの全削除は、従来どおり尊重する）。
    const loopsField = formData.get("loops") as string | null;

    try {
      const craftsRaw = JSON.parse(craftsJson) as Array<Record<string, unknown>>;

      // items が string[] であることを保証する。非配列・非文字列要素のまま永続化されると、
      // 公開ガイド埋め込みの SSR が items.map で TypeError を投げて 500 になるため、ここで拒否する。
      if (
        !Array.isArray(craftsRaw) ||
        craftsRaw.some(
          (craft) =>
            !craft ||
            typeof craft.id !== "string" ||
            !craft.id ||
            !Array.isArray(craft.items) ||
            (craft.items as unknown[]).some((item) => typeof item !== "string"),
        )
      ) {
        return { error: t("meSearchCraft.invalidCraftData") };
      }

      // variations が正準。フィールド自体が未送信（旧クライアントタブ）の場合は
      // searchStr/withShift から1件合成して受理する（resolveVariations 経由。手書きしない）
      const crafts: SearchCraftItem[] = craftsRaw.map((craft) => ({
        id: craft.id as string,
        sequence: 0,
        items: craft.items as string[],
        keys: [],
        comment: typeof craft.comment === "string" ? craft.comment : null,
        timing: (craft.timing ?? null) as SearchCraftItem["timing"],
        variations: resolveRowVariations({
          variations: craft.variations,
          searchStr: typeof craft.searchStr === "string" ? craft.searchStr : null,
          withShift: craft.withShift as boolean | null | undefined,
        }),
      }));

      let loops: SearchCraftLoopItem[];
      if (loopsField === null) {
        const existingLoops = await db.query.searchCraftLoops.findMany({
          where: eq(searchCraftLoops.userId, user.id),
          orderBy: [asc(searchCraftLoops.sequence)],
        });
        loops = existingLoops.map((loop) => ({
          id: loop.id,
          steps: parseLoopSteps(loop.steps),
          comment: loop.comment,
          timing: loop.timing ?? null,
        }));
      } else {
        let loopsRaw: unknown;
        try {
          loopsRaw = JSON.parse(loopsField);
        } catch {
          return { error: t("meSearchCraft.invalidCraftData") };
        }
        // 構造検証（2ステップ以上・先頭のみ transition null・bsCount 非負整数等）は
        // isValidLoopStepsShape に委ねる。参照する craftId が実在するかはここでは検証しない
        // （削除済みエントリの参照はこの後 remapLoopSteps の安全網で除去する）。
        if (
          !Array.isArray(loopsRaw) ||
          loopsRaw.some(
            (loop) =>
              !loop ||
              typeof loop !== "object" ||
              typeof (loop as { id?: unknown }).id !== "string" ||
              !(loop as { id: string }).id ||
              !isValidLoopStepsShape((loop as { steps?: unknown }).steps),
          )
        ) {
          return { error: t("meSearchCraft.invalidCraftData") };
        }
        loops = loopsRaw as SearchCraftLoopItem[];
      }

      // crafts の submittedId→finalId マップを挿入前に確定する（"new-" 始まりのみ新規採番）。
      // Loop の craftId 引き換えにも同じマップを使うため、挿入と同じタイミングで id を振り直せない。
      const craftIdMap = new Map<string, string>();
      const finalCrafts = crafts.map((craft) => {
        const finalId = craft.id.startsWith("new-") ? createId() : craft.id;
        craftIdMap.set(craft.id, finalId);
        return { ...craft, id: finalId };
      });

      // Loop の craftId を最終idへ引き換える。削除済みエントリの参照はステップ除去、
      // 残り2件未満になった Loop は破棄する（安全網。保存自体は拒否しない）
      const finalLoops = loops
        .map((loop) => {
          const steps = remapLoopSteps(loop.steps, craftIdMap);
          if (!steps) return null;
          return {
            id: loop.id.startsWith("new-") ? createId() : loop.id,
            steps,
            comment: loop.comment,
            timing: loop.timing,
          };
        })
        .filter((loop): loop is NonNullable<typeof loop> => loop !== null);

      const now = new Date();
      await db.transaction(async (tx) => {
        // 既存のサーチクラフト・Loopを全削除
        await tx.delete(searchCraftLoops).where(eq(searchCraftLoops.userId, user.id));
        await tx.delete(searchCrafts).where(eq(searchCrafts.userId, user.id));

        // 新しいサーチクラフトを挿入（searchStr/withShift は searchCraftColumnValues() 経由で
        // 第1バリエーションのミラーとして書き込む）
        if (finalCrafts.length > 0) {
          await tx.insert(searchCrafts).values(
            finalCrafts.map((craft, i) => ({
              id: craft.id,
              userId: user.id,
              sequence: i + 1,
              items: JSON.stringify(craft.items),
              keys: JSON.stringify([]), // keysは使用しない（後方互換性のため空配列で保持）
              comment: craft.comment || null,
              timing: craft.timing || null,
              ...searchCraftColumnValues(craft.variations),
              createdAt: now,
              updatedAt: now,
            })),
          );
        }

        // 新しいLoopを挿入
        if (finalLoops.length > 0) {
          await tx.insert(searchCraftLoops).values(
            finalLoops.map((loop, i) => ({
              id: loop.id,
              userId: user.id,
              sequence: i + 1,
              steps: JSON.stringify(loop.steps),
              comment: loop.comment || null,
              timing: loop.timing || null,
              createdAt: now,
              updatedAt: now,
            })),
          );
        }
      });

      // アクティブプリセットスナップショット同期（crafts・loops 両方が同期される）
      await syncActivePresetSnapshot(db, user.id, ["searchCrafts"]);

      // 変更履歴を記録
      await db.insert(configHistory).values({
        id: createId(),
        userId: user.id,
        changeType: "game_setting",
        changeDescription: t("meSearchCraft.searchCraftChangeHistory"),
        createdAt: now,
      });

      return { success: true };
    } catch (error) {
      console.error("Save error:", error);
      return { error: t("meSearchCraft.saveFailed") };
    }
  }

  return { error: t("meSearchCraft.unknownAction") };
}

// ItemSelectDialog / EditableSearchCraftCard は @/components/search-craft-editor に抽出済み

/**
 * プリセット未作成時に、サーチクラフトが編集できない旨を案内する。
 * 既存データは読み取り専用で表示される。
 */
function PresetRequiredNotice() {
  const t = useT();
  return (
    <Alert>
      <AlertCircle className="h-4 w-4" />
      <AlertDescription className="flex flex-wrap items-center gap-1">
        <span>{t("meSearchCraft.presetRequiredNotice")}</span>
        <Link to="/me/presets" className="underline underline-offset-2">
          {t("meSearchCraft.presetRequiredLink")}
        </Link>
      </AlertDescription>
    </Alert>
  );
}

export default function SearchCraftPage() {
  const t = useT();
  const {
    crafts: initialCrafts,
    loops: initialLoops,
    remaps,
    activePreset,
    hasPresets,
    presets,
  } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const [crafts, setCrafts] = useState<SearchCraftItem[]>(initialCrafts);
  const [loops, setLoops] = useState<SearchCraftLoopItem[]>(initialLoops);
  const prevDataRef = useRef<typeof fetcher.data>(undefined);
  const [copyDialogOpen, setCopyDialogOpen] = useState(false);
  // プリセット切替（apply-preset）中は入力欄をロックする
  const [presetSwitching, setPresetSwitching] = useState(false);

  const isSubmitting = fetcher.state === "submitting";

  // loaderデータが更新されたらローカル状態も更新
  useEffect(() => {
    setCrafts(initialCrafts);
    setLoops(initialLoops);
  }, [initialCrafts, initialLoops]);

  // 保存結果の処理
  useEffect(() => {
    const data = fetcher.data;
    if (!data || data === prevDataRef.current) return;
    prevDataRef.current = data;

    if ("success" in data && data.success) {
      toast.success(t("meSearchCraft.saveSuccess"));
    } else if ("error" in data) {
      toast.error(data.error);
    }
  }, [fetcher.data]);

  // 変更検知。initialCrafts/initialLoops の stringify はそれ自体が変わる（loaderデータ更新）
  // ときだけ計算すればよいので、crafts/loops の変更のたびに再計算しないよう別メモにする
  const initialCraftsJson = useMemo(() => JSON.stringify(initialCrafts), [initialCrafts]);
  const initialLoopsJson = useMemo(() => JSON.stringify(initialLoops), [initialLoops]);
  const hasChanges = useMemo(() => {
    if (crafts.length !== initialCrafts.length || loops.length !== initialLoops.length) {
      return true;
    }
    return (
      JSON.stringify(crafts) !== initialCraftsJson ||
      JSON.stringify(loops) !== initialLoopsJson
    );
  }, [crafts, initialCrafts.length, loops, initialLoops.length, initialCraftsJson, initialLoopsJson]);

  // SearchCraftTimingBoard からの crafts/loops 更新（D&D・行の更新・削除・追加を含む）は
  // Board が内部でブロック順への正規化・削除時の Loop 連動除去・削除確認文言・新規追加時の
  // draft 生成まで面倒を見るため、ここでは setState をそのまま渡すだけでよい
  const createCraft = useCallback((timing: SearchCraftItem["timing"]): SearchCraftItem => ({
    id: `new-${crypto.randomUUID()}`,
    sequence: crafts.length + 1,
    items: [],
    keys: [],
    comment: null,
    timing,
    variations: [{ str: "", withShift: false }],
  }), [crafts.length]);

  const createLoop = useCallback((timing: SearchCraftLoopItem["timing"]): SearchCraftLoopItem => ({
    id: `new-${crypto.randomUUID()}`,
    steps: [
      { craftId: "", transition: null, variationIndex: 0 },
      { craftId: "", transition: { type: "backspace", bsCount: 0 }, variationIndex: 0 },
    ],
    comment: null,
    timing,
  }), []);

  const handleSave = useCallback(() => {
    // バリデーション（サーチクラフト）
    const emptyCrafts = crafts.filter((c) => c.items.length === 0);
    if (emptyCrafts.length > 0) {
      toast.error(t("meSearchCraft.selectAtLeastOneItem"));
      return;
    }

    const emptySearchStr = crafts.filter(
      (c) => c.variations.length === 0 || c.variations.some((v) => !v.str.trim()),
    );
    if (emptySearchStr.length > 0) {
      toast.error(t("meSearchCraft.craftStringRequired"));
      return;
    }

    // バリデーション（Loop）
    if (loops.some((loop) => loop.steps.length < 2)) {
      toast.error(t("meSearchCraft.loopStepsRequired"));
      return;
    }
    if (loops.some((loop) => loop.steps.some((s) => !s.craftId))) {
      toast.error(t("meSearchCraft.loopEntryRequired"));
      return;
    }

    const formData = new FormData();
    formData.set("_action", "saveAll");
    formData.set("crafts", JSON.stringify(crafts));
    formData.set("loops", JSON.stringify(loops));
    if (activePreset) {
      formData.set("presetId", activePreset.id);
    }
    fetcher.submit(formData, { method: "post" });
  }, [crafts, loops, fetcher, activePreset, t]);

  const handleReset = useCallback(() => {
    setCrafts(initialCrafts);
    setLoops(initialLoops);
  }, [initialCrafts, initialLoops]);

  // プリセットからコピー
  const handleCopyFromPreset = useCallback((presetId: string) => {
    const preset = presets.find((p) => p.id === presetId);
    if (!preset || !preset.searchCraftsData) {
      toast.error(t("meSearchCraft.copyNoData"));
      return;
    }

    // スナップショットは PresetSearchCraftData[]（items は二重エンコードされたJSON文字列）。
    // items のデコード・withShift の正規化を含め parseTemplateCrafts() に委ねる
    const parsedCrafts = parseTemplateCrafts(preset.searchCraftsData);
    if (parsedCrafts.length === 0) {
      toast.error(t("meSearchCraft.copyNoData"));
      return;
    }

    // コピー後の draft id を crafts と同じ順序で確定してから、
    // Loop の craftIndex 参照（parseTemplateLoops）をその draft id へ解決する
    const timestamp = Date.now();
    const newCraftIds = parsedCrafts.map((_, idx) => `new-${timestamp}-${idx}`);
    setCrafts(parsedCrafts.map((craft, idx) => ({
      id: newCraftIds[idx],
      sequence: idx + 1,
      items: craft.items,
      keys: [],
      comment: craft.comment,
      timing: craft.timing,
      variations: craft.variations,
    })));

    const parsedLoops = parseTemplateLoops(preset.searchCraftLoopsData, parsedCrafts.length);
    setLoops(parsedLoops.map((loop, idx) => ({
      id: `new-${timestamp}-loop-${idx}`,
      steps: loop.steps.map((s) => ({
        craftId: newCraftIds[s.craftIndex],
        transition: s.transition,
        variationIndex: s.variationIndex,
      })),
      comment: loop.comment,
      timing: loop.timing,
    })));

    toast.success(t("meSearchCraft.copiedFromPreset", { name: preset.name }));

    setCopyDialogOpen(false);
  }, [presets]);

  return (
    <div className="space-y-6 pb-24">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{t("meSearchCraft.pageTitle")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("meSearchCraft.pageDescription")}
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <Button asChild variant="outline" className="w-full sm:w-auto h-11 sm:h-10">
            <Link to="/my-guides/templates">
              <Share2 className="mr-2 h-4 w-4" />
              {t("meSearchCraft.publishAsTemplate")}
            </Link>
          </Button>
        </div>
      </div>

      {/* プリセットセレクター */}
      <PresetSelector
        presets={presets.map((p) => ({ id: p.id, name: p.name, isActive: p.isActive, isMain: p.isMain }))}
        activePresetId={activePreset?.id ?? null}
        hasChanges={hasChanges}
        onSwitchingChange={setPresetSwitching}
        onCopyFromOther={presets.length > 1 ? () => setCopyDialogOpen(true) : undefined}
      />

      {/* プリセット未作成時の案内（リンクを押せるようゲート外に置く） */}
      {!hasPresets && <PresetRequiredNotice />}

      {/* プリセット切替中はロックする */}
      <PresetSwitchLock locked={presetSwitching}>
      <div className={cn(!hasPresets && "pointer-events-none opacity-50")}>
      <SearchCraftTimingBoard
        crafts={crafts}
        onCraftsChange={setCrafts}
        loops={loops}
        onLoopsChange={setLoops}
        remaps={remaps}
        createCraft={createCraft}
        createLoop={createLoop}
      />
      </div>
      </PresetSwitchLock>

      <FloatingSaveBar
        hasChanges={hasChanges}
        isSubmitting={isSubmitting}
        onSave={handleSave}
        onReset={handleReset}
      />

      {/* プリセットからコピーダイアログ */}
      <Dialog open={copyDialogOpen} onOpenChange={setCopyDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("meSearchCraft.copyDialogTitle")}</DialogTitle>
            <DialogDescription>
              {t("meSearchCraft.copyDialogDescription")}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2 max-h-72 overflow-y-auto">
              {presets
                .filter((p) => p.id !== activePreset?.id)
                .map((preset) => (
                  <Button
                    key={preset.id}
                    variant="outline"
                    className="w-full justify-start h-auto py-3"
                    disabled={!preset.hasSearchCrafts}
                    onClick={() => handleCopyFromPreset(preset.id)}
                  >
                    <div className="flex flex-col items-start gap-1">
                      <span className="font-medium">{preset.name}</span>
                      <div className="flex gap-1 flex-wrap">
                        {preset.hasSearchCrafts ? (
                          <Badge variant="secondary" className="text-xs">
                            <Search className="h-3 w-3 mr-1" />
                            {t("meSearchCraft.pageTitle")}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-xs text-muted-foreground">
                            {t("meSearchCraft.noData")}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </Button>
                ))}
              {presets.filter((p) => p.id !== activePreset?.id).length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  {t("meSearchCraft.noOtherPresets")}
                </p>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCopyDialogOpen(false)}>
              {t("meSearchCraft.cancel")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function ErrorBoundary() {
  const t = useT();
  return (
    <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <Card>
        <CardContent className="p-6">
          <div className="text-center space-y-4">
            <AlertCircle className="h-12 w-12 mx-auto text-destructive" />
            <h2 className="text-2xl font-bold">{t("meSearchCraft.errorTitle")}</h2>
            <p className="text-muted-foreground">
              {t("meSearchCraft.errorDescription")}
            </p>
            <Button onClick={() => window.location.reload()}>
              {t("meSearchCraft.reloadPage")}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
