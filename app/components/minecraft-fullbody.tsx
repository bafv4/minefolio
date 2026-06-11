import { useRef, useEffect, useState, useCallback, memo } from "react";
import type { SkinViewer } from "skinview3d";
import { HelpCircle, RotateCcw } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { t } from "@/lib/messages";

const STEVE_UUID = "8667ba71b85a4004af54457a9734eed7";

const ICON_BUTTON_CLASS =
  "flex items-center justify-center w-7 h-7 rounded-full border transition-colors backdrop-blur-sm";

// 静止画像キャッシュ（同じUUID/ポーズの組み合わせを再利用）
// Map は挿入順を保持するため、サイズ超過時は最古を削除して簡易 LRU として利用。
const imageCache = new Map<string, string>();
const IMAGE_CACHE_LIMIT = 50;

function getCacheKey(
  uuid: string,
  pose: string,
  width: number,
  height: number,
  angle: number,
  elevation: number,
  zoom: number,
  slim: boolean
): string {
  return `${uuid}-${pose}-${width}-${height}-${angle}-${elevation}-${zoom}-${slim ? "slim" : "default"}`;
}

// 最近使ったキーを末尾に再挿入することで純 LRU として動作
function getCachedImage(key: string): string | undefined {
  const value = imageCache.get(key);
  if (value === undefined) return undefined;
  imageCache.delete(key);
  imageCache.set(key, value);
  return value;
}

function setCachedImage(key: string, value: string): void {
  if (imageCache.has(key)) imageCache.delete(key);
  imageCache.set(key, value);
  while (imageCache.size > IMAGE_CACHE_LIMIT) {
    const firstKey = imageCache.keys().next().value;
    if (firstKey === undefined) break;
    imageCache.delete(firstKey);
  }
}

export type PoseName =
  | "standing"
  | "walking"
  | "running"
  | "waving"
  | "sitting"
  | "custom";

interface MinecraftFullBodyProps {
  /** UUID（uuidまたはskinUrlのどちらかが必要） */
  uuid?: string;
  /** カスタムスキンURL（uuidまたはskinUrlのどちらかが必要） */
  skinUrl?: string;
  mcid?: string;
  width?: number;
  height?: number;
  pose?: PoseName;
  angle?: number;
  elevation?: number;
  zoom?: number;
  className?: string;
  background?: string;
  walk?: boolean;
  run?: boolean;
  rotate?: boolean;
  /** trueの場合、レンダリング後に静止画像として出力（操作不可） */
  asImage?: boolean;
  /** Slimスキン（腕幅3px）を使用する場合はtrue */
  slim?: boolean;
  /** ユーザーによる回転・拡大縮小・移動操作を有効化（asImageは強制無効化される） */
  interactive?: boolean;
  /** インタラクティブモード時にヒントボタン（？）を表示するかどうか。クリックでヒント表示をトグル。 */
  showInteractiveHint?: boolean;
}

const POSE_ROTATIONS: Record<
  Exclude<PoseName, "custom">,
  {
    head: { x: number; y: number; z: number };
    body: { x: number; y: number; z: number };
    leftArm: { x: number; y: number; z: number };
    rightArm: { x: number; y: number; z: number };
    leftLeg: { x: number; y: number; z: number };
    rightLeg: { x: number; y: number; z: number };
  }
