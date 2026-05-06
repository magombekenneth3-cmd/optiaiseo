import { logger } from "@/lib/logger";
import { Resend } from "resend";

let _resend: Resend | null = null;
function getResend() {
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}

export interface PrNotificationData {
  domain: string;
  repoName: string;
  prUrl: string;
  fixCount: number;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function validatePrUrl(prUrl: string): boolean {
  try {
    const url = new URL(prUrl);
    return url.hostname === "github.com";
  } catch {
    return false;
  }
}

function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function maskEmail(email: string): string {
  return email.replace(/(.{2}).+(@.+)/, "$1***$2");
}

const buildPrHtml = (data: PrNotificationData): string => {
  const baseUrl = process.env.NEXTAUTH_URL ?? "";
  const domain = escapeHtml(data.domain);
  const repoName = escapeHtml(data.repoName);
  const prUrl = escapeHtml(data.prUrl);
  const fixCount = Number(data.fixCount);

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333; }
    .header { background: #2563eb; color: #fff; padding: 24px; text-align: center; }
    .section { padding: 20px; border-bottom: 1px solid #eee; }
    .footer { padding: 20px; text-align: center; color: #999; font-size: 12px; }
    .btn { background: #10b981; color: #fff; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block; margin-top: 20px; font-weight: bold; }
    .highlight { font-weight: bold; color: #1e40af; }
  </style>
</head>
<body>
  <div class="header">
    <h1>New OptiAISEO Fixes Ready</h1>
    <p>${domain}</p>
  </div>
  <div class="section">
    <p>Good news! Our Self-Healing Engine has automatically generated <span class="highlight">${fixCount} SEO fix${fixCount > 1 ? "es" : ""}</span> for your site.</p>
    <p>A new Pull Request has been opened on your repository: <strong>${repoName}</strong></p>
    <p>These changes are designed to improve your search rankings and AI visibility. Please review and merge them at your convenience.</p>
    <div style="text-align: center;">
      <a href="${prUrl}" class="btn">Review Pull Request</a>
    </div>
  </div>
  <div class="footer">
    <p>You're receiving this because you have OptiAISEO Self-Healing enabled.</p>
    <p><a href="${baseUrl}/dashboard/settings?tab=notifications">Manage email preferences</a></p>
    <p><a href="${baseUrl}/dashboard/settings?tab=notifications">Unsubscribe</a></p>
  </div>
</body>
</html>
`;
};

const buildPrText = (data: PrNotificationData): string =>
  `New PR created for ${data.domain}: ${data.prUrl}\n\nRepository: ${data.repoName}\nFixes: ${data.fixCount}\n\nManage preferences: ${process.env.NEXTAUTH_URL ?? ""}/dashboard/settings?tab=notifications`;

export const sendPrNotification = async (
  toEmail: string,
  data: PrNotificationData
): Promise<{ success: boolean; error?: string }> => {
  if (!process.env.RESEND_API_KEY) {
    logger.warn(`[Email] RESEND_API_KEY not set — PR notification NOT sent to: ${maskEmail(toEmail)}`);
    return { success: false, error: "Email service not configured." };
  }

  if (!process.env.RESEND_FROM_DOMAIN) {
    logger.error("[Email] RESEND_FROM_DOMAIN is not set — PR notification NOT sent.");
    return { success: false, error: "Email sender domain not configured." };
  }

  if (!validateEmail(toEmail)) {
    logger.warn("[Email] Invalid recipient email — PR notification NOT sent.");
    return { success: false, error: "Invalid recipient email." };
  }

  if (!validatePrUrl(data.prUrl)) {
    logger.warn("[Email] Invalid PR URL — PR notification NOT sent.");
    return { success: false, error: "Invalid PR URL." };
  }

  const baseUrl = process.env.NEXTAUTH_URL ?? "";

  try {
    const result = await getResend().emails.send({
      from: `OptiAISEO <noreply@${process.env.RESEND_FROM_DOMAIN}>`,
      to: toEmail,
      subject: `${data.fixCount} SEO fix${data.fixCount > 1 ? "es" : ""} ready for ${data.domain}`,
      html: buildPrHtml(data),
      text: buildPrText(data),
      headers: {
        "List-Unsubscribe": `<${baseUrl}/dashboard/settings?tab=notifications>`,
      },
    });
    logger.debug(`[Email] Sent PR notification to ${maskEmail(toEmail)}`, { result });
    return { success: true };
  } catch (err: unknown) {
    logger.error("[Email] Failed to send PR notification:", { error: (err as Error)?.message || String(err) });
    return { success: false, error: (err as Error).message };
  }
};