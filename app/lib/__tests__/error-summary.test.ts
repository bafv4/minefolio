import { describe, it, expect } from "vitest";
import { DrizzleQueryError } from "drizzle-orm/errors";
import { errorSummary } from "../error-summary";

describe("errorSummary", () => {
  it("drizzle のクエリエラーは、パラメータ（入力値）を含めず SQL 文と原因だけにする", () => {
    const cause = new Error("SQLITE_CONSTRAINT: UNIQUE constraint failed: users.slug");
    const error = new DrizzleQueryError('update "users" set "bio" = ? where "id" = ?', ["とても個人的な自己紹介", "user-1"], cause);

    // 元の message には入力値が入っている（これをそのままログに出さない）
    expect(error.message).toContain("とても個人的な自己紹介");

    const summary = errorSummary(error);
    expect(summary).not.toContain("とても個人的な自己紹介");
    expect(summary).not.toContain("user-1");
    expect(summary).toContain('update "users" set "bio" = ?');
    expect(summary).toContain("UNIQUE constraint failed: users.slug");
  });

  it("原因が無いクエリエラーでも、パラメータは出さない", () => {
    const error = new DrizzleQueryError("select 1 where x = ?", ["secret"]);
    expect(errorSummary(error)).not.toContain("secret");
  });

  it("ふつうの Error は名前とメッセージ、Error 以外は固定の文言にする", () => {
    expect(errorSummary(new TypeError("boom"))).toBe("TypeError: boom");
    expect(errorSummary("plain")).toBe("plain");
    expect(errorSummary({ secret: "x" })).toBe("non-Error value thrown");
  });
});