> = {
  // 直立（柔らかい感じ - 少し体を傾けて自然に）
  standing: {
    head: { x: 0.05, y: 0.1, z: 0.03 },
    body: { x: 0, y: 0.05, z: 0 },
    leftArm: { x: 0.05, y: 0, z: 0.08 },
    rightArm: { x: -0.05, y: 0, z: -0.08 },
    leftLeg: { x: 0, y: 0, z: 0.02 },
    rightLeg: { x: 0, y: 0, z: -0.02 },
  },
  // 歩行（現状維持）
  walking: {
    head: { x: 0, y: 0, z: 0 },
    body: { x: 0, y: 0, z: 0 },
    leftArm: { x: 0.5, y: 0, z: 0.05 },
    rightArm: { x: -0.5, y: 0, z: -0.05 },
    leftLeg: { x: -0.4, y: 0, z: 0 },
    rightLeg: { x: 0.4, y: 0, z: 0 },
  },
  // 走行
  running: {
    head: { x: -0.1, y: 0, z: 0 },
    body: { x: -0.17, y: 0, z: 0 },
    leftArm: { x: 0.9, y: 0, z: 0.1 },
    rightArm: { x: -0.9, y: 0, z: -0.1 },
    leftLeg: { x: -0.7, y: 0, z: 0 },
    rightLeg: { x: 0.7, y: 0, z: 0 },
  },
  // 手を振る（顔を少し下げる）
  waving: {
    head: { x: 0.15, y: 0.2, z: 0.05 },
    body: { x: 0, y: 0, z: 0 },
    leftArm: { x: 0, y: 0, z: 0.05 },
    rightArm: { x: -2.1, y: 0.35, z: -0.35 },
    leftLeg: { x: 0, y: 0, z: 0 },
    rightLeg: { x: 0, y: 0, z: 0 },
  },
  // 座り
  sitting: {
    head: { x: 0.1, y: 0, z: 0 },
    body: { x: 0, y: 0, z: 0 },
    leftArm: { x: -0.8, y: 0, z: 0.17 },
    rightArm: { x: -0.8, y: 0, z: -0.17 },
    leftLeg: { x: -1.57, y: 0, z: 0 },
    rightLeg: { x: -1.57, y: 0, z: 0 },
  },
};

