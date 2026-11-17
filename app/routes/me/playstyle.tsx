import { createTranslator } from "@/lib/messages";
import { localeFromMatches, resolveLocale } from "@/lib/locale";
import { useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";
import { useLoaderData, useFetcher, Link, type ShouldRevalidateFunctionArgs } from "react-router";
import type { Route } from "./+types/playstyle";
import { createDb } from "@/lib/db";
import { createAuth } from "@/lib/auth";
import { getSession } from "@/lib/session";
import { getEnv } from "@/lib/env.server";
import { users, playstyles } from "@/lib/schema";
import { cn } from "@/lib/utils";
import { eq } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { FloatingSaveBar } from "@/components/floating-save-bar";
import { Card, CardContent } from "@/components/ui/card";
import { PageSection } from "@/components/page-section";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Layers, SlidersHorizontal, Sparkles, AlertCircle, ExternalLink } from "lucide-react";
import { useT } from "@/hooks/use-locale";
import { useLoaderSyncedDraft, successfulSaveToken } from "@/hooks/use-loader-synced-draft";
import {
  ALL_VERSION_KEYS,
  CATEGORIES,
  CATEGORY_KEYS,
  CLICK_METHOD_KEYS,
  HOTBAR_SWITCHING_OPTIONS,
  SEARCH_CRAFT_OPTIONS,
  FREQUENCY_OPTIONS,
  ITEM_LAYOUT_POLICY_OPTIONS,
  CLICK_METHOD_OPTIONS,
  CAN_CANNOT_OPTIONS,
  USES_MOUSEPAD_OPTIONS,
  BASTION_OPTIONS,
  editionOfVersion,
  versionLabel,
  groupVersionsByEdition,
  parsePlaystyleVersions,
  parsePlaystyleCategories,
  parsePlaystyleClickMethods,
  isVersionKey,
  isCategoryKey,
  isKbmPlaystyle,
  playsJavaRsgOrRanked,
  hasBastionVersions,
  hidesSearchCraft,
  categoryLabel,
  validatePlaystyle,
  parseInputMethodInput,
  type VersionKey,
  type CategoryKey,
  type HotbarSwitching,
  type SearchCraftLevel,
  type FrequencyLevel,
  type ItemLayoutPolicy,
  type ClickMethod,
  type UsesMousepad,
  type CanCannot,
  type BastionType,
  type PlaystyleLabelKey,
} from "@/lib/playstyle";

export const meta: Route.MetaFunction = ({ matches }) => {
  const t = createTranslator(localeFromMatches(matches));
  return [{ title: t("mePlaystyle.title") }];
};

// 再検証を制御：actionの結果に応じてのみ再検証（プリセット非依存のページなので単純な形でよい）
export function shouldRevalidate({ actionResult, defaultShouldRevalidate }: ShouldRevalidateFunctionArgs) {
  if (actionResult !== undefined) {
    return defaultShouldRevalidate;
  }
  return false;
}

export async function loader({ request }: Route.LoaderArgs) {
  const t = createTranslator(resolveLocale(request));
  const env = getEnv();
  const db = createDb();
  const auth = createAuth(db, env);

  const session = await getSession(request, auth);

  const user = await db.query.users.findFirst({
    where: eq(users.discordId, session.user.id),
    with: { playstyle: true },
  });

  if (!user) {
    throw new Response(t("mePlaystyle.userNotFound"), { status: 404 });
  }

  const ps = user.playstyle;
  const mainVersionRaw = ps?.mainVersion;
  const mainCategoryRaw = ps?.mainCategory;

  return {
    // "" as const で空文字リテラルの型を保つ（付けないと `?? ""` の結果が string に広がり、
    // PlaystyleFormValues["inputMethod"] への代入で型エラーになる）
    inputMethod: user.inputMethod ?? ("" as const),
    versions: parsePlaystyleVersions(ps?.versions),
    categories: parsePlaystyleCategories(ps?.categories),
    mainVersion: isVersionKey(mainVersionRaw) ? mainVersionRaw : null,
    mainCategory: isCategoryKey(mainCategoryRaw) ? mainCategoryRaw : null,
    hotbarSwitching: ps?.hotbarSwitching ?? null,
    searchCraft: ps?.searchCraft ?? null,
    halfShift: ps?.halfShift ?? null,
    itemLayoutPolicy: ps?.itemLayoutPolicy ?? null,
    clickMethods: parsePlaystyleClickMethods(ps?.clickMethods),
    dragTapeType: ps?.dragTapeType ?? "",
    usesMousepad: ps?.usesMousepad ?? null,
    mousepadType: ps?.mousepadType ?? "",
    zeroCycle: ps?.zeroCycle ?? null,
    groundZero: ps?.groundZero ?? null,
    oneshot: ps?.oneshot ?? null,
    favoriteBastion: ps?.favoriteBastion ?? null,
  };
}

