// @vitest-environment jsdom
// クライアント側画像処理の検証。Canvas 実デコード（createImageBitmap / toBlob）は
// JSDOM に無いため、GIF 素通し・サイズ上限・デコード失敗の各分岐を検証する。
// 実画像の縮小・再エンコードはブラウザ実機での確認が必要。
import { describe, it, expect } from "vitest";
import {
  prepareImageForUpload,
  isAnimatedImageUrl,
  ImageTooLargeError,
  UnsupportedImageError,
} from "../image-processing";

function makeFile(type: string, bytes: number, name = "x"): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

describe("prepareImageForUpload", () => {
  it("GIF はアニメーション保持のため無加工で返す", async () => {
    const gif = makeFile("image/gif", 100, "anim.gif");
    const out = await prepareImageForUpload(gif, { maxDimension: 1600, maxBytes: 1000 });
    expect(out).toBe(gif);
  });

  it("上限を超える GIF は ImageTooLargeError を投げる", async () => {
    const gif = makeFile("image/gif", 2000, "big.gif");
    await expect(
      prepareImageForUpload(gif, { maxDimension: 1600, maxBytes: 1000 }),
    ).rejects.toBeInstanceOf(ImageTooLargeError);
  });

  it("デコードできない画像は UnsupportedImageError を投げる", async () => {
    // JSDOM は createImageBitmap の実デコードを持たないため失敗経路を通る
    const jpg = makeFile("image/jpeg", 100, "photo.jpg");
    await expect(
      prepareImageForUpload(jpg, { maxDimension: 1600, maxBytes: 1_000_000 }),
    ).rejects.toBeInstanceOf(UnsupportedImageError);
  });
});

// canvas 経由のトリミングに GIF を通すとアニメーションが 1 枚に潰れるため、
// GIF は全フレーム再エンコード（gif-crop.ts）へ振り分ける。その判定を担保する。
describe("isAnimatedImageUrl", () => {
  it("GIF の URL を検出する（クエリ・フラグメント付きも含む）", () => {
    expect(isAnimatedImageUrl("https://blob.example/a/b.gif")).toBe(true);
    expect(isAnimatedImageUrl("https://blob.example/a/b.GIF?v=2")).toBe(true);
    expect(isAnimatedImageUrl("https://blob.example/a/b.gif#x")).toBe(true);
  });

  it("data URL の GIF も検出する（ペースト経路の allowBase64）", () => {
    expect(isAnimatedImageUrl("data:image/gif;base64,R0lGODlh")).toBe(true);
  });

  it("GIF 以外は false", () => {
    expect(isAnimatedImageUrl("https://blob.example/a/b.webp")).toBe(false);
    expect(isAnimatedImageUrl("data:image/png;base64,iVBORw0K")).toBe(false);
    // パスに gif を含むだけの URL に誤反応しない
    expect(isAnimatedImageUrl("https://blob.example/gifs/photo.png")).toBe(false);
  });
});
