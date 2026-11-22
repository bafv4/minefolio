// 公開の確認ダイアログ（ツールバーの「公開…」。公開版の無いガイドだけに出る近道）。
// 確認専用: タイトル・URL・カバー画像を読み取りで見せ、「公開する」で保存と公開を一度に行う。
// 欄の編集はガイド設定（settings-dialog.tsx）に集め、ここからは「設定を変える」で移る
// （同じ欄を2か所で直せると、どちらで直したか・保存されたかを覚えておく必要があるため）。
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";
import { useT } from "@/hooks/use-locale";
import { useDialogReturnFocus } from "../lib/dialog-return-focus";

interface PublishDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** 確定済みの URL スラッグ（/guides/{authorSlug}/{slug}） */
  slug: string;
  authorSlug: string;
  coverImageUrl: string | null;
  /** 保存の送信中。主ボタンを無効にして二重送信を防ぎ、閉じる操作も受け付けない */
  saving: boolean;
  /** 保存と公開を一度に行う。保存が成功するまで閉じるのは親の責務（失敗したら開いたままエラーを出す） */
  onPublish: () => void;
  /** この確認を閉じて、ガイド設定（編集用）を開く */
  onEditSettings: () => void;
}

export function PublishDialog({
  open,
  onOpenChange,
  title,
  slug,
  authorSlug,
  coverImageUrl,
  saving,
  onPublish,
  onEditSettings,
}: PublishDialogProps) {
  const t = useT();
  // 閉じたあと body に落ちたフォーカスを、開く前の要素かエディタへ戻す（トリガーの無いダイアログ）
  const returnFocus = useDialogReturnFocus(open);

  return (
    <Dialog open={open} onOpenChange={(next) => !(saving && !next) && onOpenChange(next)}>
      <DialogContent className="sm:max-w-lg" {...returnFocus}>
        <DialogHeader>
          <DialogTitle>{t("guideEditor.ui.publishTitle")}</DialogTitle>
          <DialogDescription>{t("guideEditor.ui.publishDesc")}</DialogDescription>
        </DialogHeader>

        <dl className="space-y-3 text-sm">
          <div className="space-y-0.5">
            <dt className="text-xs text-muted-foreground">{t("guideEditor.ui.titleLabel")}</dt>
            <dd className="font-medium break-words">{title || t("guideEditor.ui.publishTitleEmpty")}</dd>
          </div>
          <div className="space-y-0.5">
            <dt className="text-xs text-muted-foreground">{t("guideEditor.slugLabel")}</dt>
            <dd className="text-muted-foreground break-all">
              /guides/{authorSlug}/<span className="font-medium text-foreground">{slug}</span>
            </dd>
          </div>
          <div className="space-y-1">
            <dt className="text-xs text-muted-foreground">{t("guideEditor.ui.coverImage")}</dt>
            <dd>
              {coverImageUrl ? (
                <img
                  src={coverImageUrl}
                  alt={t("guideEditor.ui.thumbnailAlt")}
                  className="h-20 aspect-2/1 rounded-lg border object-cover"
                />
              ) : (
                <span className="text-muted-foreground">{t("guideEditor.ui.publishCoverNone")}</span>
              )}
            </dd>
          </div>
        </dl>

        <DialogFooter className="sm:justify-between">
          <Button type="button" variant="ghost" onClick={onEditSettings} disabled={saving}>
            {t("guideEditor.ui.publishEditSettings")}
          </Button>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              {t("guideEditor.ui.cancel")}
            </Button>
            <Button type="button" onClick={onPublish} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              {t("guideEditor.ui.publishNow")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
