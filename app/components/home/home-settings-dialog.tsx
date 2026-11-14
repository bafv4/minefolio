import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { useT } from "@/hooks/use-locale";
import { defaultHomeLayout, HOME_SECTION_LABEL_KEYS, type HomeLayout, type HomeSectionId } from "@/lib/home-sections";
import { ArrowDown, ArrowUp, RotateCcw } from "lucide-react";

/** ホームと設定モーダルで同じ fetcher（保存中の楽観表示用）を共有するキー */
export const HOME_SECTION_ORDER_FETCHER_KEY = "home-section-order";

/** 欄の並び順・表示を編集して保存するモーダル。編集中はローカル state のみ（キャンセルで破棄） */
export function HomeSettingsDialog({
  open,
  onOpenChange,
  layout,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 現在の並び・表示（開くたびにこれを編集の初期値にする） */
  layout: HomeLayout;
}) {
  const t = useT();
  const fetcher = useFetcher<{ success?: boolean; error?: string; action?: string }>({
    key: HOME_SECTION_ORDER_FETCHER_KEY,
  });
  const [draft, setDraft] = useState<HomeSectionId[]>(layout.order);
  const [hidden, setHidden] = useState<HomeSectionId[]>(layout.hidden);
  const [announcement, setAnnouncement] = useState("");
  const submitted = useRef(false);
  const [pendingFocus, setPendingFocus] = useState<{ id: HomeSectionId; dir: "up" | "down" } | null>(null);
  const buttonRefs = useRef(new Map<string, HTMLButtonElement>());
  const listRef = useRef<HTMLUListElement>(null);

  // 開くたびに現在の並びから編集し直す
  useEffect(() => {
    if (open) {
      setDraft(layout.order);
      setHidden(layout.hidden);
      setAnnouncement("");
      submitted.current = false;
    }
    // layout の変化（保存後の再検証）では draft を巻き戻さない
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // 移動後は、動いた行の同じ向きのボタンへフォーカスを追従させる（端に達して disabled になったら逆向きへ）
  useLayoutEffect(() => {
    if (!pendingFocus) return;
    const same = buttonRefs.current.get(`${pendingFocus.id}:${pendingFocus.dir}`);
    const other = buttonRefs.current.get(`${pendingFocus.id}:${pendingFocus.dir === "up" ? "down" : "up"}`);
    (same && !same.disabled ? same : other)?.focus();
    setPendingFocus(null);
  }, [pendingFocus]);

  // 自分の保存結果だけに反応する
  useEffect(() => {
    if (!submitted.current || fetcher.state !== "idle" || !fetcher.data) return;
    submitted.current = false;
    if (fetcher.data.success) {
      toast.success(t("home.settingsSaved"));
      onOpenChange(false);
    } else {
      toast.error(fetcher.data.error ?? t("home.settingsSaveFailed"));
    }
  }, [fetcher.state, fetcher.data, onOpenChange, t]);

  const move = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= draft.length) return;
    const next = [...draft];
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item);
    setDraft(next);
    setPendingFocus({ id: item, dir: delta === -1 ? "up" : "down" });
    setAnnouncement(t("home.settingsMoved", { name: t(HOME_SECTION_LABEL_KEYS[item]), position: target + 1 }));
  };

  const visibleCount = draft.length - hidden.length;
  const toggleVisible = (id: HomeSectionId, visible: boolean) =>
    setHidden((prev) => (visible ? prev.filter((h) => h !== id) : prev.includes(id) ? prev : [...prev, id]));

  const initial = layout;
  const changed =
    draft.some((id, i) => id !== initial.order[i]) ||
    hidden.length !== initial.hidden.length ||
    hidden.some((id) => !initial.hidden.includes(id));

  const reset = () => {
    const def = defaultHomeLayout();
    setDraft(def.order);
    setHidden(def.hidden);
    setAnnouncement("");
  };

  const saving = fetcher.state !== "idle";
  const save = () => {
    submitted.current = true;
    fetcher.submit(
      { _action: "saveHomeSectionOrder", order: JSON.stringify(draft), hidden: JSON.stringify(hidden) },
      // ホームは index ルートなので ?index を付けないと親レイアウト（action なし）に送られる
      { method: "post", action: "/?index" },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        onOpenAutoFocus={(e) => {
          // 既定では「初期設定に戻す」に当たるので、一覧の先頭の行の操作要素へ移す
          e.preventDefault();
          listRef.current?.querySelector<HTMLElement>("button:not(:disabled), [role=switch]:not(:disabled)")?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{t("home.settingsTitle")}</DialogTitle>
          <DialogDescription>{t("home.settingsDescription")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">{t("home.settingsOrderHeading")}</h3>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="min-h-11 sm:min-h-8"
              onClick={reset}
            >
              <RotateCcw className="mr-1.5" />
              {t("home.settingsReset")}
            </Button>
          </div>
          <ul ref={listRef} className="divide-y rounded-xl border border-border/70 bg-background/80">
            {draft.map((id, index) => {
              const name = t(HOME_SECTION_LABEL_KEYS[id]);
              const visible = !hidden.includes(id);
              const lastVisible = visible && visibleCount <= 1;
              return (
                <li key={id} className="flex items-center gap-2 px-3 py-1.5">
                  <Switch
                    id={`home-settings-show-${id}`}
                    checked={visible}
                    disabled={lastVisible}
                    onCheckedChange={(v) => toggleVisible(id, v)}
                    aria-label={t("home.settingsShow", { name })}
                    aria-describedby={lastVisible ? "home-settings-last-visible" : undefined}
                  />
                  {/* 欄名もスイッチのラベル（タップで切替）にして、小さいスイッチだけを狙わずに済むようにする */}
                  <label
                    htmlFor={`home-settings-show-${id}`}
                    className={cn(
                      "min-w-0 flex-1 cursor-pointer truncate py-2.5 text-sm font-medium",
                      !visible && "text-muted-foreground",
                      lastVisible && "cursor-default",
                    )}
                  >
                    {name}
                  </label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-11 sm:size-9"
                    ref={(el) => {
                      if (el) buttonRefs.current.set(`${id}:up`, el);
                      else buttonRefs.current.delete(`${id}:up`);
                    }}
                    disabled={index === 0}
                    aria-label={t("home.settingsMoveUp", { name })}
                    onClick={() => move(index, -1)}
                  >
                    <ArrowUp />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-11 sm:size-9"
                    ref={(el) => {
                      if (el) buttonRefs.current.set(`${id}:down`, el);
                      else buttonRefs.current.delete(`${id}:down`);
                    }}
                    disabled={index === draft.length - 1}
                    aria-label={t("home.settingsMoveDown", { name })}
                    onClick={() => move(index, 1)}
                  >
                    <ArrowDown />
                  </Button>
                </li>
              );
            })}
          </ul>
          <p id="home-settings-last-visible" className="sr-only">
            {t("home.settingsLastVisible")}
          </p>
          {visibleCount <= 1 && (
            <p className="text-xs text-muted-foreground" aria-hidden="true">
              {t("home.settingsLastVisible")}
            </p>
          )}
          <p aria-live="polite" className="sr-only">
            {announcement}
          </p>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("home.settingsCancel")}
          </Button>
          <Button type="button" onClick={save} disabled={saving || !changed}>
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
