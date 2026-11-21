import { createTranslator } from "@/lib/messages";
import { localeFromMatches, resolveLocale } from "@/lib/locale";
import { getLocalizedDisplayName } from "@/lib/slug";
import { useState, useEffect, useRef } from "react";
import { useLoaderData, useFetcher, Link } from "react-router";
import type { Route } from "./+types/view";
import { createDb } from "@/lib/db";
import { resolvePublicPresetId } from "@/lib/config-history";
import { createAuth } from "@/lib/auth";
import { getSession, getOptionalSession } from "@/lib/session";
import { getEnv } from "@/lib/env.server";
import { users, configHistory, searchCraftTemplates } from "@/lib/schema";
import { eq, sql } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import {
  applyCraftsToExistingPreset,
  createPresetWithCrafts,
} from "@/lib/search-craft-apply.server";
import {
  parseTemplateCrafts,
  parseTemplateRemapData,
  parseTemplateRemaps,
  parseTemplateLoops,
  MAX_TEMPLATE_CRAFTS,
} from "@/lib/search-craft-templates";
import { useT, useLocale } from "@/hooks/use-locale";
import { useLoginHref } from "@/hooks/use-login-href";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusPill } from "@/components/status-pill";
import { NoticeBanner } from "@/components/notice-banner";
import { MinecraftAvatar } from "@/components/minecraft-avatar";
import { PageSection } from "@/components/page-section";
import { HintTip } from "@/components/hint-tip";
import { HorizontalScrollArea } from "@/components/horizontal-scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { itemLangForLocale } from "@/components/item-icon";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { ShareButton } from "@/components/share-button";
import { GuideRouteNotFound } from "@/components/guide-route-not-found";
import { LikeButton } from "@/components/like-button";
import { getTemplateLikeCount } from "@/lib/likes.server";
import {
  SearchCraftGroupedList,
  KeyBadgeLegend,
  countSearchCraftGroups,
  SEARCH_CRAFT_OPEN_FIRST_MAX,
} from "@/components/search-craft-template-view";
import {
  groupLoopsByTiming,
  makeLoopGroupExtra,
  type LoopCraftInfo,
  type SearchCraftLoopRowData,
} from "@/components/search-craft-loop-view";
import { VirtualKeyboard } from "@/components/virtual-keyboard";
import { getRemapOutputLabel, getRemapSourceLabel } from "@/lib/remap-utils";
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Download,
  EyeOff,
  FlaskConical,
  Keyboard,
  Languages,
  Loader2,
  LogIn,
  Search,
  Settings,
} from "lucide-react";
import { getGameLanguageName, normalizeGameLanguage } from "@/lib/game-languages";
import { decodePresetPlayerConfig } from "@/lib/preset-read";
import { formatDistanceToNow } from "date-fns";
import { dateFnsLocale } from "@/lib/date-locale";

// リマップ表示用のバーチャルキーボードのレイアウト切替（テンプレートはレイアウト情報を持たないため閲覧者が選択）
type KeyboardLayoutOption = "US" | "JIS" | "US_TKL" | "JIS_TKL";
const LAYOUT_OPTIONS: KeyboardLayoutOption[] = ["US", "JIS", "US_TKL", "JIS_TKL"];

export const meta: Route.MetaFunction = ({ matches, loaderData }) => {
  const t = createTranslator(localeFromMatches(matches));
  if (!loaderData) {
    return [{ title: t("templates.notFoundTitle") }];
  }
  const title = `${loaderData.template.title} - ${t("templates.pageTitle")} | Minefolio`;
  const description =
    loaderData.template.description ||
    t("templates.metaDescription", { name: loaderData.author.name });
  const ogImage = `${loaderData.appUrl}/icon.png`;
  return [
    { title },
    { name: "description", content: description },
    { property: "og:type", content: "article" },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:image", content: ogImage },
    { name: "twitter:card", content: "summary" },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
    { name: "twitter:image", content: ogImage },
  ];
};

