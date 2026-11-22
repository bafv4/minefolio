// requireApiUser の Origin 確認（rejectCrossOriginMutation）。フレームワークの
// throwIfPotentialCSRFAttack（react-router lib/actions.js）と同じ判定になることを固定する。
import { describe, it, expect, vi } from "vitest";
import { rejectCrossOriginMutation, requireApiUser } from "../api-auth.server";

function req(method: string, origin?: string) {
  return new Request("https://minefolio.app/api/me/skin", {
    method,
    headers: origin === undefined ? {} : { origin },
  });
}

describe("rejectCrossOriginMutation", () => {
  it("同一 origin は通す", () => {
    expect(rejectCrossOriginMutation(req("POST", "https://minefolio.app"))).toBeNull();
  });

  it("別 origin の mutation は 403", async () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const res = rejectCrossOriginMutation(req(method, "https://evil.example"));
      expect(res?.status).toBe(403);
    }
    // ポート違い・スキーム違いも別 origin
    expect(rejectCrossOriginMutation(req("POST", "http://minefolio.app"))?.status).toBe(403);
    expect(rejectCrossOriginMutation(req("POST", "https://minefolio.app:8443"))?.status).toBe(403);
  });

  it("origin ヘッダなしは通す", () => {
    expect(rejectCrossOriginMutation(req("POST"))).toBeNull();
  });

  it('"null" と不正な形の origin は 403', () => {
    expect(rejectCrossOriginMutation(req("POST", "null"))?.status).toBe(403);
    expect(rejectCrossOriginMutation(req("POST", "not a url"))?.status).toBe(403);
  });

  it("GET は確認しない", () => {
    expect(rejectCrossOriginMutation(req("GET", "https://evil.example"))).toBeNull();
  });
});

describe("requireApiUser", () => {
  it("別 origin の mutation は認証より前に 403 で、セッションを読まない", async () => {
    const getSession = vi.fn();
    const auth = { api: { getSession } } as never;
    const db = {} as never;
    const result = await requireApiUser(db, auth, req("POST", "https://evil.example"), []);
    expect(result.response?.status).toBe(403);
    expect(getSession).not.toHaveBeenCalled();
  });
});
