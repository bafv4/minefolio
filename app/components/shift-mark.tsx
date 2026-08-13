import { Fragment } from "react";
import { ArrowBigUp } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Shift キーの視覚表現。Unicode の「⇧」直書きはフォント依存でグリフが揺れるため、
 * lucide の `ArrowBigUp` アイコンに統一する（描画層のみの変換）。
 *
 * データ層（`app/lib/remap-utils.ts` が返す `displayLabel` 等の文字列、翻訳文言・Tooltip・
 * aria-label のような純テキスト文脈）は引き続き "⇧" 文字のまま保持する。アイコンへの
 * 置き換えは、その文字列を画面に描画する箇所（JSX）でのみ行う（`KeyLabelText` 参照）。
 *
 * 読み上げ配慮のため、アイコン自体は `aria-hidden` にし `sr-only` の "Shift" テキストを添える。
 */
export function ShiftMark({ className }: { className?: string }) {
  return (
    <span className="inline-flex items-center">
      <ArrowBigUp className={cn("size-3.5", className)} aria-hidden="true" />
      <span className="sr-only">Shift</span>
    </span>
  );
}

/**
 * ラベル文字列中に含まれる全ての "⇧" を `ShiftMark` に置き換えて描画するインライン変換。
 * `app/lib/remap-utils.ts` の `displayLabel`（例: `"⇧+S"`、`"⇧Home"`）や
 * `ControlKeyBadge` の操作ラベル（例: `"⇧Home"`）をそのまま渡せる。
 * ベースラインが揃うよう `inline-flex items-center` でラップする。
 */
export function KeyLabelText({
  label,
  shiftClassName,
}: {
  label: string;
  /** ShiftMark に渡すサイズ調整用クラス（描画文脈の文字サイズに合わせる。省略時は既定の size-3.5） */
  shiftClassName?: string;
}) {
  const parts = label.split("⇧");
  return (
    <span className="inline-flex items-center">
      {parts.map((part, i) => (
        <Fragment key={i}>
          {i > 0 && <ShiftMark className={shiftClassName} />}
          {part}
        </Fragment>
      ))}
    </span>
  );
}
