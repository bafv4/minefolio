import { createTranslator, type Translator } from "@/lib/messages";
import { localeFromMatches, resolveLocale } from "@/lib/locale";
import { useLoaderData, useFetcher, type ShouldRevalidateFunctionArgs } from "react-router";
import type { Route } from "./+types/records";
import { Skeleton } from "@/components/ui/skeleton";
import { createDb, isUniqueConstraintError } from "@/lib/db";
import { createAuth } from "@/lib/auth";
import { getSession } from "@/lib/session";
import { getEnv } from "@/lib/env.server";
import { users, categoryRecords } from "@/lib/schema";
import { eq, and, asc } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { formatTime, parseTimeToMs } from "@/lib/time-utils";
import { fetchSpeedrunComStats, getSpeedrunComVideoEmbedUrl } from "@/lib/external-stats";
import { parseRunIdList, parseRunIdListInput, sameRunIdSet, toggleRunId } from "@/lib/run-id-list";
import { YouTubeClickEmbed } from "@/components/youtube-click-embed";
import { PinnedBadge } from "@/components/pinned-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FloatingSaveBar } from "@/components/floating-save-bar";
import { PageSection } from "@/components/page-section";
import { NoticeBanner } from "@/components/notice-banner";
import { EmptyState } from "@/components/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Switch } from "@/components/ui/switch";
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
  Trophy,
  Plus,
  Pencil,
  Trash2,
  ExternalLink,
  Undo2,
  AlertCircle,
  Eye,
  EyeOff,
  Pin,
} from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useT } from "@/hooks/use-locale";
import { isHttpUrl } from "@/lib/safe-url";
import { PROFILE_FIELD_LIMITS } from "@/lib/profile-edit-validation";
import { categoryLabel, type CategoryKey } from "@/lib/playstyle";
import { RECORD_CATEGORY_KEYS, resolveRecordCategory, splitRecordCategory } from "@/lib/record-category";

export const meta: Route.MetaFunction = ({ matches }) => {
  const t = createTranslator(localeFromMatches(matches));
  return [{ title: t("meRecords.title") }];
};

// 再検証を制御：actionの結果に応じてのみ再検証
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
    with: {
      categoryRecords: {
        orderBy: [asc(categoryRecords.displayOrder)],
      },
    },
  });

  if (!user) {
    throw new Response(t("meRecords.userNotFound"), { status: 404 });
  }

  // Speedrun.com記録を取得（ユーザー名が設定されている場合のみ）
  let speedruncomRecords: Awaited<ReturnType<typeof fetchSpeedrunComStats>> | null = null;
  if (user.speedruncomUsername) {
    try {
      speedruncomRecords = await fetchSpeedrunComStats(user.speedruncomUsername);
    } catch (error) {
      console.error("Failed to fetch Speedrun.com records:", error);
    }
  }

  // 非表示・ピン留め記録IDをパース
  const hiddenSpeedrunRecords = parseRunIdList(user.hiddenSpeedrunRecords);
  const pinnedSpeedrunRecords = parseRunIdList(user.pinnedSpeedrunRecords);

  return {
    user,
    records: user.categoryRecords,
    speedruncomRecords,
    hiddenSpeedrunRecords,
    pinnedSpeedrunRecords,
    speedruncomUsername: user.speedruncomUsername,
  };
}

