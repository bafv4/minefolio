import { describe, expect, it } from "vitest";
import { CONTRAST_INIT_SCRIPT, resolveContrast } from "@/lib/contrast";

describe("resolveContrast", () => {
  it("保存値が more ならOSの設定に関係なくオン", () => {
    expect(resolveContrast("more", false)).toBe(true);
    expect(resolveContrast("more", true)).toBe(true);
  });

  it("保存値が normal ならOSがハイコントラストでもオフ（明示の選択を優先）", () => {
    expect(resolveContrast("normal", true)).toBe(false);
    expect(resolveContrast("normal", false)).toBe(false);
  });

  it("保存値なしはOSの設定に従う", () => {
    expect(resolveContrast(null, true)).toBe(true);
    expect(resolveContrast(null, false)).toBe(false);
    expect(resolveContrast(undefined, true)).toBe(true);
  });

  it("不正な保存値は無いものとして扱う", () => {
    expect(resolveContrast("", true)).toBe(true);
    expect(resolveContrast("MORE", false)).toBe(false);
    expect(resolveContrast("1", false)).toBe(false);
  });
});

describe("CONTRAST_INIT_SCRIPT", () => {
  function run(stored: string | null, osMore: boolean, storageThrows = false): string | null {
    const attrs = new Map<string, string>();
    const sandbox = {
      localStorage: {
        getItem: () => {
          if (storageThrows) throw new Error("denied");
          return stored;
        },
      },
      matchMedia: () => ({ matches: osMore }),
      document: { documentElement: { setAttribute: (k: string, v: string) => attrs.set(k, v) } },
    };
    new Function("localStorage", "window", "document", CONTRAST_INIT_SCRIPT)(
      sandbox.localStorage,
      sandbox,
      sandbox.document,
    );
    return attrs.get("data-contrast") ?? null;
  }

  it("resolveContrast と同じ判定で属性を付ける", () => {
    for (const stored of ["more", "normal", null, "x"]) {
      for (const os of [true, false]) {
        expect(run(stored, os)).toBe(resolveContrast(stored, os) ? "more" : null);
      }
    }
  });

  it("localStorage が使えなくてもOSの設定で判定する", () => {
    expect(run(null, true, true)).toBe("more");
    expect(run(null, false, true)).toBeNull();
  });
});
