import { createTranslator } from "@/lib/messages";
import { localeFromMatches, resolveLocale } from "@/lib/locale";
import { getLocalizedDisplayName } from "@/lib/slug";
import { useState, useEffect, useRef } from "react";
import { useLoaderData, useFetcher, Link } from "react-router";
import type { Route } from "./+types/view";
import { createDb } from "@/lib/db";
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
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
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
import { LikeButton } from "@/components/like-button";
import { getTemplateLikeCount } from "@/lib/likes.server";
import {
  SearchCraftGroupedList,
  KeyBadgeLegend,
} from "@/components/search-craft-template-view";
import {
  SearchCraftLoopList,
  type LoopCraftInfo,
  type SearchCraftLoopRowData,
} from "@/components/search-craft-loop-view";
import { VirtualKeyboard } from "@/components/virtual-keyboard";
import {
  ArrowLeft,
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
import { getGameLanguageName } from "@/lib/game-languages";
import { formatDistanceToNow } from "date-fns";
import { dateFnsLocale } from "@/lib/date-locale";

// リマップ表示用のバーチャルキーボードのレイアウト切替（テンプレートはレイアウト情報を持たないため閲覧者が選択）
type KeyboardLayoutOption = "US" | "JIS" | "US_TKL" | "JIS_TKL";
const LAYOUT_OPTIONS: KeyboardLayoutOption[] = ["US", "JIS", "US_TKL", "JIS_TKL"];

export const meta: Route.MetaFunction = ({ matches, loaderData }) => {
  const t = createTranslator(localeFromMatches(matches));
  if (!loaderData) {
    return [{ title: t("templates.title") }];
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

  const session = await getOptionalSession(request, auth);

  const template = await db.query.searchCraftTemplates.findFirst({
    where: eq(searchCraftTemplates.id, params.templateId),
    with: {
      user: {
        columns: {
          id: true,
          slug: true,
          displayName: true,
          displayNameAlphabet: true,
          mcid: true,
          discordId: true,
          profileVisibility: true,
        },
      },
    },
  });

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
  let myPresets: { id: string; name: string; isActive: boolean }[] = [];
  if (session) {
    const me = await db.query.users.findFirst({
      where: eq(users.discordId, session.user.id),
      with: {
        configPresets: { columns: { id: true, name: true, isActive: true } },
      },
    });
    myPresets = me?.configPresets ?? [];
  }

  const appUrl = env.APP_URL || "https://minefolio.app";
  const likeCount = await getTemplateLikeCount(db, template.id);

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
      presetId,
      createdAt: now,
    });

    // 適用数を加算（自分のテンプレートは除く）
    if (template.userId !== user.id) {
      await db
        .update(searchCraftTemplates)
        .set({ applyCount: sql`${searchCraftTemplates.applyCount} + 1` })
        .where(eq(searchCraftTemplates.id, template.id));
    }

    return { success: true, action: "apply", target, presetName, wasActive };
  } catch (error) {
    console.error("Template apply error:", error);
    return { error: t("templates.applyFailed") };
  }
}

