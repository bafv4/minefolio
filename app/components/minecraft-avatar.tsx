import { useState, useEffect, memo } from "react";
import { getRenderableAvatar, renderAvatar } from "@/lib/avatar-cache";

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
  // スキンが取得済み（別サイズ・別ページ含む）なら初期描画から即座に表示（ちらつき防止）
  const [imgSrc, setImgSrc] = useState<string | null>(
    () => getRenderableAvatar({ uuid, skinUrl, size, overlay }) ?? null
  );
  const [isLoading, setIsLoading] = useState(
    () => !getRenderableAvatar({ uuid, skinUrl, size, overlay })
  );
  const [error, setError] = useState(false);

  useEffect(() => {
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
  }, [uuid, skinUrl, size, overlay]);

  return (
    <div
      className={className}
      style={{
        width: size,
        height: size,
        position: "relative",
      }}
    >
      {imgSrc && !isLoading && (
        <img
          src={imgSrc}
          alt={mcid ? `${mcid}'s avatar` : "Minecraft avatar"}
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
            backgroundColor: "#3c3c3c",
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
            backgroundColor: "#3c3c3c",
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