const MinecraftFullBodyComponent = ({
  uuid,
  skinUrl,
  mcid,
  width = 300,
  height = 400,
  pose = "standing",
  angle = 25,
  elevation = 10,
  zoom = 0.9,
  className = "",
  background,
  walk = false,
  run = false,
  rotate = false,
  asImage = false,
  slim = false,
  interactive = false,
  showInteractiveHint = false,
}: MinecraftFullBodyProps) => {
  const skinIdentifier = skinUrl || uuid || STEVE_UUID;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewerRef = useRef<SkinViewer | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [hintVisible, setHintVisible] = useState(false);

  // interactive モードでは静止画化を強制無効化（操作不能なため）
  const effectiveAsImage = interactive ? false : asImage;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (effectiveAsImage) {
      const cacheKey = getCacheKey(skinIdentifier, pose, width, height, angle, elevation, zoom, slim);
      const cachedImage = getCachedImage(cacheKey);
      if (cachedImage) {
        setImageSrc(cachedImage);
        setIsLoading(false);
        return;
      }
    }

    let disposed = false;

    const initViewer = async () => {
      try {
        setIsLoading(true);
        const skinview3d = await import("skinview3d");

        if (disposed) return;

        if (viewerRef.current) {
          viewerRef.current.dispose();
        }

        const viewer = new skinview3d.SkinViewer({
          canvas,
          width,
          height,
          zoom,
          background: background || undefined,
        });

        viewerRef.current = viewer;

        // スキンURLを決定（カスタムスキンURL > UUID > Steve）
        const skinModel = slim ? "slim" : "default";
        const skinUrlToLoad = skinUrl || (uuid ? `/api/skin?uuid=${uuid}` : `/api/skin?uuid=${STEVE_UUID}`);

        try {
          await viewer.loadSkin(skinUrlToLoad, { model: skinModel });
        } catch {
          const steveUrl = `/api/skin?uuid=${STEVE_UUID}`;
          await viewer.loadSkin(steveUrl, { model: skinModel });
        }

        // Set camera angle
        const angleRad = (angle * Math.PI) / 180;
        const elevationRad = (elevation * Math.PI) / 180;
        viewer.camera.rotation.x = elevationRad;
        viewer.camera.rotation.y = angleRad;

        // Set animation or pose
        if (walk && !run) {
          viewer.animation = new skinview3d.WalkingAnimation();
        } else if (run) {
          viewer.animation = new skinview3d.RunningAnimation();
        } else if (pose !== "custom") {
          const poseRotations = POSE_ROTATIONS[pose];
          if (poseRotations && viewer.playerObject?.skin) {
            const skin = viewer.playerObject.skin;

            skin.head.rotation.x = poseRotations.head.x;
            skin.head.rotation.y = poseRotations.head.y;
            skin.head.rotation.z = poseRotations.head.z;

            skin.body.rotation.x = poseRotations.body.x;
            skin.body.rotation.y = poseRotations.body.y;
            skin.body.rotation.z = poseRotations.body.z;

            skin.leftArm.rotation.x = poseRotations.leftArm.x;
            skin.leftArm.rotation.y = poseRotations.leftArm.y;
            skin.leftArm.rotation.z = poseRotations.leftArm.z;

            skin.rightArm.rotation.x = poseRotations.rightArm.x;
            skin.rightArm.rotation.y = poseRotations.rightArm.y;
            skin.rightArm.rotation.z = poseRotations.rightArm.z;

            skin.leftLeg.rotation.x = poseRotations.leftLeg.x;
            skin.leftLeg.rotation.y = poseRotations.leftLeg.y;
            skin.leftLeg.rotation.z = poseRotations.leftLeg.z;

            skin.rightLeg.rotation.x = poseRotations.rightLeg.x;
            skin.rightLeg.rotation.y = poseRotations.rightLeg.y;
            skin.rightLeg.rotation.z = poseRotations.rightLeg.z;
          }
        }

        if (rotate && !effectiveAsImage) {
          viewer.autoRotate = true;
          viewer.autoRotateSpeed = 1;
        }

        if (interactive && viewer.controls) {
          viewer.controls.enableZoom = true;
          viewer.controls.enableRotate = true;
          viewer.controls.enablePan = true;
          // screenSpacePanning: 通常の右ドラッグパンを有効化（カメラ向きに依存しない）
          viewer.controls.screenSpacePanning = true;
          viewer.controls.minDistance = 20;
          viewer.controls.maxDistance = 200;
          if (typeof viewer.controls.saveState === "function") {
            viewer.controls.saveState();
          }
        }

        viewer.render();

        if (effectiveAsImage) {
          // toDataURL がレンダリング完了後の正しいフレームを拾えるよう一拍置く
          await new Promise((resolve) => setTimeout(resolve, 100));
          viewer.render();

          const dataUrl = canvas.toDataURL("image/png");

          const cacheKey = getCacheKey(skinIdentifier, pose, width, height, angle, elevation, zoom, slim);
          setCachedImage(cacheKey, dataUrl);

          setImageSrc(dataUrl);

          viewer.dispose();
          viewerRef.current = null;
        }

        setIsLoading(false);
      } catch (error) {
        console.error("Failed to initialize skinview3d:", error);
        setIsLoading(false);
      }
    };

    initViewer();

    return () => {
      disposed = true;
      if (viewerRef.current) {
        viewerRef.current.dispose();
        viewerRef.current = null;
      }
    };
    // skinIdentifier は uuid/skinUrl から派生、interactive は effectiveAsImage に内包されるので除外。
    // width/height は別 effect で setSize() を呼んで再初期化を回避するため依存に含めない。
  }, [uuid, skinUrl, pose, angle, elevation, zoom, background, walk, run, rotate, effectiveAsImage, slim]);

  // サイズ変更時は dispose せず setSize で軽量に更新
  useEffect(() => {
    const v = viewerRef.current;
    if (!v || effectiveAsImage) return;
    v.setSize(width, height);
  }, [width, height, effectiveAsImage]);

  // インタラクティブモード時、画面外では描画ループを停止して負荷を抑える
  useEffect(() => {
    if (!interactive) return;
    const canvas = canvasRef.current;
    if (!canvas || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      const v = viewerRef.current;
      if (!v) return;
      for (const entry of entries) {
        v.renderPaused = !entry.isIntersecting;
      }
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [interactive]);

  const handleReset = useCallback(() => {
    const viewer = viewerRef.current;
    if (!viewer?.controls || typeof viewer.controls.reset !== "function") return;
    viewer.controls.reset();
    viewer.render();
  }, []);

  // スケルトン表示（ローディング中）
  const skeleton = (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width,
        height,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          width: width * 0.3,
          height: height * 0.7,
          backgroundColor: "hsl(var(--muted))",
          borderRadius: 8,
          animation: "pulse 1.5s ease-in-out infinite",
        }}
      />
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 0.7; }
        }
      `}</style>
    </div>
  );

  // 静止画像モードの場合
  if (effectiveAsImage && imageSrc) {
    return (
      <img
        src={imageSrc}
        alt={mcid ? t("fullbodyViewer.avatarLabelOf", { name: mcid }) : t("fullbodyViewer.avatarLabel")}
        width={width}
        height={height}
        className={className}
        style={{
          width,
          height,
          imageRendering: "auto",
        }}
      />
    );
  }

  // asImageモードでローディング中はスケルトン + 非表示canvas
  if (effectiveAsImage && isLoading) {
    return (
      <div className={className} style={{ position: "relative", width, height }}>
        {skeleton}
        <canvas
          ref={canvasRef}
          style={{
            position: "absolute",
            opacity: 0,
            pointerEvents: "none",
          }}
          aria-hidden
        />
      </div>
    );
  }

  const showControls = interactive && !isLoading;
  const showHintBubble = showControls && showInteractiveHint && hintVisible;

  return (
    <div style={{ position: "relative", width, height }}>
      <canvas
        ref={canvasRef}
        className={className}
        style={{
          width,
          height,
          opacity: isLoading ? 0 : 1,
          transition: "opacity 0.2s",
          touchAction: interactive ? "none" : undefined,
          cursor: interactive ? "grab" : undefined,
        }}
        aria-label={mcid ? t("fullbodyViewer.avatarLabelOf", { name: mcid }) : t("fullbodyViewer.avatarLabel")}
      />
      {isLoading && skeleton}

      {showControls && (
        <div className="absolute top-1.5 right-1.5 flex items-center gap-1">
          {showInteractiveHint && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => setHintVisible((v) => !v)}
                  aria-label={hintVisible ? t("fullbodyViewer.hideHint") : t("fullbodyViewer.showHint")}
                  aria-pressed={hintVisible}
                  className={cn(
                    ICON_BUTTON_CLASS,
                    hintVisible
                      ? "bg-primary text-primary-foreground border-primary/40"
                      : "bg-background/70 hover:bg-background text-foreground/70 hover:text-foreground",
                  )}
                >
                  <HelpCircle className="w-3.5 h-3.5" aria-hidden />
                </button>
              </TooltipTrigger>
              <TooltipContent>
                {hintVisible ? t("fullbodyViewer.hideHint") : t("fullbodyViewer.showHint")}
              </TooltipContent>
            </Tooltip>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={handleReset}
                aria-label={t("fullbodyViewer.reset")}
                className={cn(
                  ICON_BUTTON_CLASS,
                  "bg-background/70 hover:bg-background text-foreground/70 hover:text-foreground",
                )}
              >
                <RotateCcw className="w-3.5 h-3.5" aria-hidden />
              </button>
            </TooltipTrigger>
            <TooltipContent>{t("fullbodyViewer.reset")}</TooltipContent>
          </Tooltip>
        </div>
      )}

      {showHintBubble && (
        <div className="absolute bottom-1.5 left-1.5 right-1.5 text-[10px] leading-tight text-center text-muted-foreground bg-background/85 backdrop-blur-sm rounded px-1.5 py-0.5 pointer-events-none">
          {t("fullbodyViewer.hintText")}
        </div>
      )}
    </div>
  );
};

export const MinecraftFullBody = memo(MinecraftFullBodyComponent);
