// Minecraftアバター（頭部）の描画をクライアント側でキャッシュする。
// アプリ全体（一覧・カード・ランキング等）で共有される module レベルのシングルトン。
//
// 2層キャッシュ:
//   1. スキン画像キャッシュ（サイズ非依存）: 同じプレイヤーのスキンPNGはアプリ全体で1度だけ fetch する。
//   2. 描画結果(data URL)キャッシュ（サイズ別）: 再描画・再表示を即座に行う。
//
// 一覧系ページではプレイヤーが様々なサイズ（28/36/48px 等）で繰り返し表示されるため、
// スキン画像を共有することでネットワーク取得を大幅に削減できる。

const STEVE_UUID = "8667ba71b85a4004af54457a9734eed7";
const HEAD_BASE = { x: 8, y: 8, width: 8, height: 8 };
const HEAD_OVERLAY = { x: 40, y: 8, width: 8, height: 8 };

export interface RenderAvatarOptions {
  uuid: string | null | undefined;
  skinUrl?: string | null;
  size?: number;
  overlay?: boolean;
}

// スキン画像キャッシュ（キー: 解決済みスキンURL）— サイズ非依存
const skinCache = new Map<string, HTMLImageElement>();
const skinInflight = new Map<string, Promise<HTMLImageElement>>();

// 描画結果(data URL)キャッシュ（キー: 解決済みスキンURL|size|overlay）
const dataUrlCache = new Map<string, string>();
const dataUrlInflight = new Map<string, Promise<string>>();

function resolveSkinUrl({ uuid, skinUrl }: RenderAvatarOptions): string {
  const targetUuid = uuid || STEVE_UUID;
  return skinUrl || `/api/skin?uuid=${targetUuid}`;
}

function dataUrlKey(options: RenderAvatarOptions): string {
  const { size = 64, overlay = true } = options;
  return `${resolveSkinUrl(options)}|${size}|${overlay}`;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

/**
 * スキン画像を読み込む（成功時のみキャッシュ）。
 * 取得失敗時は Steve スキンにフォールバックするが、要求URLには紐付けない
 * （一時的な失敗で恒久的にSteveにならないよう、次回マウントで再試行できるようにする）。
 */
function loadSkin(options: RenderAvatarOptions): Promise<HTMLImageElement> {
  const url = resolveSkinUrl(options);

  const cached = skinCache.get(url);
  if (cached) return Promise.resolve(cached);

  const existing = skinInflight.get(url);
  if (existing) return existing;

  const fallbackUrl = `/api/skin?uuid=${STEVE_UUID}`;
  const promise = loadImage(url)
    .then((img) => {
      skinCache.set(url, img);
      skinInflight.delete(url);
      return img;
    })
    .catch(async () => {
      skinInflight.delete(url);
      // Steve はキャッシュして共有（フォールバックの繰り返し取得を避ける）
      const steveCached = skinCache.get(fallbackUrl);
      if (steveCached) return steveCached;
      const steve = await loadImage(fallbackUrl);
      skinCache.set(fallbackUrl, steve);
      return steve;
    });

  skinInflight.set(url, promise);
  return promise;
}

/** 読み込み済みスキン画像から指定サイズのアバターを同期的に合成して data URL を返す。 */
function composite(skinImage: HTMLImageElement, size: number, overlay: boolean): string {
  // オーバーレイを少し大きく描画するための設定
  // 角丸でもはみ出ないよう、控えめなスケールに調整
  const overlayScale = 1.0625; // 約6.25%大きく（17/16）
  const padding = Math.ceil(size * 0.05); // 5%のパディング

  const outputCanvas = document.createElement("canvas");
  outputCanvas.width = size;
  outputCanvas.height = size;
  const outputCtx = outputCanvas.getContext("2d");
  if (!outputCtx) throw new Error("Canvas 2D context unavailable");

  outputCtx.imageSmoothingEnabled = false;

  // 描画領域（パディングを考慮）
  const drawArea = size - padding * 2;

  // ベースレイヤーの描画サイズを計算
  const baseDrawSize = overlay ? Math.floor(drawArea / overlayScale) : drawArea;
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

  return outputCanvas.toDataURL("image/png");
}

/**
 * 即座に表示できる data URL を返す（描画コストなしで表示できる場合のみ）。
 * - 描画結果がキャッシュ済みならそれを返す。
 * - スキン画像がキャッシュ済みなら、その場で合成（同期）して返す。
 *   → 別サイズ・別ページで既に取得済みのプレイヤーは、初回描画からちらつきなく表示できる。
 * どちらも無ければ undefined（呼び出し側は renderAvatar で非同期取得する）。
 */
export function getRenderableAvatar(options: RenderAvatarOptions): string | undefined {
  const key = dataUrlKey(options);
  const cached = dataUrlCache.get(key);
  if (cached) return cached;

  const skinImage = skinCache.get(resolveSkinUrl(options));
  if (skinImage) {
    const dataUrl = composite(skinImage, options.size ?? 64, options.overlay ?? true);
    dataUrlCache.set(key, dataUrl);
    return dataUrl;
  }

  return undefined;
}

/**
 * アバターを描画して data URL を返す。スキン画像・描画結果ともにキャッシュされ、
 * 同一プレイヤーのスキン取得はアプリ全体で1度だけ行われる。
 */
export function renderAvatar(options: RenderAvatarOptions): Promise<string> {
  const key = dataUrlKey(options);

  const cached = dataUrlCache.get(key);
  if (cached) return Promise.resolve(cached);

  const existing = dataUrlInflight.get(key);
  if (existing) return existing;

  const promise = loadSkin(options)
    .then((skinImage) => {
      const dataUrl = composite(skinImage, options.size ?? 64, options.overlay ?? true);
      dataUrlCache.set(key, dataUrl);
      dataUrlInflight.delete(key);
      return dataUrl;
    })
    .catch((err) => {
      dataUrlInflight.delete(key);
      throw err;
    });

  dataUrlInflight.set(key, promise);
  return promise;
}

/**
 * 複数プレイヤーのスキンを順次プリロードしてキャッシュをウォームアップする。
 * 一覧系ページの loader 後などに呼ぶと、以降の表示（別サイズ含む）が即座になる。
 * 戻り値の関数を呼ぶと中断できる。
 */
export function warmAvatars(
  players: ReadonlyArray<{ uuid: string | null | undefined; customSkinUrl?: string | null }>
): () => void {
  let cancelled = false;
  (async () => {
    for (const player of players) {
      if (cancelled) break;
      try {
        await loadSkin({ uuid: player.uuid, skinUrl: player.customSkinUrl });
      } catch {
        // 個別の取得失敗は無視して次へ
      }
    }
  })();
  return () => {
    cancelled = true;
  };
}
