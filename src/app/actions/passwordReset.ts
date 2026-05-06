"use server";
import { logger } from "@/lib/logger";

import prisma from "@/lib/prisma";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { Resend } from "resend";

let _resend: Resend | null = null;
function getResend() {
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function hashToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

// FIX #6: Escape HTML in email templates to prevent injection via user names
function escapeHtml(str: string): string {
  return str.replace(/[&<>"']/g, (c) => (
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" } as Record<string, string>)[c]!
  ));
}

function buildResetEmailHtml(resetUrl: string, name: string): string {
  const safeName = escapeHtml(name);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Reset your password</title>
</head>
<body style="margin:0;padding:0;background:#09090b;font-family:'Segoe UI',Arial,sans-serif;color:#e4e4e7;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#09090b;padding:40px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#18181b;border:1px solid #27272a;border-radius:16px;overflow:hidden;max-width:600px;">
        <!-- Header -->
        <tr>
          <td style="background:#10b981;padding:32px;text-align:center;">
            <div style="display:inline-block;background:rgba(255,255,255,0.15);border-radius:12px;padding:8px 20px;">
              <span style="font-size:22px;font-weight:800;color:#fff;letter-spacing:-0.5px;">OptiAISEO</span>
            </div>
            <h1 style="margin:16px 0 0;font-size:24px;font-weight:700;color:#fff;">Reset Your Password</h1>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:40px 40px 32px;">
            <p style="margin:0 0 16px;font-size:16px;color:#a1a1aa;">Hi ${safeName},</p>
            <p style="margin:0 0 24px;font-size:15px;color:#a1a1aa;line-height:1.6;">
              We received a request to reset the password for your OptiAISEO account.
              Click the button below to choose a new password. This link expires in <strong style="color:#e4e4e7;">1 hour</strong>.
            </p>
            <!-- CTA Button -->
            <table cellpadding="0" cellspacing="0" style="margin:0 auto 32px;">
              <tr>
                <td style="background:#10b981;border-radius:10px;padding:14px 32px;">
                  <a href="${resetUrl}" style="font-size:15px;font-weight:700;color:#000;text-decoration:none;display:block;">
                    Reset Password →
                  </a>
                </td>
              </tr>
            </table>
            <!-- Security notice -->
            <div style="background:#1c1c1f;border:1px solid #27272a;border-radius:10px;padding:16px 20px;margin-bottom:24px;">
              <p style="margin:0 0 8px;font-size:13px;font-weight:600;color:#e4e4e7;">🔒 Security notice</p>
              <ul style="margin:0;padding-left:16px;font-size:13px;color:#71717a;line-height:1.7;">
                <li>This link expires in 1 hour</li>
                <li>It can only be used once</li>
                <li>If you didn't request this, you can safely ignore this email</li>
              </ul>
            </div>
            <p style="margin:0;font-size:12px;color:#52525b;">
              If the button above doesn't work, copy and paste this URL into your browser:<br/>
              <a href="${resetUrl}" style="color:#10b981;word-break:break-all;">${resetUrl}</a>
            </p>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="padding:20px 40px;border-top:1px solid #27272a;text-align:center;">
            <p style="margin:0;font-size:12px;color:#52525b;">
              OptiAISEO · You're receiving this because a password reset was requested.<br/>
              <a href="${process.env.NEXTAUTH_URL}/dashboard/settings" style="color:#71717a;">Account settings</a>
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ─── Request Password Reset ──────────────────────────────────────────────────

export async function requestPasswordReset(email: string): Promise<{ success: boolean; error?: string; provider?: string }> {
  try {
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return { success: false, error: "Please enter a valid email address." };
    }

    const normalisedEmail = email.toLowerCase().trim();

    // FIX #3: Multi-layer rate limiting — per email, per IP would be added at middleware level
    const { checkRateLimit } = await import("@/lib/rate-limit");

    // Per-email limit
    const emailRateCheck = await checkRateLimit(`pw-reset:email:${normalisedEmail}`, 3, 3600);
    if (!emailRateCheck.allowed) {
      const waitMins = Math.ceil((emailRateCheck.resetAt.getTime() - Date.now()) / 60000);
      return { success: false, error: `Too many reset requests. Please wait ${waitMins} minute(s) before trying again.` };
    }

    // Global throttle — cap total resets across all users to protect email credits
    const globalRateCheck = await checkRateLimit(`pw-reset:global`, 500, 3600);
    if (!globalRateCheck.allowed) {
      return { success: false, error: "Too many requests. Please try again later." };
    }

    const user = await prisma.user.findUnique({
      where: { email: normalisedEmail },
      select: { id: true, password: true, name: true },
    });

    // Anti-enumeration: always return success for unknown emails AND for
    // OAuth-only accounts. Revealing which provider an email uses enables
    // targeted phishing. The user will simply receive no email.
    if (!user || !user.password) return { success: true };

    // Delete existing unused tokens for this user (one active reset at a time)
    await prisma.passwordResetToken.deleteMany({
      where: { userId: user.id, used: false },
    });

    // FIX #4: Remove per-request global cleanup — this is now handled by a cron job.
    // Previously: deleteMany({ where: { OR: [{ expiresAt: { lt: new Date() } }, { used: true }] } })

    // Generate a cryptographically secure raw token
    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash, expiresAt },
    });

    const resetUrl = `${process.env.NEXTAUTH_URL}/reset-password?token=${rawToken}`;
    const displayName = user.name ?? email.split("@")[0];

    if (!process.env.RESEND_API_KEY) {
      // FIX #8: Never log the reset URL — it contains a live token
      logger.debug(`[Password Reset] Reset requested for ${normalisedEmail} (dev mode, no email sent)`);
      return { success: true };
    }

    if (!process.env.RESEND_FROM_DOMAIN) {
      logger.error("[Password Reset] RESEND_FROM_DOMAIN is not configured.");
      return { success: false, error: "Email configuration error. Please contact support." };
    }

    // FIX #2: Fire-and-forget email — don't block the response on email provider latency
    void getResend().emails.send({
      from: `OptiAISEO <noreply@${process.env.RESEND_FROM_DOMAIN}>`,
      to: normalisedEmail,
      subject: "Reset your OptiAISEO password",
      html: buildResetEmailHtml(resetUrl, displayName),
    }).catch((err: unknown) => {
      logger.error("[Password Reset] Failed to send reset email", { error: (err as Error)?.message || String(err) });
    });

    return { success: true };

  } catch (error: unknown) {
    logger.error("[Password Reset] requestPasswordReset error:", { error: (error as Error)?.message || String(error) });
    return { success: false, error: "Something went wrong. Please try again." };
  }
}

