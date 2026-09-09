// /feedback action の回帰テスト。
//
// GitHub Issue自動作成（オプトイン）まわりの分岐を中心に検証する:
//   - createIssue オフ、または GITHUB_FEEDBACK_TOKEN 未設定時は createFeedbackIssue を呼ばない
//   - createIssue オンかつトークン設定時は createFeedbackIssue を呼び、成功すれば issueUrl を返す
//   - Issue本文に個人情報（discordId/mcid/displayName）を一切含めない
//   - Issue作成が失敗してもフィードバック送信全体は成功扱い（issueCreateFailed: true）
//
// セッションのモック方針は app/routes/me/__tests__/edit.test.ts と同じ（実DB + セッションのみモック）。
// メール送信（Resend）とGitHub API呼び出しは外部通信のためモックする。
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  createTestDbAt,
  seedUser,
  SHARED_MEMORY_URL,
  type TestDb,
} from "@/lib/__tests__/helpers/test-db";

const sessionMocks = vi.hoisted(() => ({
  getOptionalSession: vi.fn(),
  getSession: vi.fn(),
  getCurrentUser: vi.fn(),
  getCurrentUserOrOnboarding: vi.fn(),
  isAuthenticated: vi.fn(),
}));
vi.mock("@/lib/session", () => sessionMocks);

const sendFeedbackEmailMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/email.server", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/email.server")>("@/lib/email.server");
  return {
    ...actual,
    sendFeedbackEmail: sendFeedbackEmailMock,
  };
});

const createFeedbackIssueMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/github.server", () => ({
  createFeedbackIssue: createFeedbackIssueMock,
}));

import { action } from "../feedback";

const ENV_KEYS = [
  "TURSO_DATABASE_URL",
  "BETTER_AUTH_SECRET",
  "APP_URL",
  "FEEDBACK_EMAIL",
  "RESEND_API_KEY",
  "GITHUB_FEEDBACK_TOKEN",
  "GITHUB_FEEDBACK_REPO",
] as const;
const originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

let db: TestDb;

function makeRequest(formData: FormData): Request {
  return new Request("https://minefolio.app/feedback", {
    method: "POST",
    body: formData,
  });
}

async function callAction(formData: FormData) {
  return action({ request: makeRequest(formData), params: {}, context: {} } as never);
}

function signInAs(discordId: string) {
  sessionMocks.getSession.mockResolvedValue({ user: { id: discordId } });
}

function baseFormData(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData();
  const defaults: Record<string, string> = {
    subject: "テストの件名です",
    message: "これはテスト用のフィードバック本文です。十分な長さがあります。",
    category: "bug",
    createIssue: "false",
  };
  for (const [k, v] of Object.entries({ ...defaults, ...overrides })) {
    fd.set(k, v);
  }
  return fd;
}

beforeEach(async () => {
  vi.clearAllMocks();
  for (const key of ENV_KEYS) originalEnv[key] = process.env[key];
  process.env.TURSO_DATABASE_URL = SHARED_MEMORY_URL;
  process.env.BETTER_AUTH_SECRET = "test-secret";
  process.env.APP_URL = "https://minefolio.app";
  process.env.FEEDBACK_EMAIL = "feedback@example.com";
  process.env.RESEND_API_KEY = "test-resend-key";
  delete process.env.GITHUB_FEEDBACK_TOKEN;
  delete process.env.GITHUB_FEEDBACK_REPO;
  db = await createTestDbAt(SHARED_MEMORY_URL);
  sendFeedbackEmailMock.mockResolvedValue(undefined);

  const user = await seedUser(db, {
    slug: "runner",
    discordId: "discord-runner",
    mcid: "RunnerMc",
    displayName: "Runner Display",
  });
  signInAs(user.discordId);
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

describe("GITHUB_FEEDBACK_TOKEN 未設定", () => {
  it("createIssue=true でも Issue作成を試みず、メール送信のみで成功する", async () => {
    const result = await callAction(baseFormData({ createIssue: "true" }));

    expect(createFeedbackIssueMock).not.toHaveBeenCalled();
    expect(sendFeedbackEmailMock).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ success: true, issueUrl: undefined, issueCreateFailed: false });
  });
});