// ローディング中に表示するスケルトンUI（ナビゲーション時用）
export function HydrateFallback() {
  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      <div>
        <Skeleton className="h-8 w-36 mb-2" />
        <Skeleton className="h-4 w-72" />
      </div>
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="rounded-lg border bg-card p-6 space-y-4">
          <Skeleton className="h-6 w-32" />
          <div className="space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        </div>
      ))}
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
    return { error: t("mePlaystyle.userNotFound") };
  }

  const formData = await request.formData();

  // 入力方法（users.inputMethod。プレイスタイルとは別テーブルだがこのページでまとめて編集する）。
  // 検証は me/devices の入力方法の保存と同形（共通ヘルパー parseInputMethodInput）
  const inputMethodResult = parseInputMethodInput(formData.get("inputMethod"));
  if (!inputMethodResult.ok) {
    return { error: t("mePlaystyle.errorInvalidOption") };
  }
  const inputMethod = inputMethodResult.value;

  const result = validatePlaystyle({
    versions: formData.getAll("versions"),
    categories: formData.getAll("categories"),
    mainVersion: formData.get("mainVersion"),
    mainCategory: formData.get("mainCategory"),
    hotbarSwitching: formData.get("hotbarSwitching"),
    searchCraft: formData.get("searchCraft"),
    halfShift: formData.get("halfShift"),
    itemLayoutPolicy: formData.get("itemLayoutPolicy"),
    clickMethods: formData.getAll("clickMethods"),
    dragTapeType: formData.get("dragTapeType"),
    usesMousepad: formData.get("usesMousepad"),
    mousepadType: formData.get("mousepadType"),
    zeroCycle: formData.get("zeroCycle"),
    groundZero: formData.get("groundZero"),
    oneshot: formData.get("oneshot"),
    favoriteBastion: formData.get("favoriteBastion"),
  });

  if (!result.ok) {
    return { error: t(result.errorKey) };
  }

  const v = result.value;
  const now = new Date();

  const playstyleData = {
    versions: JSON.stringify(v.versions),
    categories: JSON.stringify(v.categories),
    mainVersion: v.mainVersion,
    mainCategory: v.mainCategory,
    hotbarSwitching: v.hotbarSwitching,
    searchCraft: v.searchCraft,
    halfShift: v.halfShift,
    itemLayoutPolicy: v.itemLayoutPolicy,
    clickMethods: JSON.stringify(v.clickMethods),
    dragTapeType: v.dragTapeType,
    usesMousepad: v.usesMousepad,
    mousepadType: v.mousepadType,
    zeroCycle: v.zeroCycle,
    groundZero: v.groundZero,
    oneshot: v.oneshot,
    favoriteBastion: v.favoriteBastion,
    updatedAt: now,
  };

  // playstyles と users の2回の書き込みは1トランザクションにする（片方だけ書かれた状態を残さない）。
  // 失敗は { error } で返す（throw すると ErrorBoundary に落ちて、入力中の下書きが消える）
  try {
    await db.transaction(async (tx) => {
      await tx
        .insert(playstyles)
        .values({ id: createId(), userId: user.id, ...playstyleData, createdAt: now })
        .onConflictDoUpdate({ target: playstyles.userId, set: playstyleData });

      // users は1回の update に集約（inputMethod + メインバージョンがあればエディションも更新）。
      // mainVersion 未設定（""）の場合は mainEdition を触らない（クリア手段は現状なし。仕様どおり）
      await tx
        .update(users)
        .set({
          inputMethod,
          ...(v.mainVersion ? { mainEdition: editionOfVersion(v.mainVersion) } : {}),
          updatedAt: now,
        })
        .where(eq(users.id, user.id));
    });
  } catch (e) {
    console.error("Playstyle save error:", e);
    return { error: t("mePlaystyle.saveFailed") };
  }

  return { success: true };
}

