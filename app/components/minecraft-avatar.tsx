import { useState, useEffect, useRef, memo, useCallback } from "react";

const STEVE_UUID = "8667ba71b85a4004af54457a9734eed7";
const HEAD_BASE = { x: 8, y: 8, width: 8, height: 8 };
const HEAD_OVERLAY = { x: 40, y: 8, width: 8, height: 8 };

interface MinecraftAvatarProps {
  uuid: string;
  mcid?: string;
  size?: number;
  overlay?: boolean;
  className?: string;
}

const MinecraftAvatarComponent = ({
  uuid,
  mcid,
  size = 64,
  overlay = true,
  className = "",
}: MinecraftAvatarProps) => {
  const [imgSrc, setImgSrc] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let cancelled = false;

    const renderAvatar = async () => {
      setIsLoading(true);
      setError(false);

      // Use local skin proxy API
      const skinUrl = `/api/skin?uuid=${uuid}`;
      const fallbackSkinUrl = `/api/skin?uuid=${STEVE_UUID}`;

      const loadImage = (url: string): Promise<HTMLImageElement> => {
        return new Promise((resolve, reject) => {
          const img = new Image();
          img.crossOrigin = "anonymous";
          img.onload = () => resolve(img);
          img.onerror = reject;
          img.src = url;
        });
      };

      try {
        let skinImage: HTMLImageElement;
        try {
          skinImage = await loadImage(skinUrl);
        } catch {
          skinImage = await loadImage(fallbackSkinUrl);
        }

        if (cancelled) return;

        // オーバーレイを少し大きく描画するための設定
        // 角丸でもはみ出ないよう、控えめなスケールに調整
        const overlayScale = 1.0625; // 約6.25%大きく（17/16）
        const padding = Math.ceil(size * 0.05); // 5%のパディング

        const outputCanvas = document.createElement("canvas");
        outputCanvas.width = size;
        outputCanvas.height = size;
        const outputCtx = outputCanvas.getContext("2d");
        if (!outputCtx) return;

        outputCtx.imageSmoothingEnabled = false;

        // 描画領域（パディングを考慮）
        const drawArea = size - padding * 2;

        // ベースレイヤーの描画サイズを計算
        const baseDrawSize = overlay
          ? Math.floor(drawArea / overlayScale)
          : drawArea;
        const baseOffset = padding + Math.floor((drawArea - baseDrawSize) / 2);

        // Draw base head layer (centered)
        outputCtx.drawImage(
          skinImage,
          HEAD_BASE.x,
          HEAD_BASE.y,
          HEAD_BASE.width,
          HEAD_BASE.height,
          baseOffset,
          baseOffset,
          baseDrawSize,
          baseDrawSize
        );

        // Draw overlay layer if enabled (slightly larger than base)
        if (overlay) {
          outputCtx.drawImage(
            skinImage,
            HEAD_OVERLAY.x,
            HEAD_OVERLAY.y,
            HEAD_OVERLAY.width,
            HEAD_OVERLAY.height,
            padding,
            padding,
            drawArea,
            drawArea
          );
        }

        const dataUrl = outputCanvas.toDataURL("image/png");
        if (!cancelled) {
          setImgSrc(dataUrl);
          setIsLoading(false);
        }
      } catch (err) {
        console.error("Failed to render avatar:", err);
        if (!cancelled) {
          setError(true);
          setIsLoading(false);
        }
      }
    };

    renderAvatar();

    return () => {
      cancelled = true;
    };
  }, [uuid, size, overlay]);

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
      <canvas ref={canvasRef} style={{ display: "none" }} />
    </div>
  );
};

export const MinecraftAvatar = memo(MinecraftAvatarComponent);