describe("GITHUB_FEEDBACK_TOKEN 設定済み", () => {
  beforeEach(() => {
    process.env.GITHUB_FEEDBACK_TOKEN = "fine-grained-pat";
  });

  it("createIssue=false では Issue作成を試みない", async () => {
    const result = await callAction(baseFormData({ createIssue: "false" }));

    expect(createFeedbackIssueMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({ success: true, issueUrl: undefined, issueCreateFailed: false });
  });

  it("createIssue=true では Issue を作成し、成功時は issueUrl を返す", async () => {
    createFeedbackIssueMock.mockResolvedValue({
      url: "https://github.com/bafv4/minefolio/issues/42",
      number: 42,
    });

    const result = await callAction(
      baseFormData({ createIssue: "true", category: "bug", subject: "バグを見つけました" }),
    );

    expect(createFeedbackIssueMock).toHaveBeenCalledTimes(1);
    const callArgs = createFeedbackIssueMock.mock.calls[0][0];
    expect(callArgs.token).toBe("fine-grained-pat");
    expect(callArgs.repo).toBe("bafv4/minefolio"); // GITHUB_FEEDBACK_REPO未設定時のデフォルト
    expect(callArgs.title).toBe("バグを見つけました");
    expect(callArgs.labels).toEqual(["feedback", "bug"]);

    // Issue本文に個人情報（discordId/mcid/displayName）が一切含まれないこと
    expect(callArgs.body).not.toContain("discord-runner");
    expect(callArgs.body).not.toContain("RunnerMc");
    expect(callArgs.body).not.toContain("Runner Display");
    expect(callArgs.body).toMatch(/Feedback-ID: [a-z0-9]{8}/);

    expect(result).toMatchObject({
      success: true,
      issueUrl: "https://github.com/bafv4/minefolio/issues/42",
      issueCreateFailed: false,
    });

    // メールに渡す相関IDと Issue本文の Feedback-ID が同一値であること（突き合わせ可能性の担保）
    const emailArgs = sendFeedbackEmailMock.mock.calls[0][0];
    expect(emailArgs.feedbackId).toMatch(/^[a-z0-9]{8}$/);
    expect(callArgs.body).toContain(`Feedback-ID: ${emailArgs.feedbackId}`);
  });

  it("category=feature では enhancement ラベルが付く", async () => {
    createFeedbackIssueMock.mockResolvedValue({ url: "https://example.com/1", number: 1 });

    await callAction(baseFormData({ createIssue: "true", category: "feature" }));

    const callArgs = createFeedbackIssueMock.mock.calls[0][0];
    expect(callArgs.labels).toEqual(["feedback", "enhancement"]);
  });

  it("category=other では feedback ラベルのみ", async () => {
    createFeedbackIssueMock.mockResolvedValue({ url: "https://example.com/1", number: 1 });

    await callAction(baseFormData({ createIssue: "true", category: "other" }));

    const callArgs = createFeedbackIssueMock.mock.calls[0][0];
    expect(callArgs.labels).toEqual(["feedback"]);
  });

  it("Issue作成が失敗してもフィードバック送信全体は成功扱いになる", async () => {
    createFeedbackIssueMock.mockRejectedValue(new Error("GitHub API error"));

    const result = await callAction(baseFormData({ createIssue: "true" }));

    expect(sendFeedbackEmailMock).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ success: true, issueUrl: undefined, issueCreateFailed: true });
  });

  it("メール送信が失敗した場合は Issue を作成せずエラーを返す（孤児Issue・重複Issueの防止）", async () => {
    sendFeedbackEmailMock.mockRejectedValue(new Error("Resend down"));

    const result = await callAction(baseFormData({ createIssue: "true" }));

    expect(createFeedbackIssueMock).not.toHaveBeenCalled();
    expect(result).toHaveProperty("error");
    expect(result).not.toHaveProperty("success");
  });

  it("バリデーション失敗時はメール送信もIssue作成も行わない（検証前に副作用なし）", async () => {
    const result = await callAction(
      baseFormData({ createIssue: "true", subject: "abc" }), // 5文字未満で検証エラー
    );

    expect(sendFeedbackEmailMock).not.toHaveBeenCalled();
    expect(createFeedbackIssueMock).not.toHaveBeenCalled();
    expect(result).toHaveProperty("error");
  });

  it("GITHUB_FEEDBACK_REPO を設定するとそのリポジトリに作成する", async () => {
    process.env.GITHUB_FEEDBACK_REPO = "example-org/example-repo";
    createFeedbackIssueMock.mockResolvedValue({ url: "https://example.com/1", number: 1 });

    await callAction(baseFormData({ createIssue: "true" }));

    const callArgs = createFeedbackIssueMock.mock.calls[0][0];
    expect(callArgs.repo).toBe("example-org/example-repo");
  });
});