export default function TemplateViewPage() {
  const t = useT();
  const locale = useLocale();
  const { template, crafts, remaps, loops, author, myPresets, isOwner, isLoggedIn, appUrl } =
    useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const prevDataRef = useRef<typeof fetcher.data>(undefined);
  const [applyDialogOpen, setApplyDialogOpen] = useState(false);
  const [applyTarget, setApplyTarget] = useState<"new" | "existing">("new");
  const [newPresetName, setNewPresetName] = useState(template.title);
  const [basePresetId, setBasePresetId] = useState("__none");
  const [targetPresetId, setTargetPresetId] = useState("");
  const [applyRemaps, setApplyRemaps] = useState(remaps.length > 0);
  const [keyboardLayout, setKeyboardLayout] = useState<KeyboardLayoutOption>("US");

  const isSubmitting = fetcher.state === "submitting";
  const selectedTargetPreset = myPresets.find((p) => p.id === targetPresetId);

  // 別テンプレートへ直接遷移した場合に選択状態をリセット
  useEffect(() => {
    setApplyRemaps(remaps.length > 0);
    setNewPresetName(template.title);
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

  return (
    <div className="space-y-6">
      <div>
        <Link
          to="/guides/templates"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("templates.backToList")}
        </Link>
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold">{template.title}</h1>
          {!template.isPublished && (
            <Badge variant="outline" className="text-muted-foreground">
              <EyeOff className="h-3 w-3 mr-1" />
              {t("templates.unpublishedBadge")}
            </Badge>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          {t("templates.byAuthorPrefix")}{" "}
          <Link to={`/player/${author.slug}`} className="text-primary hover:underline">
            {author.name}
          </Link>
          <span className="mx-2">·</span>
          {/* 相対時刻はSSR時とhydration時で基準時刻がずれるため警告を抑制 */}
          <span suppressHydrationWarning>
            {formatDistanceToNow(new Date(template.createdAt), {
              addSuffix: true,
              locale: dateFnsLocale(locale),
            })}
          </span>
        </p>
        {template.description && (
          <p className="text-sm whitespace-pre-wrap">{template.description}</p>
        )}
        {/* ゲーム内言語（サーチ文字列の前提となる最重要情報のため大きく表示） */}
        {template.gameLanguage && (
          <div className="flex items-center gap-2">
            <Languages className="h-5 w-5 text-primary" />
            <span className="text-sm text-muted-foreground">
              {t("playerProfile.gameLanguage")}:
            </span>
            <span className="text-lg font-semibold">
              {getGameLanguageName(t, locale, template.gameLanguage)}
            </span>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="secondary" className="text-xs">
            <Search className="h-3 w-3 mr-1" />
            {t("templates.craftCount", { count: crafts.length })}
          </Badge>
          {remaps.length > 0 && (
            <Badge variant="secondary" className="text-xs">
              <Keyboard className="h-3 w-3 mr-1" />
              {t("templates.remapCount", { count: remaps.length })}
            </Badge>
          )}
          <span className="inline-flex items-center gap-1">
            <Download className="h-3 w-3" />
            {t("templates.applyCount", { count: template.applyCount })}
          </span>
        </div>
      </div>

      {/* アクションボタン */}
      <div className="flex flex-wrap items-center gap-2">
        {isLoggedIn ? (
          <Dialog open={applyDialogOpen} onOpenChange={handleApplyDialogOpenChange}>
            <DialogTrigger asChild>
              <Button disabled={isSubmitting}>
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
                {/* 反映先の選択 */}
                <RadioGroup
                  value={applyTarget}
                  onValueChange={(v) => setApplyTarget(v as "new" | "existing")}
                  className="space-y-2"
                >
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="new" id="apply-target-new" />
                    <Label htmlFor="apply-target-new" className="cursor-pointer font-normal">
                      {t("templates.applyTargetNew")}
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem
                      value="existing"
                      id="apply-target-existing"
                      disabled={myPresets.length === 0}
                    />
                    <Label
                      htmlFor="apply-target-existing"
                      className={cn(
                        "cursor-pointer font-normal",
                        myPresets.length === 0 && "text-muted-foreground",
                      )}
                    >
                      {t("templates.applyTargetExisting")}
                    </Label>
                  </div>
                </RadioGroup>

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
                    <p className="text-xs text-muted-foreground">
                      {t("templates.applyNewNote")}
                    </p>
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
                      <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-foreground">
                        {t("templates.applyActiveWarning")}
                      </p>
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
                <Button variant="outline" onClick={() => setApplyDialogOpen(false)}>
                  {t("templates.cancel")}
                </Button>
                <Button
                  onClick={handleApply}
                  disabled={
                    isSubmitting ||
                    (applyTarget === "new" && !newPresetName.trim()) ||
                    (applyTarget === "existing" && !targetPresetId)
                  }
                >
                  {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {t("templates.applyConfirm")}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        ) : (
          <Button asChild>
            <Link to="/login">
              <LogIn className="mr-2 h-4 w-4" />
              {t("templates.loginToApply")}
            </Link>
          </Button>
        )}
        <Button asChild variant="outline">
          <Link to={`/playground?template=${template.id}`}>
            <FlaskConical className="mr-2 h-4 w-4" />
            {t("templates.tryInPlayground")}
          </Link>
        </Button>
        <ShareButton
          title={`${template.title} - ${t("templates.pageTitle")} | Minefolio`}
          url={`${appUrl}/guides/templates/${template.id}`}
        />
        <LikeButton
          variant="detail"
          targetType="template"
          targetId={template.id}
          likeCount={template.likeCount}
          isOwn={isOwner}
        />
        {isOwner && (
          <Button asChild variant="ghost" size="sm" className="ml-auto">
            <Link to="/my-guides/templates">
              <Settings className="mr-2 h-4 w-4" />
              {t("templates.manage")}
            </Link>
          </Button>
        )}
      </div>

      {fetcher.data && "success" in fetcher.data && fetcher.data.success && (
        <div className="rounded-lg border border-success/40 bg-success/10 p-4 text-sm">
          {t("templates.appliedHint")}{" "}
          {fetcher.data.target === "existing" && fetcher.data.wasActive ? (
            // アクティブプリセットへ反映した場合は現在の設定が変わっている
            <Link to="/me/search-craft" className="text-primary hover:underline">
              {t("templates.goToMySearchCraft")}
            </Link>
          ) : (
            // 新規 / 非アクティブプリセットへの反映はプリセット管理から適用する
            <Link to="/me/presets" className="text-primary hover:underline">
              {t("templates.goToPresets")}
            </Link>
          )}
        </div>
      )}

      {/* リマップ（バーチャルキーボード表示） */}
      {remaps.length > 0 && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 className="text-lg font-semibold">{t("templates.remapSection")}</h2>
              <p className="text-sm text-muted-foreground">
                {t("templates.remapSectionDescription")}
              </p>
            </div>
            <Select
              value={keyboardLayout}
              onValueChange={(v) => setKeyboardLayout(v as KeyboardLayoutOption)}
            >
              <SelectTrigger className="w-32">
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
          </div>
          <Card>
            <CardContent className="custom-scrollbar p-4 overflow-x-auto">
              <VirtualKeyboard
                layout={keyboardLayout}
                keybindings={{}}
                remaps={remaps}
                showRemaps
                hideNumpad
              />
            </CardContent>
          </Card>
        </section>
      )}

      {/* サーチクラフト */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">{t("templates.craftSection")}</h2>
          <KeyBadgeLegend />
        </div>
        <SearchCraftGroupedList
          crafts={crafts.map((craft, idx) => ({
            ...craft,
            id: `craft-${idx}`,
            sequence: idx + 1,
          }))}
          remaps={remaps}
          gameLanguage={template.gameLanguage}
        />
      </section>

      {/* 繋ぎ方（Loop） */}
      {loops.length > 0 && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">{t("templates.loopSection")}</h2>
            <Badge variant="secondary" className="text-xs">
              {t("templates.loopCount", { count: loops.length })}
            </Badge>
          </div>
          <SearchCraftLoopList
            loops={loops.map(
              (loop, idx): SearchCraftLoopRowData => ({
                id: `loop-${idx}`,
                steps: loop.steps.map((s) => ({
                  craftId: `craft-${s.craftIndex}`,
                  transition: s.transition,
                })),
                comment: loop.comment,
                timing: loop.timing,
              }),
            )}
            crafts={crafts.map(
              (craft, idx): LoopCraftInfo => ({
                id: `craft-${idx}`,
                items: craft.items,
                searchStr: craft.searchStr,
              }),
            )}
            remaps={remaps}
          />
        </section>
      )}
    </div>
  );
}
