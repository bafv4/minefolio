// 未保存のまま離れようとしたときの確認ダイアログ。useUnsavedWarning() が返す Blocker と組で使う。
//
// `onSave` を渡すと「保存して移動」（主ボタン）を足す。押すと onSave を呼び、送信が終わって未保存が解消したら
// blocker.proceed()。送信が始まらない（画面側の事前検証で止まった）・失敗した（送信後も未保存）ときは
// blocker.reset() してダイアログを閉じ、画面側のエラー表示を見せる。onSave を渡さない呼び出し側
// （guide-editor）は従来どおり「編集を続ける」「保存せず離れる」の2択。
import { useEffect, useRef, useState } from "react";
import type { Blocker } from "react-router";
import { useT } from "@/hooks/use-locale";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";

/** onSave を呼んでから送信（isSubmitting）が立ち上がるまで待つ上限。過ぎたら保存は始まらなかったとみなす */
export const SAVE_START_TIMEOUT_MS = 1500;

/**
 * 送信が終わってから、未保存（hasChanges）が解消するのを待つ上限。画面側は保存結果を受け取った後の effect で
 * 下書きの基準を入れ替えるため、送信が終わったレンダーではまだ hasChanges が true のことがある。
 * 過ぎても解消しなければ保存は失敗したとみなす
 */
export const SAVE_SETTLE_TIMEOUT_MS = 1000;

interface UnsavedChangesDialogProps {
  blocker: Blocker;
  /** 「保存して移動」の保存処理（FloatingSaveBar の onSave）。省略すると「保存して移動」を出さない */
  onSave?: () => void;
  /** 保存の送信中か（onSave を渡すとき必須） */
  isSubmitting?: boolean;
  /** 未保存の変更が残っているか（保存中を含めた生の値。onSave を渡すとき必須） */
  hasChanges?: boolean;
}

export function UnsavedChangesDialog({
  blocker,
  onSave,
  isSubmitting = false,
  hasChanges = true,
}: UnsavedChangesDialogProps) {
  const t = useT();
  // waiting: onSave を呼んで送信の開始待ち / saving: 送信中 / settling: 送信後に未保存の解消待ち / idle: 何もしていない
  const [phase, setPhase] = useState<"idle" | "waiting" | "saving" | "settling">("idle");
  const blockerRef = useRef(blocker);
  blockerRef.current = blocker;

  const blocked = blocker.state === "blocked";

  // ダイアログが閉じたら（保存せず離れる・編集を続ける等）状態を戻す
  useEffect(() => {
    if (!blocked) setPhase("idle");
  }, [blocked]);

  useEffect(() => {
    if (phase === "waiting") {
      if (isSubmitting) {
        setPhase("saving");
        return;
      }
      const timer = setTimeout(() => {
        // 送信が始まらなかった（事前検証で止まった等）。画面のエラー表示が見えるよう閉じる
        setPhase("idle");
        blockerRef.current.reset?.();
      }, SAVE_START_TIMEOUT_MS);
      return () => clearTimeout(timer);
    }
    if (phase === "saving" && !isSubmitting) {
      setPhase("settling");
      return;
    }
    if (phase === "settling") {
      if (!hasChanges) {
        setPhase("idle");
        blockerRef.current.proceed?.();
        return;
      }
      const timer = setTimeout(() => {
        // 送信後も未保存が残った（保存に失敗した）。画面のエラー表示が見えるよう閉じる
        setPhase("idle");
        blockerRef.current.reset?.();
      }, SAVE_SETTLE_TIMEOUT_MS);
      return () => clearTimeout(timer);
    }
  }, [phase, isSubmitting, hasChanges]);

  const busy = phase !== "idle";

  return (
    <AlertDialog
      open={blocked}
      onOpenChange={(open) => {
        // Esc での閉じは「編集を続ける」と同じ扱い（保存中は閉じない）
        if (!open && !busy) blocker.reset?.();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("common.unsavedChanges")}</AlertDialogTitle>
          <AlertDialogDescription>{t("common.unsavedLeaveDesc")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy} className="max-sm:min-h-11" onClick={() => blocker.reset?.()}>
            {t("common.keepEditing")}
          </AlertDialogCancel>
          {onSave ? (
            <>
              {/* データを失う操作は主ボタンにしない（outline＋文字だけ destructive 色） */}
              <AlertDialogAction
                disabled={busy}
                className={cn(buttonVariants({ variant: "outline" }), "text-destructive max-sm:min-h-11")}
                onClick={() => blocker.proceed?.()}
              >
                {t("common.leaveWithoutSaving")}
              </AlertDialogAction>
              <AlertDialogAction
                disabled={busy}
                className="max-sm:min-h-11"
                onClick={(e) => {
                  // 保存が終わるまでダイアログを閉じない
                  e.preventDefault();
                  setPhase("waiting");
                  onSave();
                }}
              >
                {busy ? `${t("common.savingAndLeaving")}...` : t("common.saveAndLeave")}
              </AlertDialogAction>
            </>
          ) : (
            <AlertDialogAction className="max-sm:min-h-11" onClick={() => blocker.proceed?.()}>
              {t("common.leaveWithoutSaving")}
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
