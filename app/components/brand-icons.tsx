import { forwardRef, type ComponentProps } from "react";
import { SiGithub, SiTwitch, SiX, SiYoutube } from "@icons-pack/react-simple-icons";

type IconType = typeof SiX;

/**
 * ブランドアイコン（lucide-react 1.x でブランドアイコンが削除されたための代替）。
 *
 * `@icons-pack/react-simple-icons` をラップし、サイトの既定（モノクロ・装飾用途）を揃える。
 * - 色は `currentColor`（文字色を継承）。ライブラリ既定もこれだが、将来の変更に備え明示する
 * - サイズは lucide と同様に `className`（`h-* w-*`）で指定する（`size` 既定の 24 は属性として出るが CSS が優先）
 * - 装飾専用なので `aria-hidden`。ライブラリ既定の `<title>`（"X" 等）はツールチップに出るため空にする
 *
 * lucide の `Youtube` / `Twitch` / `Twitter` / `Github` と同名で export しているため、
 * 呼び出し側は import 元の差し替えだけで済む。`Twitter` は X のロゴを描画する
 * （内部値 "twitter"・表示名「Twitter/X」は変えていない）。
 * 葉モジュール（外部依存は react-simple-icons のみ）。
 */
export type BrandIconProps = Omit<ComponentProps<IconType>, "ref" | "title" | "color" | "size">;

function createBrandIcon(Icon: IconType, displayName: string) {
  const BrandIcon = forwardRef<SVGSVGElement, BrandIconProps>(function BrandIcon(props, ref) {
    return <Icon ref={ref} color="currentColor" title="" aria-hidden="true" {...props} />;
  });
  BrandIcon.displayName = displayName;
  return BrandIcon;
}

export const Youtube = createBrandIcon(SiYoutube, "Youtube");
export const Twitch = createBrandIcon(SiTwitch, "Twitch");
/** X（旧 Twitter）のロゴ */
export const Twitter = createBrandIcon(SiX, "Twitter");
export const Github = createBrandIcon(SiGithub, "Github");
