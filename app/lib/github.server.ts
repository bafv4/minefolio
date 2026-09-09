/**
 * GitHub Issues API クライアント（フィードバックの自動 Issue 化用）。
 * fine-grained PAT（GITHUB_FEEDBACK_TOKEN）が必要。未設定時は呼び出し元で機能ごと無効化する。
 */

const GITHUB_API_BASE = "https://api.github.com";
const USER_AGENT = "Minefolio/1.0 (https://minefolio.app)";
const REQUEST_TIMEOUT_MS = 10_000;

interface CreateFeedbackIssueParams {
  token: string;
  repo: string;
  title: string;
  body: string;
  labels: string[];
}

interface CreateFeedbackIssueResult {
  url: string;
  number: number;
}

export async function createFeedbackIssue(
  params: CreateFeedbackIssueParams,
): Promise<CreateFeedbackIssueResult> {
  const { token, repo, title, body, labels } = params;

  const response = await fetch(`${GITHUB_API_BASE}/repos/${repo}/issues`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": USER_AGENT,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ title, body, labels }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `GitHub Issue の作成に失敗しました (status: ${response.status}): ${errorBody}`,
    );
  }

  const data = (await response.json()) as { html_url: string; number: number };
  return { url: data.html_url, number: data.number };
}
