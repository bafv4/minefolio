// /og-image の「非公開プロフィールのPIIを公開OGP画像に出さない」ガードの回帰テスト。
//
// OGP画像は s-maxage=86400 で共有CDNに1日残るため、ここが退行しても画面上は無症状のまま
// 非公開プロフィールの表示名・bio・MCID が拡散する（本人判定ができない経路なので、
// 非公開ならブランド画像へ倒すのが唯一の防御）。
//
// @vercel/og の ImageResponse（satori/wasm）と外部fetch（Googleフォント・アイコン・スキン）は
// 境界なのでモックし、「ImageResponse へ渡された要素ツリーに何が描かれるか」を検証する。
// ユーザー解決は実DBのまま。
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  createTestDbAt,
  seedUser,
  SHARED_MEMORY_URL,
  type TestDb,
} from "@/lib/__tests__/helpers/test-db";

const ogMocks = vi.hoisted(() => ({
  imageResponse: vi.fn(),
}));

// ImageResponse は「渡された要素とオプションを記録し、素の Response を返す」だけにする
vi.mock("@vercel/og", () => ({
  ImageResponse: class {
    constructor(element: unknown, options: unknown) {
      ogMocks.imageResponse(element, options);
      const headers = (options as { headers?: Record<string, string> } | undefined)?.headers;
      return new Response("fake-png", { status: 200, headers });
    }
  },
}));

import { loader } from "../og-image";

const ENV_KEYS = ["TURSO_DATABASE_URL"] as const;
const originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

let db: TestDb;
let fetchMock: ReturnType<typeof vi.fn>;

/** 非公開ユーザーのPII（このいずれもOGP画像に出てはいけない） */
const PRIVATE_PII = {
  displayName: "Hidden Runner",
  mcid: "HiddenMcid",
  bio: "非公開のプロフィール本文",
  shortBio: "非公開の一言",
};

async function callLoader(search: string): Promise<Response> {
  const request = new Request(`https://minefolio.app/og-image${search}`);
  return loader({ request, params: {}, context: {} } as never);
}

/** 要素ツリーから描画されるテキストを集める */
function collectText(node: unknown, out: string[] = []): string[] {
  if (node === null || node === undefined || typeof node === "boolean") return out;
  if (typeof node === "string" || typeof node === "number") {
    out.push(String(node));
    return out;
  }
  if (Array.isArray(node)) {
    for (const child of node) collectText(child, out);
    return out;
  }
  if (typeof node === "object") {
    const props = (node as { props?: { children?: unknown } }).props;
    if (props) collectText(props.children, out);
  }
  return out;
}

/** 直近の ImageResponse に渡された要素ツリーの全テキスト */
function renderedText(): string {
  const call = ogMocks.imageResponse.mock.calls.at(-1);
  if (!call) throw new Error("ImageResponse が生成されていない");
  return collectText(call[0]).join(" ");
}

/** 直近の ImageResponse に渡されたオプション */
function renderedOptions(): { headers?: Record<string, string> } {
  const call = ogMocks.imageResponse.mock.calls.at(-1);
  if (!call) throw new Error("ImageResponse が生成されていない");
  return call[1] as { headers?: Record<string, string> };
}

/** fetch されたURL一覧 */
function fetchedUrls(): string[] {
  return fetchMock.mock.calls.map((call) => String(call[0]));
}

beforeEach(async () => {
  vi.clearAllMocks();
  for (const key of ENV_KEYS) originalEnv[key] = process.env[key];
  process.env.TURSO_DATABASE_URL = SHARED_MEMORY_URL;
  db = await createTestDbAt(SHARED_MEMORY_URL);

  // フォント・アイコン・スキンの取得はすべて失敗させる（バンドル既定フォント/プレースホルダーへ倒れる）。
  // ネットワークに出ないことと、取得結果に依存せず判定できることの両方を担保する
  fetchMock = vi.fn(async () => ({
    ok: false,
    status: 500,
    headers: new Headers(),
    text: async () => "",
    json: async () => ({}),
    arrayBuffer: async () => new ArrayBuffer(0),
  }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

async function seedPrivateUser() {
  return seedUser(db, {
    slug: "hidden",
    discordId: "discord-hidden",
    profileVisibility: "private",
    role: "runner",
    mainEdition: "java",
    uuid: "0123456789abcdef0123456789abcdef",
    ...PRIVATE_PII,
  });
}

describe("非公開プロフィール", () => {
  it("slug 指定でも走者画像を描かず、PII を一切含めない", async () => {
    await seedPrivateUser();

    const res = await callLoader("?slug=hidden");

    expect(res.status).toBe(200);
    expect(ogMocks.imageResponse).toHaveBeenCalledTimes(1);

    const text = renderedText();
    expect(text).not.toContain(PRIVATE_PII.displayName);
    expect(text).not.toContain(PRIVATE_PII.mcid);
    expect(text).not.toContain(PRIVATE_PII.bio);
    expect(text).not.toContain(PRIVATE_PII.shortBio);
    // 既定のブランド画像へ倒れている
    expect(text).toContain("Minefolio");
    expect(text).toContain("Minecraft Speedrunning + Portfolio");
  });

  it("mcid 指定でも同じくブランド画像に倒れる", async () => {
    await seedPrivateUser();

    const res = await callLoader(`?mcid=${PRIVATE_PII.mcid}`);

    expect(res.status).toBe(200);
    expect(renderedText()).not.toContain(PRIVATE_PII.displayName);
    expect(renderedText()).toContain("Minefolio");
  });

  it("スキン（/api/skin）を取りにいかない（顔アバターも出さない）", async () => {
    await seedPrivateUser();

    await callLoader("?slug=hidden");

    expect(fetchedUrls().some((url) => url.includes("/api/skin"))).toBe(false);
  });

  it("title / description クエリで PII を上書き注入できない", async () => {
    await seedPrivateUser();

    // 非公開判定に入った時点で、クエリ由来の title/description も使わずブランド固定になる
    await callLoader("?slug=hidden&title=Leaked&description=LeakedBio");

    const text = renderedText();
    expect(text).not.toContain("Leaked");
    expect(text).toContain("Minefolio");
  });
});

describe("公開プロフィール（対照）", () => {
  it("表示名・MCID・bio が描画される", async () => {
    await seedUser(db, {
      slug: "open",
      discordId: "discord-open",
      profileVisibility: "public",
      displayName: "Open Runner",
      mcid: "OpenMcid",
      shortBio: "公開の一言",
      role: "runner",
      mainEdition: "java",
    });

    const res = await callLoader("?slug=open");

    expect(res.status).toBe(200);
    const text = renderedText();
    expect(text).toContain("Open Runner");
    expect(text).toContain("OpenMcid");
    expect(text).toContain("公開の一言");
  });
});

describe("存在しないユーザー", () => {
  it("404 を返し、画像を生成しない", async () => {
    const res = await callLoader("?slug=no-such-user");

    expect(res.status).toBe(404);
    expect(ogMocks.imageResponse).not.toHaveBeenCalled();
  });
});

describe("キャッシュヘッダー", () => {
  it("非公開時の既定画像も 1日 CDN キャッシュされる（＝退行が長期化するため出力内容が重要）", async () => {
    await seedPrivateUser();

    await callLoader("?slug=hidden");

    expect(renderedOptions().headers?.["Cache-Control"]).toContain("s-maxage=86400");
  });
});