export async function loader({ request, params }: Route.LoaderArgs) {
  const t = createTranslator(resolveLocale(request));
  const env = getEnv();
  const db = createDb();
  const auth = createAuth(db, env);

  // セッション（→ 閲覧者のプリセット一覧）・テンプレート本体・いいね数は互いに独立なので並行する。
  // 閲覧者のプリセットは、テンプレートが 404 の場合は使わないが、その場合でも読み捨てるだけ（挙動は同じ）
  const sessionPromise = getOptionalSession(request, auth);
  const myPresetsPromise = sessionPromise.then((session) =>
    session
      ? db.query.users.findFirst({
          where: eq(users.discordId, session.user.id),
          columns: { id: true },
          with: {
            configPresets: {
              columns: { id: true, name: true, isActive: true, playerConfigData: true },
            },
            // 編集中プリセットの言語はライブの設定が正（スナップショットは古いことがある）
            playerConfig: { columns: { gameLanguage: true } },
          },
        })
      : null
  );
  const likeCountPromise = getTemplateLikeCount(db, params.templateId);
  // テンプレートが 404 などで早期に throw しても、残りの Promise の失敗が未処理の rejection にならないようにする
  // （待つ側では元の Promise を await するので、失敗はそこで通常どおり伝わる）
  myPresetsPromise.catch(() => {});
  likeCountPromise.catch(() => {});

  const templatePromise = db.query.searchCraftTemplates.findFirst({
    where: eq(searchCraftTemplates.id, params.templateId),
    // 下書き列は公開側へ読み込まない
    columns: {
      draftTitle: false,
      draftDescription: false,
      draftGameLanguage: false,
      draftCraftsData: false,
      draftRemapsData: false,
      draftLoopsData: false,
      draftUpdatedAt: false,
    },
    with: {
      user: {
        columns: {
          id: true,
          slug: true,
          displayName: true,
          displayNameAlphabet: true,
          mcid: true,
          uuid: true,
          customSkinUrl: true,
          discordId: true,
          profileVisibility: true,
        },
      },
    },
  });

  const [session, template] = await Promise.all([sessionPromise, templatePromise]);

  if (!template) {
    throw new Response(t("templates.notFound"), { status: 404 });
  }

  const isOwner = !!session && template.user.discordId === session.user.id;
  if (!template.isPublished && !isOwner) {
    throw new Response(t("templates.notFound"), { status: 404 });
  }
  // 非公開（private）プロフィールのテンプレートは本人以外に見せない。
  // 限定公開（unlisted）は一覧に出さないだけで、URL 指定なら閲覧可（名指し参照のルール）
  if (template.user.profileVisibility === "private" && !isOwner) {
    throw new Response(t("templates.notFound"), { status: 404 });
  }

  // ログイン中は反映先選択用に自分のプリセット一覧を返す
  const [me, likeCount] = await Promise.all([myPresetsPromise, likeCountPromise]);
  // ゲーム言語（未設定・不明は null）。反映先の言語とテンプレートの言語の比較に使う。
  // snapshotGameLanguage: プリセット行の playerConfigData の言語。新規プリセットの元にしたときコピーされるのはこちら
  // liveGameLanguage: 編集中（アクティブ）のプリセットだけ。既存のアクティブプリセットへ反映した場合、実際に効くのはライブ側
  const myPresets: {
    id: string;
    name: string;
    isActive: boolean;
    liveGameLanguage: string | null;
    snapshotGameLanguage: string | null;
  }[] = (me?.configPresets ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    isActive: p.isActive,
    liveGameLanguage: p.isActive ? normalizeGameLanguage(me?.playerConfig?.gameLanguage) : null,
    snapshotGameLanguage: normalizeGameLanguage(
      decodePresetPlayerConfig(p.playerConfigData)?.gameLanguage,
    ),
  }));

  const appUrl = env.APP_URL || "https://minefolio.app";

  const crafts = parseTemplateCrafts(template.craftsData);

  return {
    template: {
      id: template.id,
      title: template.title,
      description: template.description,
      gameLanguage: template.gameLanguage,
      isPublished: template.isPublished,
      applyCount: template.applyCount,
      likeCount,
      createdAt: template.createdAt.toISOString(),
      updatedAt: template.updatedAt.toISOString(),
    },
    crafts,
    remaps: parseTemplateRemaps(template.remapsData),
    loops: parseTemplateLoops(template.loopsData, crafts.length),
    author: {
      slug: template.user.slug,
      uuid: template.user.uuid,
      skinUrl: template.user.customSkinUrl,
      name: getLocalizedDisplayName(template.user, resolveLocale(request)),
    },
    myPresets,
    isOwner,
    isLoggedIn: !!session,
    appUrl,
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const t = createTranslator(resolveLocale(request));
  const env = getEnv();
  const db = createDb();
  const auth = createAuth(db, env);

  const session = await getSession(request, auth);

  const user = await db.query.users.findFirst({
    where: eq(users.discordId, session.user.id),
  });

  if (!user) {
    return { error: t("templates.userNotFound") };
  }

  const formData = await request.formData();
  const actionType = formData.get("_action") as string;

  if (actionType !== "apply") {
    return { error: t("templates.unknownAction") };
  }

  const template = await db.query.searchCraftTemplates.findFirst({
    where: eq(searchCraftTemplates.id, params.templateId),
    // 下書き列は公開側へ読み込まない
    columns: {
      draftTitle: false,
      draftDescription: false,
      draftGameLanguage: false,
      draftCraftsData: false,
      draftRemapsData: false,
      draftLoopsData: false,
      draftUpdatedAt: false,
    },
  });

  if (!template || (!template.isPublished && template.userId !== user.id)) {
    return { error: t("templates.notFound") };
  }

  const crafts = parseTemplateCrafts(template.craftsData);
  if (crafts.length === 0 || crafts.length > MAX_TEMPLATE_CRAFTS) {
    return { error: t("templates.invalidTemplateData") };
  }

  const applyRemaps = formData.get("applyRemaps") === "1";
  const target = (formData.get("target") as string) === "existing" ? "existing" : "new";
  const input = {
    crafts,
    remaps: applyRemaps ? parseTemplateRemapData(template.remapsData) : null,
    // crafts と同じタイミングで常に適用する（テンプレートの loops は適用可否を選べない）
    loops: parseTemplateLoops(template.loopsData, crafts.length),
  };

  const now = new Date();

  try {
    let presetId: string;
    let presetName: string;
    let wasActive = false;

    if (target === "existing") {
      // 既存プリセットへ反映（アクティブならライブテーブルも更新される）
      const targetPresetId = (formData.get("presetId") as string | null) || null;
      if (!targetPresetId) {
        return { error: t("mePresets.presetNotFound") };
      }
      const result = await applyCraftsToExistingPreset(db, user.id, targetPresetId, input);
      if (!result.ok) {
        return { error: t("mePresets.presetNotFound") };
      }
      presetId = result.presetId;
      presetName = result.presetName;
      wasActive = result.wasActive;
    } else {
      // 新規プリセットを作成して反映（任意でベースプリセットをコピー）
      const name = ((formData.get("name") as string | null) ?? "").trim();
      const basePresetId = (formData.get("basePresetId") as string | null) || null;
      if (!name) {
        return { error: t("mePresets.presetNameRequired") };
      }
      const result = await createPresetWithCrafts(
        db,
        user.id,
        { name, description: null, basePresetId },
        input,
      );
      if (!result.ok) {
        return { error: t("mePresets.sourcePresetNotFound") };
      }
      presetId = result.presetId;
      presetName = result.presetName;
    }

    // 変更履歴を記録
    await db.insert(configHistory).values({
      id: createId(),
      userId: user.id,
      changeType: "game_setting",
      changeDescription: t("templates.applyChangeHistoryToPreset", {
        title: template.title,
        name: presetName,
      }),
      // 反映先（または新規作成）プリセットがメインのときだけ公開影響あり
      presetId: await resolvePublicPresetId(db, user.id, presetId),
      createdAt: now,
    });

    // 適用数を加算（自分のテンプレートは除く）
    if (template.userId !== user.id) {
      await db
        .update(searchCraftTemplates)
        .set({ applyCount: sql`${searchCraftTemplates.applyCount} + 1` })
        .where(eq(searchCraftTemplates.id, template.id));
    }

    return { success: true, action: "apply", target, presetId, presetName, wasActive };
  } catch (error) {
    console.error("Template apply error:", error);
    return { error: t("templates.applyFailed") };
  }
}

