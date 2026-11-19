// ガイド設定モーダル（タイトル / 概要 / カバー画像 / タグ / 公開設定）。
// モーダル内はローカル State を持ち、「適用」で親 State へコミット、「キャンセル」で破棄する。
// ※ 適用は保存（下書き保存・公開）ではなく、あくまで全体 State への反映のみ。
import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { MetadataFields } from "./metadata-fields";
import { normalizeSlug, softNormalizeSlug } from "@/lib/guide-slug";
import { getPublishAction, hasDraftSave, PUBLISH_ACTION_MESSAGES } from "../hooks/use-guide-save";
import { useT } from "@/hooks/use-locale";
import { useDialogReturnFocus } from "../lib/dialog-return-focus";

export interface GuideSettingsValues {
  title: string;
  summary: string;
  tags: string[];
  coverImageUrl: string | null;
  isPublished: boolean;
  slug: string;
  allowAutoTranslation: boolean;
}

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 開いたとき「公開する」スイッチへフォーカスする（ツールバーの「公開…」から開いたとき。既定は先頭の入力） */
  focusPublishOnOpen?: boolean;
  /** モーダルを開いたときの初期値（親 State のスナップショット） */
  initialValues: GuideSettingsValues;
  /** URLプレビュー用の著者スラッグ（/guides/{authorSlug}/{slug}） */
  authorSlug: string;
  /** 自動翻訳の機能が有効か。無効なら許可スイッチを描画しない */
  translationEnabled: boolean;
  /** いま読者に公開されているか（保存済みの isPublished）。説明文のボタン名と言い方を決める */
  livePublished: boolean;
  /** カバー画像を Blob へアップロードし URL を返す（即時アップロード） */
  uploadCover: (file: File) => Promise<string | null>;
  isUploadingCover: boolean;
  uploadError: string | null;
  /** 適用: モーダル内 State を親 State へコミット（保存はしない） */
  onApply: (values: GuideSettingsValues) => void;
}

