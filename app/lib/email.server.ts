import { Resend } from "resend";

interface FeedbackEmailParams {
  to: string;
  subject: string;
  discordId: string;
  mcid: string | null;
  displayName: string | null;
  category: string;
  message: string;
  resendApiKey: string;
}

const categoryLabels: Record<string, string> = {
  bug: "バグ報告",
  feature: "機能リクエスト",
  other: "その他",
};

export async function sendFeedbackEmail(params: FeedbackEmailParams) {
  const resend = new Resend(params.resendApiKey);

  const categoryLabel = categoryLabels[params.category] ?? "その他";

  const htmlContent = `
    <h2>ユーザーフィードバック</h2>
    <table border="1" cellpadding="8" cellspacing="0" style="border-collapse: collapse;">
      <tr>
        <th style="background: #f0f0f0;">カテゴリ</th>
        <td>${escapeHtml(categoryLabel)}</td>
      </tr>
      <tr>
        <th style="background: #f0f0f0;">Discord ID</th>
        <td>${escapeHtml(params.discordId)}</td>
      </tr>
      <tr>
        <th style="background: #f0f0f0;">MCID</th>
        <td>${escapeHtml(params.mcid ?? "未設定")}</td>
      </tr>
      <tr>
        <th style="background: #f0f0f0;">表示名</th>
        <td>${escapeHtml(params.displayName ?? "未設定")}</td>
      </tr>
    </table>
    <h3>メッセージ</h3>
    <div style="background: #f9f9f9; padding: 16px; border-radius: 8px; white-space: pre-wrap;">${escapeHtml(params.message)}</div>
  `;

  const { error } = await resend.emails.send({
    from: "Minefolio <onboarding@resend.dev>",
    to: params.to,
    subject: params.subject,
    html: htmlContent,
  });

  if (error) {
    throw new Error(`Failed to send email: ${error.message}`);
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
