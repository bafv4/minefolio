// 未保存のまま離れようとしたときの確認ダイアログ。useUnsavedWarning() が返す Blocker と組で使う。
import type { Blocker } from "react-router";
import { useT } from "@/hooks/use-locale";
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

export function UnsavedChangesDialog({ blocker }: { blocker: Blocker }) {
  const t = useT();

  return (
    <AlertDialog
      open={blocker.state === "blocked"}
      onOpenChange={(open) => {
        // Esc での閉じは「編集を続ける」と同じ扱い
        if (!open) blocker.reset?.();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("common.unsavedChanges")}</AlertDialogTitle>
          <AlertDialogDescription>{t("common.unsavedLeaveDesc")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => blocker.reset?.()}>
            {t("common.keepEditing")}
          </AlertDialogCancel>
          <AlertDialogAction onClick={() => blocker.proceed?.()}>
            {t("common.leaveWithoutSaving")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