// ローディング中に表示するスケルトンUI（ナビゲーション時用）
export function HydrateFallback() {
  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <Skeleton className="h-8 w-24 mb-2" />
          <Skeleton className="h-4 w-64" />
        </div>
        <Skeleton className="h-11 sm:h-10 w-full sm:w-32" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-lg border bg-card p-6 space-y-4">
            <div className="flex items-start justify-between">
              <div className="space-y-2">
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-4 w-24" />
              </div>
              <div className="flex gap-1">
                <Skeleton className="h-8 w-8" />
                <Skeleton className="h-8 w-8" />
              </div>
            </div>
            <Skeleton className="h-8 w-28" />
            <div className="flex gap-2">
              <Skeleton className="h-6 w-16" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** 登録できるカスタム記録の上限 */
const MAX_CUSTOM_RECORDS = 50;

/** 保存で受け取るカスタム記録の変更1件（新規は id が null、削除は delete が true） */
type RecordOp = {
  id: string | null;
  delete: boolean;
  category: string;
  categoryDisplayName: string;
  personalBest: number | null;
  pbVideoUrl: string | null;
  isVisible: boolean;
  isPinned: boolean;
};

/** 変更一覧の JSON を検証する。形が不正（型・件数・id の重複など）なら null。値の検証エラーは error で返す */
function parseRecordOps(raw: unknown, t: Translator): { ops: RecordOp[] } | { error: string } | null {
  if (typeof raw !== "string") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length > MAX_CUSTOM_RECORDS * 2) return null;

  const ops: RecordOp[] = [];
  const seenIds = new Set<string>();
  for (const item of parsed) {
    if (typeof item !== "object" || item === null) return null;
    const o = item as Record<string, unknown>;
    if (o.id !== null && typeof o.id !== "string") return null;
    if (typeof o.delete !== "boolean") return null;
    if (o.id !== null) {
      if (seenIds.has(o.id)) return null;
      seenIds.add(o.id);
    }
    if (o.delete) {
      if (o.id === null) return null;
      ops.push({
        id: o.id,
        delete: true,
        category: "",
        categoryDisplayName: "",
        personalBest: null,
        pbVideoUrl: null,
        isVisible: true,
        isPinned: false,
      });
      continue;
    }
    if (typeof o.category !== "string" || typeof o.categoryDisplayName !== "string") return null;
    if (typeof o.isVisible !== "boolean" || typeof o.isPinned !== "boolean") return null;
    if (
      o.personalBest !== null &&
      !(typeof o.personalBest === "number" && Number.isSafeInteger(o.personalBest) && o.personalBest > 0)
    ) {
      return { error: t("meRecords.invalidTime") };
    }
    if (o.pbVideoUrl !== null && typeof o.pbVideoUrl !== "string") return null;
    const category = o.category.trim();
    const categoryDisplayName = o.categoryDisplayName.trim();
    const pbVideoUrl = typeof o.pbVideoUrl === "string" ? o.pbVideoUrl.trim() || null : null;
    if (!category || !categoryDisplayName) return { error: t("meRecords.categoryRequired") };
    if (category.length > 100 || categoryDisplayName.length > 100) return { error: t("meRecords.categoryTooLong") };
    if (pbVideoUrl && !isHttpUrl(pbVideoUrl)) return { error: t("meRecords.invalidVideoUrl") };
    if (pbVideoUrl && pbVideoUrl.length > PROFILE_FIELD_LIMITS.recordVideoUrl) return { error: t("meRecords.videoUrlTooLong") };
    ops.push({
      id: o.id,
      delete: false,
      category,
      categoryDisplayName,
      personalBest: o.personalBest,
      pbVideoUrl,
      isVisible: o.isVisible,
      isPinned: o.isPinned,
    });
  }
  return { ops };
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
    return { error: t("meRecords.userNotFound") };
  }

  const formData = await request.formData();
  const action = formData.get("_action") as string;

  // 画面の下書き（Speedrun.com 記録の非表示・ピン留め＋カスタム記録の追加・編集・削除）を1回でまとめて保存する。
  // 検証はすべて書き込みの前に行い、書き込みは1つのトランザクションにして、途中まで書かれた状態を残さない
  if (action === "saveRecords") {
    const hidden = parseRunIdListInput(formData.get("hidden"));
    const pinned = parseRunIdListInput(formData.get("pinned"));
    const parsedOps = parseRecordOps(formData.get("records"), t);
    if (!hidden || !pinned || !parsedOps) {
      return { error: t("meRecords.invalidAction") };
    }
    if ("error" in parsedOps) {
      return { error: parsedOps.error };
    }
    const { ops } = parsedOps;

    // 変更対象の id はすべて本人の記録でなければならない（他人の id が混ざっていたら何も書かない）
    const existing = await db
      .select({ id: categoryRecords.id, category: categoryRecords.category })
      .from(categoryRecords)
      .where(eq(categoryRecords.userId, user.id));
    const existingById = new Map(existing.map((r) => [r.id, r.category]));
    if (ops.some((op) => op.id !== null && !existingById.has(op.id))) {
      return { error: t("meRecords.invalidAction") };
    }

    // 保存後の状態で、カテゴリの重複と件数の上限を確認する
    const finalCategories = new Map(existingById);
    for (const op of ops) {
      if (op.id !== null && op.delete) finalCategories.delete(op.id);
    }
    for (const op of ops) {
      if (op.id !== null && !op.delete) finalCategories.set(op.id, op.category);
    }
    let newIndex = 0;
    for (const op of ops) {
      if (op.id === null) finalCategories.set(`new-${newIndex++}`, op.category);
    }
    if (finalCategories.size > MAX_CUSTOM_RECORDS) {
      return { error: t("meRecords.errorLimitReached") };
    }
    if (new Set(finalCategories.values()).size !== finalCategories.size) {
      return { error: t("meRecords.categoryDuplicate") };
    }

    // 非表示は露出を減らす操作なので updatedAt（ホームの「最近の更新」等）は進めない。ピン留めが変わったときだけ進める
    const pinnedChanged = !sameRunIdSet(parseRunIdList(user.pinnedSpeedrunRecords), pinned);
    try {
      await db.transaction(async (tx) => {
        // 一意制約に一時的に触れないよう、削除 → 更新 → 追加の順に書く
        for (const op of ops) {
          if (op.id !== null && op.delete) {
            await tx
              .delete(categoryRecords)
              .where(and(eq(categoryRecords.id, op.id), eq(categoryRecords.userId, user.id)));
          }
        }
        for (const op of ops) {
          if (op.id !== null && !op.delete) {
            await tx
              .update(categoryRecords)
              .set({
                category: op.category,
                categoryDisplayName: op.categoryDisplayName,
                personalBest: op.personalBest,
                pbVideoUrl: op.pbVideoUrl,
                isVisible: op.isVisible,
                isPinned: op.isPinned,
                updatedAt: new Date(),
              })
              .where(and(eq(categoryRecords.id, op.id), eq(categoryRecords.userId, user.id)));
          }
        }
        for (const op of ops) {
          if (op.id === null) {
            await tx.insert(categoryRecords).values({
              id: createId(),
              userId: user.id,
              category: op.category,
              categoryDisplayName: op.categoryDisplayName,
              recordType: "custom",
              personalBest: op.personalBest,
              pbVideoUrl: op.pbVideoUrl,
              isVisible: op.isVisible,
              isPinned: op.isPinned,
            });
          }
        }
        await tx
          .update(users)
          .set({
            hiddenSpeedrunRecords: JSON.stringify(hidden),
            pinnedSpeedrunRecords: JSON.stringify(pinned),
            ...(pinnedChanged ? { updatedAt: new Date() } : {}),
          })
          .where(eq(users.id, user.id));
      });
    } catch (e) {
      // 事前確認をすり抜けた並行リクエストとの競合（(userId, category, recordType) の一意制約）
      if (isUniqueConstraintError(e)) {
        return { error: t("meRecords.categoryDuplicate") };
      }
      throw e;
    }

    return { success: true };
  }

  return { error: t("meRecords.invalidAction") };
}

