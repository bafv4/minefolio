// loadUserByDiscordId（session.ts）: 同一 Request 内の users 行の読み取り共有。
import { describe, it, expect, vi } from "vitest";
import { loadUserByDiscordId } from "../session";
import type { Database } from "../db";

function fakeDb(rows: Record<string, unknown>[] = [{ id: "u1", discordId: "d1", mcid: "abc" }]) {
  const findFirst = vi.fn(async () => rows[0]);
  return { db: { query: { users: { findFirst } } } as unknown as Database, findFirst };
}

describe("loadUserByDiscordId", () => {
  it("同じ Request では DB を1回だけ読む（並列呼び出しも）", async () => {
    const { db, findFirst } = fakeDb();
    const request = new Request("https://minefolio.app/");
    const [a, b] = await Promise.all([
      loadUserByDiscordId(request, db, "d1"),
      loadUserByDiscordId(request, db, "d1"),
    ]);
    await loadUserByDiscordId(request, db, "d1");
    expect(findFirst).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
  });

  it("別の Request では読み直す", async () => {
    const { db, findFirst } = fakeDb();
    await loadUserByDiscordId(new Request("https://minefolio.app/"), db, "d1");
    await loadUserByDiscordId(new Request("https://minefolio.app/"), db, "d1");
    expect(findFirst).toHaveBeenCalledTimes(2);
  });

  it("discordId が違えば別に読む", async () => {
    const { db, findFirst } = fakeDb();
    const request = new Request("https://minefolio.app/");
    await loadUserByDiscordId(request, db, "d1");
    await loadUserByDiscordId(request, db, "d2");
    expect(findFirst).toHaveBeenCalledTimes(2);
  });

  it("返した行を書き換えても他の呼び出しへ波及しない", async () => {
    const { db } = fakeDb();
    const request = new Request("https://minefolio.app/");
    const a = await loadUserByDiscordId(request, db, "d1");
    a!.mcid = "changed";
    const b = await loadUserByDiscordId(request, db, "d1");
    expect(b!.mcid).toBe("abc");
  });

  it("行が無ければ undefined を返し、失敗は共有し続けない", async () => {
    const findFirst = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce(undefined);
    const db = { query: { users: { findFirst } } } as unknown as Database;
    const request = new Request("https://minefolio.app/");
    await expect(loadUserByDiscordId(request, db, "d1")).rejects.toThrow("boom");
    await expect(loadUserByDiscordId(request, db, "d1")).resolves.toBeUndefined();
    expect(findFirst).toHaveBeenCalledTimes(2);
  });
});