// ─── Reset Password (consume token) ─────────────────────────────────────────

export async function resetPassword(
  rawToken: string,
  newPassword: string
): Promise<{ success: boolean; error?: string; code?: "expired" | "invalid" | "used" }> {
  try {
    if (!rawToken || !newPassword) {
      return { success: false, error: "Invalid request.", code: "invalid" };
    }

    // FIX #7: Stronger password validation
    if (newPassword.length < 8) {
      return { success: false, error: "Password must be at least 8 characters." };
    }
    const strongPassword = /^(?=.*[A-Z])(?=.*[a-z])(?=.*\d).{8,}$/;
    if (!strongPassword.test(newPassword)) {
      return {
        success: false,
        error: "Password must include uppercase, lowercase, and a number.",
      };
    }

    const tokenHash = hashToken(rawToken);

    // FIX #1: Atomic token consumption — eliminates race condition.
    // updateMany with the full validity conditions means only one concurrent
    // request can win; the second sees count === 0 and is rejected.
    const result = await prisma.passwordResetToken.updateMany({
      where: {
        tokenHash,
        used: false,
        expiresAt: { gt: new Date() },
      },
      data: { used: true },
    });

    if (result.count === 0) {
      // Distinguish expired vs truly invalid for better client messaging.
      // We do a lightweight read only on failure — the hot path is the updateMany above.
      const record = await prisma.passwordResetToken.findUnique({
        where: { tokenHash },
        select: { used: true, expiresAt: true },
      });

      if (!record) {
        return { success: false, error: "This reset link is invalid. Please request a new one.", code: "invalid" };
      }
      if (record.used) {
        return { success: false, error: "This reset link has already been used. Please request a new one.", code: "used" };
      }
      // Must be expired
      return { success: false, error: "This reset link has expired (valid for 1 hour). Please request a new one.", code: "expired" };
    }

    // Token is now atomically marked used — fetch userId to update password
    const tokenRecord = await prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      select: { userId: true },
    });

    if (!tokenRecord) {
      // Extremely unlikely — token was just updated
      return { success: false, error: "Something went wrong. Please try again." };
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);

    await prisma.$transaction([
      prisma.user.update({
        where: { id: tokenRecord.userId },
        data: { password: hashedPassword },
      }),
      // Invalidate all active sessions (force re-login with new password)
      prisma.session.deleteMany({ where: { userId: tokenRecord.userId } }),
    ]);

    return { success: true };

  } catch (error: unknown) {
    logger.error("[Password Reset] resetPassword error:", { error: (error as Error)?.message || String(error) });
    return { success: false, error: "Something went wrong. Please try again." };
  }
}

// ─── Validate Token (used by reset-password page to check before rendering) ─

export async function validateResetToken(
  rawToken: string
): Promise<{ valid: boolean; emailDomain?: string }> {
  try {
    // FIX (frontend #5): Trim and length-guard to avoid querying DB with junk values
    if (!rawToken || rawToken.trim().length < 10) return { valid: false };

    const tokenHash = hashToken(rawToken.trim());
    const record = await prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      include: { user: { select: { email: true } } },
    });

    if (!record || record.used || new Date() > record.expiresAt) {
      return { valid: false };
    }

    // FIX (frontend #3): Return only the email domain, not the full address,
    // to avoid confirming account existence while still giving the user context.
    const email = record.user.email ?? "";
    const domain = email.includes("@") ? email.split("@")[1] : undefined;

    return { valid: true, emailDomain: domain };
  } catch {
    return { valid: false };
  }
}