export function SettingsDialog({
  open,
  onOpenChange,
  focusPublishOnOpen = false,
  initialValues,
  authorSlug,
  translationEnabled,
  livePublished,
  uploadCover,
  isUploadingCover,
  uploadError,
  onApply,
}: SettingsDialogProps) {
  const t = useT();
  // 閉じたあと body に落ちたフォーカスを、開く前の要素かエディタへ戻す（トリガーの無いダイアログ。lib/dialog-return-focus.ts）
  const returnFocus = useDialogReturnFocus(open);
  // ── モーダル内ローカル State ──
  const [title, setTitle] = useState(initialValues.title);
  const [summary, setSummary] = useState(initialValues.summary);
  const [tags, setTags] = useState<string[]>(initialValues.tags);
  const [coverImageUrl, setCoverImageUrl] = useState<string | null>(initialValues.coverImageUrl);
  const [isPublished, setIsPublished] = useState(initialValues.isPublished);
  const [slug, setSlug] = useState(initialValues.slug);
  const [allowAutoTranslation, setAllowAutoTranslation] = useState(initialValues.allowAutoTranslation);

  // 開くたびに親の現在値で再初期化（前回のキャンセル分を引きずらない）
  useEffect(() => {
    if (open) {
      setTitle(initialValues.title);
      setSummary(initialValues.summary);
      setTags(initialValues.tags);
      setCoverImageUrl(initialValues.coverImageUrl);
      setIsPublished(initialValues.isPublished);
      setSlug(initialValues.slug);
      setAllowAutoTranslation(initialValues.allowAutoTranslation);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleCoverUpload = async (file: File) => {
    const url = await uploadCover(file);
    if (url) setCoverImageUrl(url);
  };

  // 確定スラッグ（厳密正規化）。空になる入力は現在のスラッグを維持する。
  const resolvedSlug = normalizeSlug(slug) || initialValues.slug;

  // 説明文はボタンの位置ではなく、いまのボタンの文言で指す。保存ボタンの文言はこのモーダルのスイッチの値
  // （適用したあとの状態）で決まる。下書き保存は公開版があるときだけ出る（hasDraftSave）
  const draftSaveAvailable = hasDraftSave(livePublished);
  const saveLabel = t(PUBLISH_ACTION_MESSAGES[getPublishAction(livePublished, isPublished)].label);
  const draftLabel = t("guideEditor.toolbar.saveDraft");
  const publishDescKey = isPublished
    ? livePublished
      ? "guideEditor.ui.publishOnLive"
      : "guideEditor.ui.publishOnNew"
    : livePublished
      ? "guideEditor.ui.publishOffLive"
      : "guideEditor.ui.publishOffNew";

  const apply = () => {
    onApply({ title, summary, tags, coverImageUrl, isPublished, slug: resolvedSlug, allowAutoTranslation });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-lg"
        {...returnFocus}
        onOpenAutoFocus={(e) => {
          if (!focusPublishOnOpen) return;
          const toggle = document.getElementById("guide-publish-toggle");
          if (!toggle) return;
          e.preventDefault();
          toggle.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{t("guideEditor.toolbar.settings")}</DialogTitle>
          <DialogDescription>
            {draftSaveAvailable
              ? t("guideEditor.ui.settingsDesc", { draft: draftLabel, save: saveLabel })
              : t("guideEditor.ui.settingsDescSingle", { save: saveLabel })}
          </DialogDescription>
        </DialogHeader>

        <MetadataFields
          title={title}
          onTitleChange={setTitle}
          summary={summary}
          onSummaryChange={setSummary}
          tags={tags}
          onAddTag={(tag) => setTags((prev) => [...prev, tag])}
          onRemoveTag={(tag) => setTags((prev) => prev.filter((x) => x !== tag))}
          coverImageUrl={coverImageUrl}
          onCoverUpload={handleCoverUpload}
          onCoverRemove={() => setCoverImageUrl(null)}
          isUploadingCover={isUploadingCover}
          uploadError={uploadError}
        />

        {/* URL（スラッグ） */}
        <div className="space-y-1.5">
          <Label htmlFor="guide-slug">{t("guideEditor.slugLabel")}</Label>
          <Input
            id="guide-slug"
            value={slug}
            onChange={(e) => setSlug(softNormalizeSlug(e.target.value))}
            placeholder={t("guideEditor.slugPlaceholder")}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
          />
          <p className="text-xs text-muted-foreground break-all">
            /guides/{authorSlug}/
            <span className="text-foreground font-medium">{resolvedSlug}</span>
          </p>
          <p className="text-xs text-muted-foreground">{t("guideEditor.slugHint")}</p>
        </div>

        {/* 公開設定（トグル）。名前は見えるラベル「公開する」（Label htmlFor）で、オン/オフは role=switch の状態で伝える */}
        <div className="flex items-center justify-between gap-4 rounded-lg border p-3 mt-1">
          <div className="space-y-0.5">
            <Label htmlFor="guide-publish-toggle">{t("guideEditor.ui.publishLabel")}</Label>
            <p id="guide-publish-toggle-desc" className="text-xs text-muted-foreground">
              {t(publishDescKey, { save: saveLabel, draft: draftLabel })}
            </p>
          </div>
          {/* オンの色は brand（ui.md 1 章: brand ＝選択中。基底の Switch は primary のまま） */}
          <Switch
            id="guide-publish-toggle"
            checked={isPublished}
            onCheckedChange={setIsPublished}
            aria-describedby="guide-publish-toggle-desc"
            className="data-[state=checked]:bg-brand"
          />
        </div>

        {/* 自動翻訳の許可（既定オン。オフで既存の翻訳も削除 — docs/translation.md）。機能無効時は出さない */}
        {translationEnabled && (
          <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
            <div className="space-y-0.5">
              <Label htmlFor="guide-allow-auto-translation">{t("guideEditor.ui.allowAutoTranslation")}</Label>
              <p className="text-xs text-muted-foreground">{t("guideEditor.ui.allowAutoTranslationHint")}</p>
            </div>
            <Switch
              id="guide-allow-auto-translation"
              checked={allowAutoTranslation}
              onCheckedChange={setAllowAutoTranslation}
              aria-label={t("guideEditor.ui.allowAutoTranslation")}
            />
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("guideEditor.ui.cancel")}
          </Button>
          <Button type="button" onClick={apply}>
            {t("guideEditor.ui.apply")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