type PlaystyleFormValues = {
  versions: VersionKey[];
  categories: CategoryKey[];
  mainVersion: VersionKey | "";
  mainCategory: CategoryKey | "";
  inputMethod: "" | "keyboard_mouse" | "controller" | "touch";
  hotbarSwitching: HotbarSwitching | "";
  searchCraft: SearchCraftLevel | "";
  halfShift: FrequencyLevel | "";
  itemLayoutPolicy: ItemLayoutPolicy | "";
  clickMethods: ClickMethod[];
  dragTapeType: string;
  usesMousepad: UsesMousepad | "";
  mousepadType: string;
  zeroCycle: FrequencyLevel | "";
  groundZero: CanCannot | "";
  oneshot: CanCannot | "";
  favoriteBastion: BastionType | "";
};

const { java: JAVA_VERSION_KEYS, bedrock: BEDROCK_VERSION_KEYS } = groupVersionsByEdition(ALL_VERSION_KEYS);

/** 選択トグル。常に canonical な順序（order）に正規化して返す（サーバー側の正規化と揃える） */
function toggleInOrder<T extends string>(current: readonly T[], value: T, order: readonly T[]): T[] {
  const next = new Set(current);
  if (next.has(value)) {
    next.delete(value);
  } else {
    next.add(value);
  }
  return order.filter((v) => next.has(v));
}

/**
 * `{ label, Select, options.map(SelectItem) }` の定型を1つにまとめたローカルコンポーネント。
 * value/onChange は呼び出し側（formValues/handleChange）から明示的に渡す。PlaystylePage の
 * 内側にネストして定義すると、フォーム内の他の入力での再レンダーのたびに新しい関数コンポーネント
 * として扱われて Select が再マウントされてしまう（開いているドロップダウンが閉じる等）ため、
 * モジュールスコープの関数として定義する。
 */
