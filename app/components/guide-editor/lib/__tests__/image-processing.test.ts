// @vitest-environment jsdom
// クライアント側画像処理の検証。Canvas 実デコード（createImageBitmap / toBlob）は
// JSDOM に無いため、GIF 素通し・サイズ上限・デコード失敗の各分岐を検証する。
// 実画像の縮小・再エンコードはブラウザ実機での確認が必要。
import { describe, it, expect } from "vitest";
import {
  prepareImageForUpload,
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
