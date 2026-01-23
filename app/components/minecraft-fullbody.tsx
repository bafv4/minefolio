import { useRef, useEffect, useState, memo } from "react";

const STEVE_UUID = "8667ba71b85a4004af54457a9734eed7";

// 静止画像キャッシュ（同じUUID/ポーズの組み合わせを再利用）
const imageCache = new Map<string, string>();

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

export type PoseName =
  | "standing"
  | "walking"
  | "running"
  | "waving"
  | "sitting"
  | "custom";

interface MinecraftFullBodyProps {
  uuid: string;
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
}: MinecraftFullBodyProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewerRef = useRef<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [imageSrc, setImageSrc] = useState<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // asImageモードの場合、キャッシュをチェック
    if (asImage) {
      const cacheKey = getCacheKey(uuid, pose, width, height, angle, elevation, zoom, slim);
      const cachedImage = imageCache.get(cacheKey);
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

        // Use local skin proxy API
        const skinUrl = `/api/skin?uuid=${uuid}`;
        const skinModel = slim ? "slim" : "default";

        try {
          await viewer.loadSkin(skinUrl, { model: skinModel });
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

        // Enable auto-rotate if requested (only when not rendering as image)
        if (rotate && !asImage) {
          viewer.autoRotate = true;
          viewer.autoRotateSpeed = 1;
        }

        viewer.render();

        // 静止画像として出力する場合
        if (asImage) {
          // レンダリングが完了するのを少し待つ
          await new Promise((resolve) => setTimeout(resolve, 100));
          viewer.render();

          const dataUrl = canvas.toDataURL("image/png");

          // キャッシュに保存
          const cacheKey = getCacheKey(uuid, pose, width, height, angle, elevation, zoom, slim);
          imageCache.set(cacheKey, dataUrl);

          setImageSrc(dataUrl);

          // viewerを破棄してリソースを解放
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
  }, [uuid, width, height, pose, angle, elevation, zoom, background, walk, run, rotate, asImage, slim]);

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
  if (asImage && imageSrc) {
    return (
      <img
        src={imageSrc}
        alt={mcid ? `${mcid}'s Minecraft avatar` : "Minecraft avatar"}
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
  if (asImage && isLoading) {
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
        }}
        aria-label={mcid ? `${mcid}'s Minecraft avatar` : "Minecraft avatar"}
      />
      {isLoading && skeleton}
    </div>
  );
};

export const MinecraftFullBody = memo(MinecraftFullBodyComponent);