function PlaystyleSelectField<T extends string>({
  field,
  labelKey,
  options,
  value,
  onChange,
  className = "w-full",
  children,
}: {
  field: string;
  labelKey: PlaystyleLabelKey;
  options: readonly { value: T; labelKey: PlaystyleLabelKey }[];
  value: T | "";
  onChange: (value: T) => void;
  className?: string;
  children?: ReactNode;
}) {
  const t = useT();
  return (
    <div className="space-y-2">
      <Label htmlFor={field}>{t(labelKey)}</Label>
      <Select value={value} onValueChange={(v) => onChange(v as T)}>
        <SelectTrigger id={field} className={cn("data-[size=default]:max-sm:h-11", className)}>
          {/* Radix の SelectValue は SSR で選択中の項目の文字を描けないため、今の値の表示文字を明示して渡す */}
          <SelectValue placeholder={t("mePlaystyle.select")}>
            {value ? (() => {
              const selected = options.find((opt) => opt.value === value);
              return selected ? t(selected.labelKey) : undefined;
            })() : undefined}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {t(opt.labelKey)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {children}
    </div>
  );
}

export default function PlaystylePage() {
  const t = useT();
  const loaderData = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const prevDataRef = useRef<typeof fetcher.data>(undefined);

  // 保存後の再取得が終わるまでを保存中に含める（保存バーの「未保存」のちらつき防止）
  const isSubmitting = fetcher.state !== "idle";

  const sourceFormValues = useMemo(
    (): PlaystyleFormValues => ({
      versions: loaderData.versions,
      categories: loaderData.categories,
      mainVersion: loaderData.mainVersion ?? "",
      mainCategory: loaderData.mainCategory ?? "",
      inputMethod: loaderData.inputMethod,
      hotbarSwitching: loaderData.hotbarSwitching ?? "",
      searchCraft: loaderData.searchCraft ?? "",
      halfShift: loaderData.halfShift ?? "",
      itemLayoutPolicy: loaderData.itemLayoutPolicy ?? "",
      clickMethods: loaderData.clickMethods,
      dragTapeType: loaderData.dragTapeType,
      usesMousepad: loaderData.usesMousepad ?? "",
      mousepadType: loaderData.mousepadType,
      zeroCycle: loaderData.zeroCycle ?? "",
      groundZero: loaderData.groundZero ?? "",
      oneshot: loaderData.oneshot ?? "",
      favoriteBastion: loaderData.favoriteBastion ?? "",
    }),
    [loaderData],
  );

  // loader の値が変わったとき（保存後・タブ復帰の再検証）は、未変更の間だけ新しい値へ置き換える。
  // 保存が失敗して再検証されても、入力中の下書きは消さない
  const {
    draft: formValues,
    setDraft: setFormValues,
    base: initialFormValues,
  } = useLoaderSyncedDraft(sourceFormValues, {
    // 成功した保存の結果。次の loader 更新では編集済みでも保存値（サーバーで正規化された値）へ揃える。
    // 失敗（error）の結果は null なので、下書きを残す
    syncToken: successfulSaveToken(fetcher.data),
  });

  const hasChanges = JSON.stringify(formValues) !== JSON.stringify(initialFormValues);

  const handleChange = useCallback(
    <K extends keyof PlaystyleFormValues>(field: K, value: PlaystyleFormValues[K]) => {
      setFormValues((prev) => ({ ...prev, [field]: value }));
    },
    [setFormValues],
  );

  const handleToggleVersion = useCallback((key: VersionKey) => {
    setFormValues((prev) => {
      const versions = toggleInOrder(prev.versions, key, ALL_VERSION_KEYS);
      const mainVersion: VersionKey | "" = versions.includes(prev.mainVersion as VersionKey)
        ? prev.mainVersion
        : "";
      return { ...prev, versions, mainVersion };
    });
  }, [setFormValues]);

  const handleToggleCategory = useCallback((key: CategoryKey) => {
    setFormValues((prev) => {
      const categories = toggleInOrder(prev.categories, key, CATEGORY_KEYS);
      const mainCategory: CategoryKey | "" = categories.includes(prev.mainCategory as CategoryKey)
        ? prev.mainCategory
        : "";
      return { ...prev, categories, mainCategory };
    });
  }, [setFormValues]);

  const handleToggleClickMethod = useCallback((key: ClickMethod) => {
    setFormValues((prev) => ({
      ...prev,
      clickMethods: toggleInOrder(prev.clickMethods, key, CLICK_METHOD_KEYS),
    }));
  }, [setFormValues]);

  const handleReset = useCallback(() => {
    setFormValues(initialFormValues);
  }, [initialFormValues, setFormValues]);

  const handleSave = useCallback(() => {
    const formData = new FormData();
    for (const [key, value] of Object.entries(formValues)) {
      if (Array.isArray(value)) {
        value.forEach((v) => formData.append(key, v));
      } else {
        formData.set(key, value);
      }
    }
    fetcher.submit(formData, { method: "post" });
  }, [fetcher, formValues]);

  useEffect(() => {
    const data = fetcher.data;
    if (!data || data === prevDataRef.current) return;
    prevDataRef.current = data;

    if ("success" in data && data.success) {
      toast.success(t("mePlaystyle.saveSuccess"));
    } else if ("error" in data) {
      toast.error(data.error);
    }
  }, [fetcher.data, t]);

  const showKbmFields = isKbmPlaystyle(formValues.inputMethod);
  const showJavaRsgRankedFields = playsJavaRsgOrRanked(formValues.versions, formValues.categories);
  const showBastionField = hasBastionVersions(formValues.versions);

  return (
    <div className="space-y-7 pb-24 sm:space-y-8">
      <div>
        <h1 className="text-2xl font-bold">{t("mePlaystyle.pageTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("mePlaystyle.pageDescription")}</p>
      </div>

      {/* プレイ内容 */}
      <PageSection
        id="playstyle-content"
        first
        icon={<Layers className="h-5 w-5 text-primary" aria-hidden="true" />}
        title={t("mePlaystyle.sectionPlayContent")}
        className="space-y-6"
      >
          <fieldset className="space-y-3 min-w-0">
            <legend className="mb-3 text-sm font-medium leading-none">{t("mePlaystyle.versions")}</legend>
            {(
              [
                ["Java", JAVA_VERSION_KEYS],
                ["Bedrock", BEDROCK_VERSION_KEYS],
              ] as const
            ).map(([editionLabel, keys]) => (
              <div key={editionLabel} className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">{editionLabel}</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {keys.map((key) => (
                    <label
                      key={key}
                      className="flex min-h-11 items-center gap-2 rounded-md border px-3 py-2 text-sm cursor-pointer hover:bg-muted/50 sm:min-h-0"
                    >
                      <Checkbox
                        checked={formValues.versions.includes(key)}
                        onCheckedChange={() => handleToggleVersion(key)}
                      />
                      {versionLabel(key)}
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </fieldset>

          <div className="space-y-2">
            <Label htmlFor="mainVersion">{t("mePlaystyle.mainVersion")}</Label>
            <Select
              value={formValues.mainVersion}
              onValueChange={(value) => handleChange("mainVersion", value as VersionKey)}
              disabled={formValues.versions.length === 0}
            >
              <SelectTrigger id="mainVersion" className="w-full data-[size=default]:max-sm:h-11 sm:w-72">
                <SelectValue
                  placeholder={
                    formValues.versions.length === 0
                      ? t("mePlaystyle.selectVersionsFirst")
                      : t("mePlaystyle.select")
                  }
                >
                  {formValues.mainVersion
                    ? `${editionOfVersion(formValues.mainVersion) === "java" ? "Java" : "Bedrock"} ${versionLabel(formValues.mainVersion)}`
                    : undefined}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {formValues.versions.map((v) => (
                  <SelectItem key={v} value={v}>
                    {editionOfVersion(v) === "java" ? "Java" : "Bedrock"} {versionLabel(v)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label id="categories-label">{t("mePlaystyle.categories")}</Label>
            <div role="group" aria-labelledby="categories-label" className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {CATEGORIES.map((cat) => (
                <label
                  key={cat.value}
                  className="flex min-h-11 items-center gap-2 rounded-md border px-3 py-2 text-sm cursor-pointer hover:bg-muted/50 sm:min-h-0"
                >
                  <Checkbox
                    checked={formValues.categories.includes(cat.value)}
                    onCheckedChange={() => handleToggleCategory(cat.value)}
                  />
                  {categoryLabel(t, cat.value)}
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="mainCategory">{t("mePlaystyle.mainCategory")}</Label>
            <Select
              value={formValues.mainCategory}
              onValueChange={(value) => handleChange("mainCategory", value as CategoryKey)}
              disabled={formValues.categories.length === 0}
            >
              <SelectTrigger id="mainCategory" className="w-full data-[size=default]:max-sm:h-11 sm:w-72">
                <SelectValue
                  placeholder={
                    formValues.categories.length === 0
                      ? t("mePlaystyle.selectCategoriesFirst")
                      : t("mePlaystyle.select")
                  }
                >
                  {formValues.mainCategory ? categoryLabel(t, formValues.mainCategory) : undefined}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {formValues.categories.map((c) => (
                  <SelectItem key={c} value={c}>
                    {categoryLabel(t, c)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
      </PageSection>

      {/* 操作 */}
      <PageSection
        id="playstyle-controls"
        icon={<SlidersHorizontal className="h-5 w-5 text-primary" aria-hidden="true" />}
        title={t("mePlaystyle.sectionControls")}
        className="space-y-6"
      >
          <div className="space-y-2">
            <Label htmlFor="inputMethod">{t("mePlaystyle.inputMethod")}</Label>
            <Select
              value={formValues.inputMethod}
              onValueChange={(value) =>
                handleChange("inputMethod", value as PlaystyleFormValues["inputMethod"])
              }
            >
              <SelectTrigger id="inputMethod" className="w-full data-[size=default]:max-sm:h-11 sm:w-72">
                <SelectValue placeholder={t("mePlaystyle.select")}>
                  {formValues.inputMethod === "keyboard_mouse"
                    ? t("mePlaystyle.inputMethodKeyboardMouse")
                    : formValues.inputMethod === "controller"
                      ? t("mePlaystyle.inputMethodController")
                      : formValues.inputMethod === "touch"
                        ? t("mePlaystyle.inputMethodTouch")
                        : undefined}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="keyboard_mouse">{t("mePlaystyle.inputMethodKeyboardMouse")}</SelectItem>
                <SelectItem value="controller">{t("mePlaystyle.inputMethodController")}</SelectItem>
                <SelectItem value="touch">{t("mePlaystyle.inputMethodTouch")}</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {t("mePlaystyle.inputMethodHintBefore")}
              <Link to="/me/keybindings" className="text-primary underline underline-offset-2">
                {t("meLayout.keybindings")}
              </Link>
              {" / "}
              <Link to="/me/devices" className="text-primary underline underline-offset-2">
                {t("meLayout.devices")}
              </Link>
              {t("mePlaystyle.inputMethodHintAfter")}
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <PlaystyleSelectField
              field="hotbarSwitching"
              labelKey="mePlaystyle.hotbarSwitching"
              options={HOTBAR_SWITCHING_OPTIONS}
              value={formValues.hotbarSwitching}
              onChange={(value) => handleChange("hotbarSwitching", value)}
            />

            <PlaystyleSelectField
              field="halfShift"
              labelKey="mePlaystyle.halfShift"
              options={FREQUENCY_OPTIONS}
              value={formValues.halfShift}
              onChange={(value) => handleChange("halfShift", value)}
            />
          </div>

          {showKbmFields && (
            <>
              <div className="space-y-2">
                <Label id="click-methods-label">{t("mePlaystyle.clickMethods")}</Label>
                <div role="group" aria-labelledby="click-methods-label" className="flex flex-wrap gap-x-4 gap-y-1">
                  {CLICK_METHOD_OPTIONS.map((opt) => (
                    <label key={opt.value} className="flex min-h-11 items-center gap-2 text-sm cursor-pointer sm:min-h-8">
                      <Checkbox
                        checked={formValues.clickMethods.includes(opt.value)}
                        onCheckedChange={() => handleToggleClickMethod(opt.value)}
                      />
                      {t(opt.labelKey)}
                    </label>
                  ))}
                </div>
                {formValues.clickMethods.includes("drag") && (
                  <div className="space-y-2 pt-1">
                    <Label htmlFor="dragTapeType">{t("mePlaystyle.dragTapeType")}</Label>
                    <Input
                      id="dragTapeType"
                      value={formValues.dragTapeType}
                      onChange={(e) => handleChange("dragTapeType", e.target.value)}
                      placeholder={t("mePlaystyle.dragTapeTypePlaceholder")}
                      maxLength={100}
                      className="sm:max-w-sm"
                    />
                  </div>
                )}
              </div>

              <PlaystyleSelectField
                field="usesMousepad"
                labelKey="mePlaystyle.usesMousepad"
                options={USES_MOUSEPAD_OPTIONS}
                value={formValues.usesMousepad}
                onChange={(value) => handleChange("usesMousepad", value)}
                className="w-full sm:w-72"
              >
                {formValues.usesMousepad === "uses" && (
                  <div className="space-y-2 pt-1">
                    <Label htmlFor="mousepadType">{t("mePlaystyle.mousepadType")}</Label>
                    <Input
                      id="mousepadType"
                      value={formValues.mousepadType}
                      onChange={(e) => handleChange("mousepadType", e.target.value)}
                      placeholder={t("mePlaystyle.mousepadTypePlaceholder")}
                      maxLength={100}
                      className="sm:max-w-sm"
                    />
                  </div>
                )}
              </PlaystyleSelectField>
            </>
          )}
      </PageSection>

      {/* テクニック */}
      <PageSection
        id="playstyle-technique"
        icon={<Sparkles className="h-5 w-5 text-primary" aria-hidden="true" />}
        title={t("mePlaystyle.sectionTechnique")}
        className="space-y-6"
      >
          <PlaystyleSelectField
            field="itemLayoutPolicy"
            labelKey="mePlaystyle.itemLayoutPolicy"
            options={ITEM_LAYOUT_POLICY_OPTIONS}
            value={formValues.itemLayoutPolicy}
            onChange={(value) => handleChange("itemLayoutPolicy", value)}
            className="w-full sm:w-72"
          />

          <PlaystyleSelectField
            field="searchCraft"
            labelKey="mePlaystyle.searchCraft"
            options={SEARCH_CRAFT_OPTIONS}
            value={formValues.searchCraft}
            onChange={(value) => handleChange("searchCraft", value)}
            className="w-full sm:w-72"
          >
            <p className="text-xs text-muted-foreground">{t("mePlaystyle.searchCraftHint")}</p>
            {!hidesSearchCraft(formValues.searchCraft) && (
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <ExternalLink className="h-3 w-3 shrink-0" />
                <Link to="/me/devices" className="underline underline-offset-2">
                  {t("mePlaystyle.gameLanguageLink")}
                </Link>
              </p>
            )}
          </PlaystyleSelectField>

          {showJavaRsgRankedFields && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <PlaystyleSelectField
                field="zeroCycle"
                labelKey="mePlaystyle.zeroCycle"
                options={FREQUENCY_OPTIONS}
                value={formValues.zeroCycle}
                onChange={(value) => handleChange("zeroCycle", value)}
              />
              <PlaystyleSelectField
                field="groundZero"
                labelKey="mePlaystyle.groundZero"
                options={CAN_CANNOT_OPTIONS}
                value={formValues.groundZero}
                onChange={(value) => handleChange("groundZero", value)}
              />
              <PlaystyleSelectField
                field="oneshot"
                labelKey="mePlaystyle.oneshot"
                options={CAN_CANNOT_OPTIONS}
                value={formValues.oneshot}
                onChange={(value) => handleChange("oneshot", value)}
              />
            </div>
          )}

          {showBastionField && (
            <PlaystyleSelectField
              field="favoriteBastion"
              labelKey="mePlaystyle.favoriteBastion"
              options={BASTION_OPTIONS}
              value={formValues.favoriteBastion}
              onChange={(value) => handleChange("favoriteBastion", value)}
              className="w-full sm:w-72"
            />
          )}
      </PageSection>

      <FloatingSaveBar
        hasChanges={hasChanges}
        isSubmitting={isSubmitting}
        saveResult={fetcher.data}
        saveSucceeded={fetcher.data != null && "success" in fetcher.data && fetcher.data.success === true}
        onSave={handleSave}
        onReset={handleReset}
      />
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
            <h2 className="text-2xl font-bold">{t("mePlaystyle.errorTitle")}</h2>
            <p className="text-muted-foreground">{t("mePlaystyle.errorDescription")}</p>
            <Button onClick={() => window.location.reload()}>{t("mePlaystyle.reloadPage")}</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