export default function TemplateViewPage() {
  const t = useT();
  const loginHref = useLoginHref();
  const locale = useLocale();
  const { template, crafts, remaps, loops, author, myPresets, isOwner, isLoggedIn, appUrl } =
    useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const prevDataRef = useRef<typeof fetcher.data>(undefined);
  // 反映した（または新規作成した）プリセットを、その場で編集中にする。/me/presets の action（intent=apply-preset）へ送る
  const activateFetcher = useFetcher<{ success?: boolean; error?: string }>();
  const prevActivateDataRef = useRef<typeof activateFetcher.data>(undefined);
  const pendingActivateRef = useRef<{ id: string; name: string } | null>(null);
  const [activatedPreset, setActivatedPreset] = useState<{ id: string; name: string } | null>(null);
  const [applyDialogOpen, setApplyDialogOpen] = useState(false);
  const [applyTarget, setApplyTarget] = useState<"new" | "existing">("new");
  const [newPresetName, setNewPresetName] = useState(template.title);
  const [basePresetId, setBasePresetId] = useState("__none");
  const [targetPresetId, setTargetPresetId] = useState("");
  const [applyRemaps, setApplyRemaps] = useState(remaps.length > 0);
  const [keyboardLayout, setKeyboardLayout] = useState<KeyboardLayoutOption>("US");
  // リマップの鍵盤は md 未満でだけ開閉する（md 以上は常に表示）。既定は閉じる
  const [remapOpen, setRemapOpen] = useState(false);
  // アイテム名を閲覧者の言語で表示するトグル（走者画面のサーチクラフトタブと同じ。保存しない）。
  // 既定はテンプレートのゲーム言語（未設定は日本語）のまま。サーチ文字列・キー列は言語に依らず不変。
  // テンプレートの言語が閲覧者の言語と同じときはトグル自体を出さない
  const [itemNamesViewerLang, setItemNamesViewerLang] = useState(false);
  const viewerItemLang = itemLangForLocale(locale);
  const canToggleItemLang = (template.gameLanguage || "ja_jp") !== viewerItemLang;

  const isSubmitting = fetcher.state === "submitting";
  const selectedTargetPreset = myPresets.find((p) => p.id === targetPresetId);
  // 反映先のゲーム言語（未設定は null）。
  // 既存: 編集中ならライブ、それ以外はスナップショット。新規: 元プリセットのスナップショット（「なし」は言語が決まらない）
  // 新規で元が「なし」のときは保存先に言語が無いので、閲覧者の編集中プリセットの言語（ライブ）と比べる
  const viewerLiveLang = myPresets.find((p) => p.isActive)?.liveGameLanguage ?? null;
  const applyTargetLang =
    applyTarget === "existing"
      ? ((selectedTargetPreset?.isActive
          ? selectedTargetPreset.liveGameLanguage
          : selectedTargetPreset?.snapshotGameLanguage) ?? null)
      : basePresetId === "__none"
        ? viewerLiveLang
        : (myPresets.find((p) => p.id === basePresetId)?.snapshotGameLanguage ?? null);
  const templateLang = (template.gameLanguage || "ja_jp").toLowerCase();
  const languageMismatch = !!applyTargetLang && applyTargetLang !== templateLang;
  // 既存プリセットを選ぶ前は比べる相手が決まらないので、言語の知らせは出さない
  const languageUnset = !applyTargetLang && (applyTarget === "new" || !!selectedTargetPreset);

  // 別テンプレートへ直接遷移した場合に選択状態をリセット
  useEffect(() => {
    setApplyRemaps(remaps.length > 0);
    setNewPresetName(template.title);
    setItemNamesViewerLang(false);
  }, [template.id, template.title, remaps.length]);

  useEffect(() => {
    const data = fetcher.data;
    if (!data || data === prevDataRef.current) return;
    prevDataRef.current = data;

    if ("success" in data && data.success) {
      if (data.target === "new") {
        toast.success(t("templates.applySuccessNew", { name: data.presetName }));
      } else if (data.wasActive) {
        toast.success(t("templates.applySuccessActive", { name: data.presetName }));
      } else {
        toast.success(t("templates.applySuccessInactive", { name: data.presetName }));
      }
      setApplyDialogOpen(false);
    } else if ("error" in data && data.error) {
      toast.error(data.error);
    }
  }, [fetcher.data]);

  useEffect(() => {
    const data = activateFetcher.data;
    if (!data || data === prevActivateDataRef.current) return;
    prevActivateDataRef.current = data;
    const pending = pendingActivateRef.current;
    if (data.success && pending) {
      setActivatedPreset(pending);
      toast.success(t("templates.activateSuccess", { name: pending.name }));
    } else if (data.error) {
      toast.error(data.error);
    }
  }, [activateFetcher.data]);

  const handleActivate = (presetId: string, presetName: string) => {
    const formData = new FormData();
    formData.set("intent", "apply-preset");
    formData.set("presetId", presetId);
    pendingActivateRef.current = { id: presetId, name: presetName };
    activateFetcher.submit(formData, { method: "post", action: "/me/presets" });
  };

  const handleApplyDialogOpenChange = (open: boolean) => {
    setApplyDialogOpen(open);
    if (!open) {
      setApplyTarget("new");
      setNewPresetName(template.title);
      setBasePresetId("__none");
      setTargetPresetId("");
      setApplyRemaps(remaps.length > 0);
    }
  };

  const handleApply = () => {
    const formData = new FormData();
    formData.set("_action", "apply");
    formData.set("target", applyTarget);
    formData.set("applyRemaps", applyRemaps ? "1" : "0");
    if (applyTarget === "new") {
      formData.set("name", newPresetName.trim());
      if (basePresetId !== "__none") {
        formData.set("basePresetId", basePresetId);
      }
    } else {
      formData.set("presetId", targetPresetId);
    }
    fetcher.submit(formData, { method: "post" });
  };

  // サーチクラフト（グループカード表示・Loop 参照解決の両方で使うため合成 id を一度だけ振る）
  const parsedSearchCrafts = crafts.map((craft, idx) => ({
    ...craft,
    id: `craft-${idx}`,
    sequence: idx + 1,
  }));
  const loopCraftRefs: LoopCraftInfo[] = crafts.map((craft, idx) => ({
    id: `craft-${idx}`,
    items: craft.items,
    variations: craft.variations,
  }));

  // 繋ぎ方（Loop）を timing ごとにグループ化し、SearchCraftGroupedList の renderGroupExtra から
  // 各タイミンググループカード内に埋め込むための関数を作る（プロフィールと同じパターン）
  const searchCraftLoopRows: SearchCraftLoopRowData[] = loops.map((loop, idx) => ({
    id: `loop-${idx}`,
    steps: loop.steps.map((s) => ({
      craftId: `craft-${s.craftIndex}`,
      transition: s.transition,
      variationIndex: s.variationIndex,
    })),
    comment: loop.comment,
    timing: loop.timing,
  }));
  const searchCraftLoopTimings = Array.from(groupLoopsByTiming(searchCraftLoopRows).keys());
  const renderSearchCraftLoopExtra = makeLoopGroupExtra({
    loops: searchCraftLoopRows,
    crafts: loopCraftRefs,
    remaps,
    keyboardLayout,
  });

  return (
    <div className="space-y-6">
      {/* スキップリンク: ヘッダー・操作ボタンを飛ばして本題のクラフトの節へ（フォーカス時だけ見える） */}
      <a
        href="#template-craft-heading"
        className="sr-only rounded-md border bg-background px-3 py-2 text-sm font-medium text-foreground focus:not-sr-only focus:fixed focus:left-4 focus:top-20 focus:z-50"
      >
        {t("templates.skipToCrafts")}
      </a>

      <div>
        <Button variant="ghost" size="sm" asChild className="-ml-2 h-11 sm:h-8">
          <Link to="/guides/templates">
            <ArrowLeft className="h-4 w-4 mr-1" />
            {t("templates.backToList")}
          </Link>
        </Button>
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold">{template.title}</h1>
          {!template.isPublished && (
            <StatusPill icon={EyeOff}>{t("templates.unpublishedBadge")}</StatusPill>
          )}
        </div>
        {/* MinecraftAvatar は div を描くので、p ではなく div で包む（p の中に div は置けずハイドレーションが壊れる） */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
          {/* 押せる高さは負のマージン＋同じ量の padding で広げる（モバイル 44px、sm 以上 24px。行の高さは変えない） */}
          <Link
            to={`/player/${author.slug}`}
            className="-my-3 inline-flex items-center gap-1.5 py-3 text-foreground transition-colors hover:text-primary sm:-my-0.5 sm:py-0.5"
          >
            <MinecraftAvatar
              uuid={author.uuid}
              skinUrl={author.skinUrl}
              size={20}
              alt=""
              className="shrink-0 rounded-md"
            />
            {author.name}
          </Link>
          <span aria-hidden>·</span>
          {/* 相対時刻はSSR時とhydration時で基準時刻がずれるため警告を抑制 */}
          <span suppressHydrationWarning>
            {formatDistanceToNow(new Date(template.createdAt), {
              addSuffix: true,
              locale: dateFnsLocale(locale),
            })}
          </span>
          <span aria-hidden>·</span>
          <span className="inline-flex items-center gap-1">
            <Search className="h-3 w-3" aria-hidden />
            {t("templates.craftCount", { count: crafts.length })}
          </span>
          {remaps.length > 0 && (
            <>
              <span aria-hidden>·</span>
              <span className="inline-flex items-center gap-1">
                <Keyboard className="h-3 w-3" aria-hidden />
                {t("templates.remapCount", { count: remaps.length })}
              </span>
            </>
          )}
          <span aria-hidden>·</span>
          <span className="inline-flex items-center gap-1">
            <Download className="h-3 w-3" aria-hidden />
            {t("templates.applyCount", { count: template.applyCount })}
          </span>
        </div>
        {template.description && (
          <p className="text-sm whitespace-pre-wrap">{template.description}</p>
        )}
        {/* ゲーム内言語（サーチ文字列の前提となる最重要情報のため大きく表示） */}
        {template.gameLanguage && (
          <div className="flex items-center gap-2">
            <Languages className="h-5 w-5 text-primary" aria-hidden />
            <span className="shrink-0 whitespace-nowrap text-sm text-muted-foreground">
              {t("playerProfile.gameLanguage")}:
            </span>
            <span className="text-base font-medium">
              {getGameLanguageName(t, locale, template.gameLanguage)}
            </span>
          </div>
        )}
      </div>

      {/* アクションボタン。モバイルは主操作（反映）だけを全幅で1段目に置き、残り（Playground・シェア・いいね・管理）は
          アイコンだけの 44px のボタンで2段目の1行に収める（名前は sr-only で残す）。sm 以上は従来どおり文字つきで1行 */}
      <div className="flex flex-wrap items-center gap-2">
        {isLoggedIn ? (
          <Dialog open={applyDialogOpen} onOpenChange={handleApplyDialogOpenChange}>
            <DialogTrigger asChild>
              <Button disabled={isSubmitting} className="h-11 w-full sm:h-9 sm:w-auto">
                <Download className="mr-2 h-4 w-4" />
                {t("templates.apply")}
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>{t("templates.applyConfirmTitle")}</DialogTitle>
                <DialogDescription>{t("templates.applyDialogDescription")}</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-2">
                {/* 反映先の選択。行全体を label にして押せる範囲を広げる（モバイル 44px、sm 以上 32px） */}
                <div className="space-y-2">
                  <p id="apply-target-heading" className="text-sm font-medium">
                    {t("templates.applyTargetHeading")}
                  </p>
                  <RadioGroup
                    value={applyTarget}
                    onValueChange={(v) => setApplyTarget(v as "new" | "existing")}
                    aria-labelledby="apply-target-heading"
                    className="gap-1"
                  >
                    <Label
                      htmlFor="apply-target-new"
                      className="min-h-11 cursor-pointer gap-2 font-normal sm:min-h-8"
                    >
                      <RadioGroupItem value="new" id="apply-target-new" />
                      {t("templates.applyTargetNew")}
                    </Label>
                    <Label
                      htmlFor="apply-target-existing"
                      className={cn(
                        "min-h-11 gap-2 font-normal sm:min-h-8",
                        myPresets.length === 0
                          ? "cursor-not-allowed text-muted-foreground"
                          : "cursor-pointer",
                      )}
                    >
                      <RadioGroupItem
                        value="existing"
                        id="apply-target-existing"
                        disabled={myPresets.length === 0}
                      />
                      {t("templates.applyTargetExisting")}
                    </Label>
                  </RadioGroup>
                  {myPresets.length === 0 && (
                    <p className="text-xs text-muted-foreground">
                      {t("templates.applyNoPresets")}
                    </p>
                  )}
                  {/* ゲーム言語の知らせは、反映先を選んだ直後（判断の直下）に置く */}
                  {languageMismatch && applyTargetLang && (
                    <NoticeBanner tone="warning" className="px-3 py-2">
                      {t(
                        applyTarget === "new" && basePresetId === "__none"
                          ? "templates.applyLanguageMismatchCurrent"
                          : "templates.applyLanguageMismatch",
                        {
                          templateLang: getGameLanguageName(t, locale, templateLang),
                          myLang: getGameLanguageName(t, locale, applyTargetLang),
                        },
                      )}
                    </NoticeBanner>
                  )}
                  {languageUnset && (
                    <NoticeBanner tone="info" className="px-3 py-2">
                      {t("templates.applyLanguageUnset", {
                        templateLang: getGameLanguageName(t, locale, templateLang),
                      })}
                    </NoticeBanner>
                  )}
                </div>

                {applyTarget === "new" ? (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="apply-new-name">{t("mePresets.presetName")}</Label>
                      <Input
                        id="apply-new-name"
                        value={newPresetName}
                        onChange={(e) => setNewPresetName(e.target.value)}
                        placeholder={t("mePresets.presetNamePlaceholder")}
                      />
                    </div>
                    {myPresets.length > 0 && (
                      <div className="space-y-2">
                        <Label htmlFor="apply-base-preset">
                          {t("playground.basePresetLabel")}
                        </Label>
                        <Select value={basePresetId} onValueChange={setBasePresetId}>
                          <SelectTrigger id="apply-base-preset">
                            <SelectValue placeholder={t("playground.basePresetNone")} />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none">
                              {t("playground.basePresetNone")}
                            </SelectItem>
                            {myPresets.map((preset) => (
                              <SelectItem key={preset.id} value={preset.id}>
                                <div className="flex items-center gap-2">
                                  {preset.name}
                                  {preset.isActive && (
                                    <Badge variant="outline" className="text-xs ml-1">
                                      {t("mePresets.active")}
                                    </Badge>
                                  )}
                                </div>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground">
                          {t("playground.basePresetHint")}
                        </p>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="space-y-2">
                    <Label htmlFor="apply-target-preset">
                      {t("templates.applyTargetPresetLabel")}
                    </Label>
                    <Select value={targetPresetId} onValueChange={setTargetPresetId}>
                      <SelectTrigger id="apply-target-preset">
                        <SelectValue placeholder={t("mePresets.selectPreset")} />
                      </SelectTrigger>
                      <SelectContent>
                        {myPresets.map((preset) => (
                          <SelectItem key={preset.id} value={preset.id}>
                            <div className="flex items-center gap-2">
                              {preset.name}
                              {preset.isActive && (
                                <Badge variant="outline" className="text-xs ml-1">
                                  {t("mePresets.active")}
                                </Badge>
                              )}
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {selectedTargetPreset?.isActive && (
                      <NoticeBanner tone="warning" className="px-3 py-2">
                        {t("templates.applyActiveWarning")}
                      </NoticeBanner>
                    )}
                  </div>
                )}

                {remaps.length > 0 && (
                  <div className="flex items-start gap-2">
                    <Checkbox
                      id="apply-remaps"
                      checked={applyRemaps}
                      onCheckedChange={(checked) => setApplyRemaps(checked === true)}
                    />
                    <div className="grid gap-1 leading-none">
                      <Label htmlFor="apply-remaps" className="text-sm">
                        {t("templates.applyRemapsLabel", { count: remaps.length })}
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        {t("templates.applyRemapsHint")}
                      </p>
                    </div>
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  className="min-h-11 sm:min-h-9"
                  onClick={() => setApplyDialogOpen(false)}
                >
                  {t("templates.cancel")}
                </Button>
                <Button
                  className="min-h-11 sm:min-h-9"
                  onClick={handleApply}
                  disabled={
                    isSubmitting ||
                    (applyTarget === "new" && !newPresetName.trim()) ||
                    (applyTarget === "existing" && !targetPresetId)
                  }
                >
                  {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {t(applyTarget === "new" ? "templates.applyConfirmNew" : "templates.applyConfirm")}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        ) : (
          <Button asChild className="h-11 w-full sm:h-9 sm:w-auto">
            <Link to={loginHref}>
              <LogIn className="mr-2 h-4 w-4" />
              {t("templates.loginToApply")}
            </Link>
          </Button>
        )}
        <Button asChild variant="outline" className="size-11 sm:size-auto sm:h-9">
          <Link to={`/playground?template=${template.id}`}>
            <FlaskConical className="h-4 w-4 sm:mr-2" aria-hidden />
            <span className="sr-only sm:not-sr-only">{t("templates.tryInPlayground")}</span>
          </Link>
        </Button>
        <ShareButton
          title={`${template.title} - ${t("templates.pageTitle")} | Minefolio`}
          url={`${appUrl}/guides/templates/${template.id}`}
          compactOnMobile
          compactBelow="sm"
          className="h-11 max-sm:min-w-11 sm:h-9"
        />
        <LikeButton
          variant="detail"
          targetType="template"
          targetId={template.id}
          likeCount={template.likeCount}
          isOwn={isOwner}
          compactLabel
          className="h-11 max-sm:min-w-11 sm:h-9"
        />
        {isOwner && (
          <Button asChild variant="ghost" size="sm" className="ml-auto size-11 sm:size-auto sm:h-9">
            <Link to="/my-guides/templates">
              <Settings className="h-4 w-4 sm:mr-2" aria-hidden />
              <span className="sr-only sm:not-sr-only">{t("templates.manage")}</span>
            </Link>
          </Button>
        )}
      </div>

      {fetcher.data && "success" in fetcher.data && fetcher.data.success && (
        <NoticeBanner tone="success" className="px-3 py-2">
          {activatedPreset && activatedPreset.id === fetcher.data.presetId ? (
            <>
              {t("templates.activatedHint", { name: activatedPreset.name })}{" "}
              <Link
                to="/me/search-craft"
                className="text-primary underline underline-offset-2 hover:text-primary/80"
              >
                {t("templates.goToMySearchCraft")}
              </Link>
            </>
          ) : fetcher.data.target === "existing" && fetcher.data.wasActive ? (
            // 編集中のプリセットへ反映した場合は現在の設定が変わっている
            <>
              {t("templates.appliedHint")}{" "}
              <Link
                to="/me/search-craft"
                className="text-primary underline underline-offset-2 hover:text-primary/80"
              >
                {t("templates.goToMySearchCraft")}
              </Link>
            </>
          ) : (
            // 新規 / 編集中でないプリセットへの反映では今の設定は変わらないので、その場で編集中にできるようにする
            <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
              <span>
                {t(
                  fetcher.data.target === "new"
                    ? "templates.appliedHintNew"
                    : "templates.appliedHintInactive",
                )}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="min-h-11 sm:min-h-8"
                disabled={activateFetcher.state !== "idle"}
                onClick={() =>
                  handleActivate(
                    (fetcher.data as { presetId: string }).presetId,
                    (fetcher.data as { presetName: string }).presetName,
                  )
                }
              >
                {activateFetcher.state !== "idle" && (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                )}
                {t("templates.activatePreset")}
              </Button>
            </span>
          )}
        </NoticeBanner>
      )}

      {/* サーチクラフト（繋ぎ方〈Loop〉はタイミンググループカード内のサブセクションとして表示） */}
      {/* 見出しの id は PageSection が `${id}-heading` で付ける（スキップリンクの #template-craft-heading） */}
      <PageSection
        id="template-craft"
        title={t("templates.craftSection")}
        first
        badge={
          loops.length > 0 ? (
            // 何を数えているかの説明をホバー／フォーカス（タッチはタップ）で出す。名前は見えている文字から始まる説明文
            <HintTip message={t("templates.loopCountHint", { count: loops.length })}>
              <Badge variant="secondary" className="text-xs">
                {t("templates.loopCount", { count: loops.length })}
              </Badge>
            </HintTip>
          ) : undefined
        }
      >
        {canToggleItemLang && (
          // スイッチ＋ラベル（label で結ぶ。モバイルは押せる範囲 44px、sm 以上は 32px）
          <div>
            <label className="flex min-h-11 max-w-full cursor-pointer items-center gap-2 text-sm sm:min-h-8">
              <Switch
                checked={itemNamesViewerLang}
                onCheckedChange={setItemNamesViewerLang}
                aria-describedby="template-item-lang-hint"
              />
              <span className="min-w-0">
                {t("playerProfile.searchCraftItemNamesIn", {
                  language: t("playerProfile.searchCraftViewerLangName"),
                })}
              </span>
            </label>
            <p id="template-item-lang-hint" className="text-xs text-muted-foreground">
              {t("templates.itemLangToggleHint", {
                gameLanguage: getGameLanguageName(t, locale, template.gameLanguage || "ja_jp"),
              })}
            </p>
          </div>
        )}
        {/* 記事内の埋め込み（guide-embeds.tsx の SearchCraftEmbedBody）と同じ開閉と枠: グループは箱にせず
            見出し（欄 h2 の下なので h3）＋行。2つ以上なら開閉でき、lg 以上は全部開いて、lg 未満は先頭が長ければ全部閉じて始める。
            閉じた本体も DOM に残す（ページ内検索で見つかる）。凡例は「すべて開く」と同じ行に置く */}
        <SearchCraftGroupedList
          toolbarStart={
            <KeyBadgeLegend showCraftMarker={loops.length > 0} showRemapped={remaps.length > 0} />
          }
          framed={false}
          collapsible={countSearchCraftGroups(parsedSearchCrafts, searchCraftLoopTimings) > 1}
          openFirstMaxCount={SEARCH_CRAFT_OPEN_FIRST_MAX}
          openAllFromLg
          keepClosedMounted
          groupHeadingLevel="h3"
          crafts={parsedSearchCrafts}
          remaps={remaps}
          gameLanguage={itemNamesViewerLang ? viewerItemLang : template.gameLanguage}
          keyboardLayout={keyboardLayout}
          extraTimings={searchCraftLoopTimings}
          renderGroupExtra={renderSearchCraftLoopExtra}
        />
      </PageSection>

      {/* リマップ（バーチャルキーボード表示）。本題はクラフトの節なので後ろに置き、
          md 未満では既定で閉じる（鍵盤は 1152px 幅・キーが多くタブ停止も増えるため。md 以上は常に開く） */}
      {remaps.length > 0 && (
        <PageSection
          id="template-remap"
          title={t("templates.remapSection")}
          action={
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-h-11 md:hidden"
              aria-expanded={remapOpen}
              aria-controls="template-remap-panel"
              onClick={() => setRemapOpen((open) => !open)}
            >
              {remapOpen ? (
                <ChevronUp className="mr-1 h-4 w-4" />
              ) : (
                <ChevronDown className="mr-1 h-4 w-4" />
              )}
              {remapOpen ? t("templates.remapHide") : t("templates.remapShow")}
            </Button>
          }
        >
          <p className="text-sm text-muted-foreground">
            {t("templates.remapSectionDescription")}
          </p>
          {/* md 未満: 鍵盤（約1120px）は横スクロールしないと読めないので、リマップは「元のキー → 先」の一覧で常に出す
              （/keybindings/visual の AssignmentAccordion と同じ表記）。鍵盤は下の「キーボードを表示」で補助として開く */}
          <ul
            aria-label={t("templates.remapListLabel")}
            className="flex flex-wrap gap-1.5 md:hidden"
          >
            {remaps.map((remap, index) => (
              <li
                key={`${remap.sourceKey}-${index}`}
                className="inline-flex max-w-full items-center gap-1 rounded bg-secondary/80 px-1.5 py-0.5 font-mono text-xs break-all"
              >
                {getRemapSourceLabel(t, remap.sourceKey, keyboardLayout)}
                <span className="text-muted-foreground">→</span>
                {getRemapOutputLabel(t, remap, keyboardLayout)}
              </li>
            ))}
          </ul>
          <div
            id="template-remap-panel"
            className={cn("space-y-3", !remapOpen && "hidden md:block")}
          >
            <Select
              value={keyboardLayout}
              onValueChange={(v) => setKeyboardLayout(v as KeyboardLayoutOption)}
            >
              <SelectTrigger className="w-32" aria-label={t("templates.keyboardLayoutLabel")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LAYOUT_OPTIONS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option.replace("_", " ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <HorizontalScrollArea surface="background">
              <VirtualKeyboard
                layout={keyboardLayout}
                keybindings={{}}
                remaps={remaps}
                showRemaps
                hideNumpad
              />
            </HorizontalScrollArea>
          </div>
        </PageSection>
      )}
    </div>
  );
}

export function ErrorBoundary() {
  const t = useT();
  return (
    <GuideRouteNotFound
      title={t("templates.notFound")}
      description={t("templates.notFoundHint")}
      backTo="/guides/templates"
      backLabel={t("templates.backToList")}
    />
  );
}
