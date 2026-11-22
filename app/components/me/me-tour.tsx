// /me の初回ツアー。`show`（users.meTourCompletedAt が null）のとき、画面の要素を順に指す吹き出しを1回だけ出す。
// 終える・スキップ・Esc のいずれでも api/me/guide に記録し、二度と出ない。
// 吹き出しは Radix Popover（非モーダル）: 背景のスクロール・操作は止めない。フォーカスの移動・Esc・衝突回避
// （375px でも画面内）・スクロール追従（autoUpdate）を任せ、外側のクリックでは閉じない（誤タップで二度と出なくなるため）。対象は data-me-tour 属性で示す（手順と対象は lib/me-tour.ts）。
import { useEffect, useMemo, useRef, useState } from "react";
import type { ComponentProps } from "react";
import { useT } from "@/hooks/use-locale";
import { Button } from "@/components/ui/button";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { recordMeGuide } from "@/lib/me-guide";
import { anchorRect, resolveTourSteps, type ResolvedTourStep } from "@/lib/me-tour";

type AnchorRef = NonNullable<ComponentProps<typeof PopoverAnchor>["virtualRef"]>;

export function MeTour({ show }: { show: boolean }) {
  const t = useT();
  const [steps, setSteps] = useState<ResolvedTourStep[] | null>(null);
  const [index, setIndex] = useState(0);
  const [finished, setFinished] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // マウント後（対象の要素が DOM に出てから）に、見えている対象だけで手順を決める
  useEffect(() => {
    if (!show || finished || steps) return;
    const frame = requestAnimationFrame(() => {
      const resolved = resolveTourSteps();
      if (resolved.length === 0) {
        // 出せる手順が1つも無い（想定外）。出さずに終えた扱いにはしない（次の画面で改めて試す）
        return;
      }
      setSteps(resolved);
    });
    return () => cancelAnimationFrame(frame);
  }, [show, finished, steps]);

  const open = show && !finished && steps !== null;
  const step = open ? steps[Math.min(index, steps.length - 1)] : null;
  const element = step?.element ?? null;
  // 指している要素を枠で強調し、見える位置へ寄せる
  useEffect(() => {
    if (!element) return;
    element.setAttribute("data-me-tour-active", "");
    element.scrollIntoView({ block: "nearest", behavior: "auto" });
    return () => element.removeAttribute("data-me-tour-active");
  }, [element]);

  // 手順が変わるたびにフォーカスを見出しへ置き、読み上げに内容を伝える（aria-live は付けない＝二重に読ませない）
  useEffect(() => {
    if (open) headingRef.current?.focus();
  }, [open, index]);

  const anchor = useMemo<AnchorRef | null>(() => {
    if (!step) return null;
    const element = step.element;
    return {
      current: {
        contextElement: element,
        getBoundingClientRect: () => {
          const viewport = { width: window.innerWidth, height: window.innerHeight };
          const r = anchorRect(element.getBoundingClientRect(), viewport);
          return new DOMRect(r.left, r.top, r.width, r.height);
        },
      },
    } as AnchorRef;
  }, [step, element]);

  if (!open || !step || !steps || !anchor) return null;

  const finish = () => {
    setFinished(true);
    // useFetcher.submit は表示中の子ルートの loader まで再検証させるので、素の fetch で記録する
    void recordMeGuide("tour");
  };
  const isLast = index >= steps.length - 1;
  const id = step.def.id;
  const usesToggle = step.target === "sidebar-toggle";
  const body =
    id === "sidebar" && usesToggle ? t("meLayout.tour.sidebar.bodyMobile") : t(`meLayout.tour.${id}.body`);
  // 保存バーは画面下に固定されているので、吹き出しはその上に出す
  const side = id === "save" ? "top" : step.target === "sidebar" ? "right" : "bottom";

  return (
    <Popover open modal={false}>
      <PopoverAnchor virtualRef={anchor} />
      <PopoverContent
        ref={contentRef}
        tabIndex={-1}
        side={side}
        align="start"
        sideOffset={12}
        collisionPadding={16}
        aria-label={t("meLayout.tour.dialogLabel")}
        aria-describedby="me-tour-body"
        onInteractOutside={(e) => e.preventDefault()}
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          contentRef.current?.focus();
        }}
        onEscapeKeyDown={finish}
        className="w-[min(22rem,calc(100vw-2rem))] space-y-3 p-4 focus-visible:outline-none motion-reduce:animate-none"
      >
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <h2 ref={headingRef} tabIndex={-1} className="text-base font-semibold focus-visible:outline-none">{t(`meLayout.tour.${id}.title`)}</h2>
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
              {t("meLayout.tour.progress", { current: index + 1, total: steps.length })}
            </span>
          </div>
          <p id="me-tour-body" className="text-sm text-muted-foreground">
            {body}
          </p>
        </div>
        <div className="flex items-center justify-between gap-2">
          <Button type="button" variant="ghost" size="sm" className="min-h-11 sm:min-h-8" onClick={finish}>
            {t("meLayout.tour.skip")}
          </Button>
          <div className="flex items-center gap-2">
            {index > 0 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="min-h-11 sm:min-h-8"
                onClick={() => setIndex(index - 1)}
              >
                {t("meLayout.tour.back")}
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              className="min-h-11 sm:min-h-8"
              onClick={() => (isLast ? finish() : setIndex(index + 1))}
            >
              {isLast ? t("meLayout.tour.finish") : t("meLayout.tour.next")}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