/** 画面で編集中のカスタム記録（key は画面内の識別子。保存済みは id、追加分は new-N） */
type DraftRecord = {
  key: string;
  id: string | null;
  category: string;
  categoryDisplayName: string;
  personalBest: number | null;
  pbVideoUrl: string | null;
  isVisible: boolean;
  isPinned: boolean;
  deleted: boolean;
};

/** 下書きの内容の比較用キー（key は画面内の識別子なので含めない） */
function draftComparable(d: DraftRecord): string {
  return JSON.stringify([d.id, d.category, d.categoryDisplayName, d.personalBest, d.pbVideoUrl, d.isVisible, d.isPinned, d.deleted]);
}

function toDrafts(
  records: {
    id: string;
    category: string;
    categoryDisplayName: string;
    personalBest: number | null;
    pbVideoUrl: string | null;
    isVisible: boolean;
    isPinned: boolean;
  }[],
): DraftRecord[] {
  return records.map((r) => ({
    key: r.id,
    id: r.id,
    category: r.category,
    categoryDisplayName: r.categoryDisplayName,
    personalBest: r.personalBest,
    pbVideoUrl: r.pbVideoUrl,
    isVisible: r.isVisible,
    isPinned: r.isPinned,
    deleted: false,
  }));
}

export default function RecordsPage() {
  const t = useT();
  const {
    records,
    speedruncomRecords,
    hiddenSpeedrunRecords: savedHidden,
    pinnedSpeedrunRecords: savedPinned,
    speedruncomUsername,
  } = useLoaderData<typeof loader>();
  const saveFetcher = useFetcher<typeof action>();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [categoryKey, setCategoryKey] = useState<CategoryKey>("rsg");
  const [categorySuffix, setCategorySuffix] = useState("");
  // Speedrun.com 記録の非表示・ピン留めと、カスタム記録の追加・編集・削除は、すべて下書きで持ち、FloatingSaveBar でまとめて保存する
  const [draftHidden, setDraftHidden] = useState<string[]>(savedHidden);
  const [draftPinned, setDraftPinned] = useState<string[]>(savedPinned);
  const savedDrafts = toDrafts(records);
  const [draftRecords, setDraftRecords] = useState<DraftRecord[]>(savedDrafts);
  const newKeyCounter = useRef(0);

  const isSaving = saveFetcher.state !== "idle";
  const editing = editingKey ? (draftRecords.find((d) => d.key === editingKey) ?? null) : null;

  // 保存済みの内容が変わったとき（保存の完了・再検証で中身が変わったとき）だけ下書きを取り直す。
  // 配列の参照ではなく内容で比べる（そうしないと、未保存の下書きが再検証の度に消える）
  const savedKey = JSON.stringify([
    [...savedHidden].sort(),
    [...savedPinned].sort(),
    savedDrafts.map(draftComparable),
  ]);
  useEffect(() => {
    setDraftHidden(savedHidden);
    setDraftPinned(savedPinned);
    setDraftRecords(toDrafts(records));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKey]);

  const recordsDirty =
    JSON.stringify(draftRecords.map(draftComparable)) !== JSON.stringify(savedDrafts.map(draftComparable));
  const flagsDirty = !sameRunIdSet(draftHidden, savedHidden) || !sameRunIdSet(draftPinned, savedPinned);
  const hasChanges = flagsDirty || recordsDirty;

  const saveResult = saveFetcher.data;
  const handledSaveResult = useRef<typeof saveResult>(undefined);
  useEffect(() => {
    if (!saveResult || saveResult === handledSaveResult.current) return;
    handledSaveResult.current = saveResult;
    if ("success" in saveResult && saveResult.success) {
      toast.success(t("meRecords.saveSuccess"));
    } else {
      toast.error("error" in saveResult ? saveResult.error : t("meRecords.saveFailed"));
    }
  }, [saveResult, t]);

  const handleSave = () => {
    // 変わった記録（追加・編集・削除予定）だけを送る
    const savedByKey = new Map(savedDrafts.map((d) => [d.key, draftComparable(d)]));
    const ops: RecordOp[] = draftRecords
      .filter((d) => d.id === null || savedByKey.get(d.key) !== draftComparable(d))
      .map((d) => ({
        id: d.id,
        delete: d.deleted,
        category: d.category,
        categoryDisplayName: d.categoryDisplayName,
        personalBest: d.personalBest,
        pbVideoUrl: d.pbVideoUrl,
        isVisible: d.isVisible,
        isPinned: d.isPinned,
      }));
    saveFetcher.submit(
      {
        _action: "saveRecords",
        hidden: JSON.stringify(draftHidden),
        pinned: JSON.stringify(draftPinned),
        records: JSON.stringify(ops),
      },
      { method: "post" },
    );
  };

  const handleReset = () => {
    setDraftHidden(savedHidden);
    setDraftPinned(savedPinned);
    setDraftRecords(toDrafts(records));
  };

  const handleOpenCreate = () => {
    setEditingKey(null);
    setCategoryKey("rsg");
    setCategorySuffix("");
    setDialogError(null);
    setIsDialogOpen(true);
  };

  const handleOpenEdit = (record: DraftRecord) => {
    const { key, suffix } = splitRecordCategory(record.category);
    setEditingKey(record.key);
    setCategoryKey(key);
    setCategorySuffix(suffix);
    setDialogError(null);
    setIsDialogOpen(true);
  };

  // ダイアログの「この画面に反映」。DB には書かず、下書きに積むだけ（確定は FloatingSaveBar の保存）
  const handleApply = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const category = resolveRecordCategory(editing?.category ?? null, categoryKey, categorySuffix).trim();
    const categoryDisplayName = String(fd.get("categoryDisplayName") ?? "").trim();
    const personalBestStr = String(fd.get("personalBest") ?? "").trim();
    const pbVideoUrl = String(fd.get("pbVideoUrl") ?? "").trim() || null;

    if (!category || !categoryDisplayName) return setDialogError(t("meRecords.categoryRequired"));
    if (category.length > 100 || categoryDisplayName.length > 100) return setDialogError(t("meRecords.categoryTooLong"));
    const personalBest = personalBestStr ? parseTimeToMs(personalBestStr) : null;
    if (personalBestStr && personalBest === null) return setDialogError(t("meRecords.invalidTime"));
    if (pbVideoUrl && !isHttpUrl(pbVideoUrl)) return setDialogError(t("meRecords.invalidVideoUrl"));
    if (pbVideoUrl && pbVideoUrl.length > PROFILE_FIELD_LIMITS.recordVideoUrl) return setDialogError(t("meRecords.videoUrlTooLong"));
    const alive = draftRecords.filter((d) => !d.deleted && d.key !== editingKey);
    if (alive.some((d) => d.category === category)) return setDialogError(t("meRecords.categoryDuplicate"));
    if (!editing && alive.length >= MAX_CUSTOM_RECORDS) return setDialogError(t("meRecords.errorLimitReached"));

    const fields = {
      category,
      categoryDisplayName,
      personalBest,
      pbVideoUrl,
      isVisible: fd.get("isVisible") === "true",
      isPinned: fd.get("isPinned") === "true",
    };
    if (editing) {
      setDraftRecords((prev) => prev.map((d) => (d.key === editing.key ? { ...d, ...fields } : d)));
    } else {
      const key = `new-${newKeyCounter.current++}`;
      setDraftRecords((prev) => [...prev, { key, id: null, deleted: false, ...fields }]);
    }
    setIsDialogOpen(false);
  };

  // 削除は下書きの上で「削除予定」にする（追加したばかりの記録は一覧から外す）。保存するまで DB は変わらず、元に戻せる
  const handleMarkDelete = (record: DraftRecord) => {
    setDraftRecords((prev) =>
      record.id === null
        ? prev.filter((d) => d.key !== record.key)
        : prev.map((d) => (d.key === record.key ? { ...d, deleted: true } : d)),
    );
  };

  const handleUndoDelete = (record: DraftRecord) => {
    setDraftRecords((prev) => prev.map((d) => (d.key === record.key ? { ...d, deleted: false } : d)));
  };

  const iconButtonClass =
    "inline-flex size-11 items-center justify-center rounded transition-colors hover:bg-secondary disabled:opacity-50 sm:size-8";

  return (
    <div className="space-y-7 pb-24 sm:space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{t("meRecords.pageTitle")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("meRecords.pageDescription")}
          </p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          {/* 0件のときは、空状態の「最初の記録を追加」が導線なので、見出し側のボタンは出さない（ダイアログは開閉の状態で動く） */}
          {draftRecords.length > 0 && (
            <DialogTrigger asChild>
              <Button onClick={handleOpenCreate} disabled={isSaving} className="w-full sm:w-auto h-11 sm:h-10">
                <Plus className="mr-2 h-4 w-4" />
                {t("meRecords.addRecord")}
              </Button>
            </DialogTrigger>
          )}
          <DialogContent>
            {/* 開くたびに再マウントし、非制御入力の前回状態が持ち越されないようにする */}
            <form key={`${isDialogOpen}-${editingKey ?? "new"}`} onSubmit={handleApply}>
              <DialogHeader>
                <DialogTitle>{editing ? t("meRecords.editRecord") : t("meRecords.addRecordTitle")}</DialogTitle>
                <DialogDescription>
                  {editing ? t("meRecords.editRecordDescription") : t("meRecords.addRecordDescription")}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                {dialogError && (
                  <NoticeBanner tone="error" icon={AlertCircle}>
                    {dialogError}
                  </NoticeBanner>
                )}
                <div className="space-y-2">
                  <Label htmlFor="categoryKey">{t("meRecords.categoryKey")}</Label>
                  <Select value={categoryKey} onValueChange={(v) => setCategoryKey(v as CategoryKey)}>
                    <SelectTrigger id="categoryKey" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {RECORD_CATEGORY_KEYS.map((key) => (
                        <SelectItem key={key} value={key}>
                          {categoryLabel(t, key)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">{t("meRecords.categoryKeyHint")}</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="categorySuffix">{t("meRecords.subcategory")}</Label>
                  <Input
                    id="categorySuffix"
                    value={categorySuffix}
                    onChange={(e) => setCategorySuffix(e.target.value)}
                    placeholder={t("meRecords.subcategoryPlaceholder")}
                    maxLength={80}
                    aria-describedby="categorySuffix-hint"
                  />
                  <p id="categorySuffix-hint" className="text-xs text-muted-foreground">
                    {t("meRecords.subcategoryHint")}
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="categoryDisplayName">{t("meRecords.displayName")}</Label>
                  <Input
                    id="categoryDisplayName"
                    name="categoryDisplayName"
                    defaultValue={editing?.categoryDisplayName ?? ""}
                    placeholder={t("meRecords.displayNamePlaceholder")}
                    maxLength={100}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="personalBest">{t("meRecords.personalBest")}</Label>
                  <Input
                    id="personalBest"
                    name="personalBest"
                    defaultValue={editing?.personalBest ? formatTime(editing.personalBest) : ""}
                    placeholder={t("meRecords.personalBestPlaceholder")}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pbVideoUrl">{t("meRecords.videoUrl")}</Label>
                  <Input
                    id="pbVideoUrl"
                    name="pbVideoUrl"
                    type="url"
                    defaultValue={editing?.pbVideoUrl ?? ""}
                    placeholder="https://youtube.com/..."
                    maxLength={PROFILE_FIELD_LIMITS.recordVideoUrl}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    id="isVisible"
                    name="isVisible"
                    value="true"
                    defaultChecked={editing?.isVisible ?? true}
                  />
                  <Label htmlFor="isVisible">{t("meRecords.visible")}</Label>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Switch
                      id="isPinned"
                      name="isPinned"
                      value="true"
                      defaultChecked={editing?.isPinned ?? false}
                    />
                    <Label htmlFor="isPinned">{t("meRecords.pinned")}</Label>
                  </div>
                  <p className="text-xs text-muted-foreground">{t("meRecords.pinnedHint")}</p>
                </div>
              </div>
              <p className="pb-3 text-xs text-muted-foreground">{t("meRecords.applyNote")}</p>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                  {t("meRecords.cancel")}
                </Button>
                <Button type="submit">{t("meRecords.submitApply")}</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {saveResult && "error" in saveResult && (
        <NoticeBanner tone="error" icon={AlertCircle}>
          {saveResult.error}
        </NoticeBanner>
      )}

      {/* Speedrun.com記録セクション */}
      {speedruncomUsername && (
        <PageSection
          id="records-speedruncom"
          first
          icon={<Trophy className="h-5 w-5 text-primary" aria-hidden="true" />}
          title={t("meRecords.speedrunSectionTitle")}
        >
          <p className="text-sm text-muted-foreground">
            {t("meRecords.speedrunSectionDescription")}
          </p>
          {speedruncomRecords && !speedruncomRecords.error && speedruncomRecords.personalBests.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {speedruncomRecords.personalBests.map((pb) => {
                const isHidden = draftHidden.includes(pb.run.id);
                const isPinned = draftPinned.includes(pb.run.id);
                const videoEmbedUrl = getSpeedrunComVideoEmbedUrl(pb);
                const timeText = formatTime(pb.run.times.primary_t * 1000);
                const baseName = [pb.game?.data?.names?.international, pb.category?.data?.name]
                  .filter(Boolean)
                  .join(" ");
                // 同じカテゴリでバージョン違いの記録が並んでも、ボタンの読み上げ名で区別できるようにする
                const recordName = `${baseName} (${[pb.platformName, pb.versionName, timeText].filter(Boolean).join(" / ")})`;
                const videoLabel = pb.category?.data?.name ?? baseName;
                return (
                  <div
                    key={pb.run.id}
                    className={cn(
                      "rounded-xl bg-secondary/50 p-3 space-y-1",
                      isHidden && "opacity-50"
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex min-w-0 flex-1 items-center gap-2">
                        <h3 className="min-w-0 break-words font-medium text-sm line-clamp-2">
                          {pb.category?.data?.name ?? "Unknown"}
                          {/* 同じカテゴリでバージョン違いの記録が並ぶと見出しが同名になるので、見出しにバージョンを含める
                              （見た目のバージョンは下の行に出ているので、見出しの中は読み上げ用だけ） */}
                          {pb.versionName && <span className="sr-only"> ({pb.versionName})</span>}
                        </h3>
                        <Badge variant="outline" className="shrink-0">
                          #{pb.place}
                        </Badge>
                      </div>
                      <div className="-mr-1 -mt-1 flex shrink-0 items-center">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              onClick={() => setDraftPinned((prev) => toggleRunId(prev, pb.run.id))}
                              disabled={isSaving}
                              aria-label={t("meRecords.pinRecordLabel", { name: recordName })}
                              aria-pressed={isPinned}
                              className={iconButtonClass}
                            >
                              <Pin className={cn("h-4 w-4", isPinned ? "text-primary" : "text-muted-foreground")} />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent>
                            {isPinned ? t("meRecords.unpin") : t("meRecords.pin")}
                          </TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              onClick={() => setDraftHidden((prev) => toggleRunId(prev, pb.run.id))}
                              disabled={isSaving}
                              aria-label={t("meRecords.showRecordLabel", { name: recordName })}
                              aria-pressed={!isHidden}
                              className={iconButtonClass}
                            >
                              {isHidden ? (
                                <EyeOff className="h-4 w-4 text-muted-foreground" />
                              ) : (
                                <Eye className="h-4 w-4 text-muted-foreground" />
                              )}
                            </button>
                          </TooltipTrigger>
                          <TooltipContent>
                            {isHidden ? t("meRecords.show") : t("meRecords.hide")}
                          </TooltipContent>
                        </Tooltip>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground truncate">
                      {pb.game?.data?.names?.international ?? "Unknown Game"}
                    </p>
                    {(pb.platformName || pb.versionName) && (
                      <p className="text-xs text-muted-foreground">
                        {[pb.platformName, pb.versionName].filter(Boolean).join(" / ")}
                      </p>
                    )}
                    <p className="text-lg font-mono font-bold">{timeText}</p>
                    {videoEmbedUrl && (
                      <YouTubeClickEmbed
                        embedUrl={videoEmbedUrl}
                        title={t("playerStatsCards.videoTitle", { label: videoLabel })}
                        playLabel={t("playerStatsCards.playVideo", { label: `${videoLabel} ${timeText}` })}
                      />
                    )}
                    <div className="flex items-center gap-2 flex-wrap">
                      {isPinned && <PinnedBadge />}
                      {isHidden && (
                        <Badge variant="secondary" className="text-xs">{t("meRecords.hidden")}</Badge>
                      )}
                      {pb.run.weblink && (
                        <a
                          href={pb.run.weblink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="-mx-2 -my-3.5 flex items-center gap-1 px-2 py-3.5 text-xs text-primary hover:underline sm:-my-2 sm:py-2"
                        >
                          <ExternalLink className="h-3 w-3" />
                          {t("meRecords.viewRecord")}
                        </a>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : speedruncomRecords?.error ? (
            <p className="text-sm text-muted-foreground">{speedruncomRecords.error}</p>
          ) : speedruncomRecords && speedruncomRecords.user === null ? (
            // error なしで user が null ＝ speedrun.com にそのユーザー名が無い（ユーザー名の誤設定に気づけるようにする）
            <NoticeBanner tone="info" icon={AlertCircle}>
              {t("meRecords.speedrunUserNotFound", { username: speedruncomUsername })}
            </NoticeBanner>
          ) : (
            <EmptyState
              size="compact"
              icon={<Trophy className="h-5 w-5" />}
              title={t("meRecords.noSpeedrunRecords")}
              description={t("meRecords.noSpeedrunRecordsHint")}
            />
          )}
        </PageSection>
      )}

      {/* カスタム記録セクション */}
      <PageSection
        id="records-custom"
        icon={<Trophy className="h-5 w-5 text-primary" aria-hidden="true" />}
        title={t("meRecords.customRecords")}
        first={!speedruncomUsername}
      >
        {draftRecords.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {draftRecords.map((record) => (
              <Card key={record.key} className={cn("gap-3 py-5", record.deleted && "border-destructive/40 opacity-60")}>
                <CardHeader className="px-5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className={cn("text-base font-semibold", record.deleted && "line-through")}>
                        {record.categoryDisplayName}
                      </h3>
                      <CardDescription>{record.category}</CardDescription>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      {record.deleted ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="min-h-11 sm:min-h-8"
                          disabled={isSaving}
                          aria-label={t("meRecords.undoDeleteLabel", { name: record.categoryDisplayName })}
                          onClick={() => handleUndoDelete(record)}
                        >
                          <Undo2 className="mr-1 h-3 w-3" />
                          {t("meRecords.undoDelete")}
                        </Button>
                      ) : (
                        <>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-11 sm:size-9"
                            disabled={isSaving}
                            aria-label={t("meRecords.editRecordLabel", { name: record.categoryDisplayName })}
                            onClick={() => handleOpenEdit(record)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-11 sm:size-9"
                            disabled={isSaving}
                            aria-label={t("meRecords.deleteRecordLabel", { name: record.categoryDisplayName })}
                            onClick={() => handleMarkDelete(record)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="px-5">
                  {record.personalBest && (
                    <p className="text-2xl font-mono font-bold">
                      {formatTime(record.personalBest)}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2 mt-2">
                    {record.deleted && <Badge variant="destructive">{t("meRecords.deletePending")}</Badge>}
                    {!record.isVisible && <Badge variant="secondary">{t("meRecords.private")}</Badge>}
                    {record.isPinned && <PinnedBadge />}
                    {record.pbVideoUrl && (
                      <Button variant="outline" size="sm" asChild className="min-h-11 sm:min-h-8">
                        <a href={record.pbVideoUrl} target="_blank" rel="noopener noreferrer">
                          <ExternalLink className="mr-1 h-3 w-3" />
                          {t("meRecords.video")}
                        </a>
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <EmptyState
            size="compact"
            icon={<Trophy className="h-5 w-5" />}
            title={t("meRecords.noCustomRecords")}
            description={t("meRecords.noCustomRecordsDescription")}
            action={
              <Button onClick={handleOpenCreate} disabled={isSaving}>
                <Plus className="mr-2 h-4 w-4" />
                {t("meRecords.addFirstRecord")}
              </Button>
            }
          />
        )}
      </PageSection>

      <FloatingSaveBar
        hasChanges={hasChanges}
        isSubmitting={isSaving}
        saveResult={saveResult}
        saveSucceeded={saveResult != null && "success" in saveResult && saveResult.success === true}
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
            <h2 className="text-2xl font-bold">{t("meRecords.errorTitle")}</h2>
            <p className="text-muted-foreground">
              {t("meRecords.errorDescription")}
            </p>
            <Button onClick={() => window.location.reload()}>
              {t("meRecords.reloadPage")}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
