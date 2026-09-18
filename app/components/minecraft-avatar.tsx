import { useState, useEffect, memo } from "react";
import { getRenderableAvatar, isMissingSkinSource, renderAvatar, NO_MCID_FACE_URL } from "@/lib/avatar-cache";
import { useT } from "@/hooks/use-locale";

interface MinecraftAvatarProps {
  uuid: string | null | undefined;
  skinUrl?: string | null;
  mcid?: string | null;
  size?: number;
  overlay?: boolean;
  className?: string;
}

const MinecraftAvatarComponent = ({
  uuid,
  skinUrl,
  mcid,
  size = 64,
  overlay = true,
  className = "",
}: MinecraftAvatarProps) => {
  const t = useT();
  // MCID未登録（uuid も customSkinUrl も無い）はスキンPNGが存在しないため、
  // 頭部を切り出すキャッシュ経路を通さずプレースホルダーSVGをそのまま <img> で描く
  const missingSkinSource = isMissingSkinSource({ uuid, skinUrl });
  const altText = missingSkinSource
    ? t("fullbodyViewer.noMcidAvatarLabel")
    : mcid
      ? t("fullbodyViewer.avatarLabelOf", { name: mcid })
      : t("fullbodyViewer.avatarLabel");
  // スキンが取得済み（別サイズ・別ページ含む）なら初期描画から即座に表示（ちらつき防止）
  const [imgSrc, setImgSrc] = useState<string | null>(
    () => (missingSkinSource ? null : getRenderableAvatar({ uuid, skinUrl, size, overlay }) ?? null)
  );
  const [isLoading, setIsLoading] = useState(
    () => !missingSkinSource && !getRenderableAvatar({ uuid, skinUrl, size, overlay })
  );
  const [error, setError] = useState(false);

  // 他のアバターと見かけの大きさを揃えるための内側余白（composite() と同じ 5%）
  const padding = Math.ceil(size * 0.05);
  const drawArea = size - padding * 2;

  useEffect(() => {
    if (missingSkinSource) return;

    let cancelled = false;

    const cached = getRenderableAvatar({ uuid, skinUrl, size, overlay });
    if (cached) {
      setImgSrc(cached);
      setIsLoading(false);
      setError(false);
      return;
    }

    setIsLoading(true);
    setError(false);

    renderAvatar({ uuid, skinUrl, size, overlay })
      .then((dataUrl) => {
        if (cancelled) return;
        setImgSrc(dataUrl);
        setIsLoading(false);
      })
      .catch((err) => {
        console.error("Failed to render avatar:", err);
        if (cancelled) return;
        setError(true);
        setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [uuid, skinUrl, size, overlay, missingSkinSource]);

  return (
    <div
      className={className}
      style={{
        width: size,
        height: size,
        position: "relative",
      }}
    >
      {missingSkinSource && (
        <img
          src={NO_MCID_FACE_URL}
          alt={altText}
          width={drawArea}
          height={drawArea}
          style={{
            imageRendering: "pixelated",
            width: drawArea,
            height: drawArea,
            position: "absolute",
            top: padding,
            left: padding,
            backgroundColor: "transparent",
            filter:
              "drop-shadow(0 1px 0 rgba(0, 0, 0, 0.35)) drop-shadow(0 2px 4px rgba(0, 0, 0, 0.28))",
          }}
        />
      )}
      {!missingSkinSource && imgSrc && !isLoading && (
        <img
          src={imgSrc}
          alt={altText}
          width={size}
          height={size}
          style={{
            imageRendering: "pixelated",
            width: size,
            height: size,
            backgroundColor: "transparent",
            filter:
              "drop-shadow(0 1px 0 rgba(0, 0, 0, 0.35)) drop-shadow(0 2px 4px rgba(0, 0, 0, 0.28))",
          }}
        />
      )}
      {isLoading && (
        <div
          style={{
            width: size,
            height: size,
            backgroundColor: "var(--muted)",
            position: "absolute",
            top: 0,
            left: 0,
          }}
        />
      )}
      {error && !isLoading && (
        <div
          style={{
            width: size,
            height: size,
            backgroundColor: "var(--muted)",
            position: "absolute",
            top: 0,
            left: 0,
          }}
        />
      )}
    </div>
  );
};

export const MinecraftAvatar = memo(MinecraftAvatarComponent);
