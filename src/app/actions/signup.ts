"use server";

import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { PrismaClientKnownRequestError } from "@prisma/client/runtime/library";
import bcrypt from "bcryptjs";

export type SignupResult =
    | { success: true }
    | { success: false; error: string };

export async function signupUser(data: {
    name: string;
    email: string;
    password: string;
}): Promise<SignupResult> {
    const { name, password } = data;
    const email = data.email.toLowerCase().trim();

    if (!email || !password || !name)
        return { success: false, error: "All fields are required." };

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        return { success: false, error: "Please enter a valid email address." };

    if (password.length < 8 || !/[A-Z]/.test(password) || !/[0-9]/.test(password))
        return { success: false, error: "Password must be at least 8 characters and include an uppercase letter and a number." };

    const { checkRateLimit } = await import("@/lib/rate-limit");
    const { headers } = await import("next/headers");
    const headersList = await headers();
    const ip = headersList.get("x-real-ip") || headersList.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";

    const rateCheck = await checkRateLimit(`signup:ip:${ip}`, 10, 3600);
    if (!rateCheck.allowed)
        return { success: false, error: `Too many signup attempts. Please wait ${Math.ceil((rateCheck.resetAt.getTime() - Date.now()) / 60000)} minutes before trying again.` };

    try {
        const hashedPassword = await bcrypt.hash(password, 12);
        const trialEndsAt = new Date();
        trialEndsAt.setDate(trialEndsAt.getDate() + 7);

        const newUser = await prisma.user.create({
            data: { name: name.trim(), email, password: hashedPassword, trialEndsAt },
        });

        // Immediate welcome email
        try {
            const { Resend } = await import("resend");
            const resend = new Resend(process.env.RESEND_API_KEY);
            const firstName = name.trim().split(" ")[0];
            const baseUrl = process.env.NEXTAUTH_URL ?? "https://optiaiseo.online";
            await resend.emails.send({
                from: `OptiAISEO <welcome@${process.env.RESEND_FROM_DOMAIN}>`,
                to: email,
                subject: "Welcome to OptiAISEO — your dashboard is ready",
                html: `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="background:#0d1117;color:#e5e7eb;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;margin:0;padding:0;">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:40px auto;">
<tr><td style="padding:0 24px;">
  <div style="margin-bottom:28px;">
    <div style="font-size:22px;font-weight:700;color:#fff;">OptiAISEO</div>
    <div style="width:40px;height:3px;background:linear-gradient(90deg,#10b981,#3b82f6);border-radius:2px;margin-top:4px;"></div>
  </div>
  <h1 style="font-size:24px;font-weight:700;color:#fff;margin:0 0 12px;">Welcome, ${firstName}! 🎉</h1>
  <p style="color:#9ca3af;font-size:15px;line-height:1.7;margin:0 0 24px;">
    Your OptiAISEO account is ready. Add your website to get an instant AI visibility score, keyword gaps, and a personalised fix plan.
  </p>
  <a href="${baseUrl}/dashboard/sites/new" style="display:inline-block;background:#10b981;color:#fff;font-weight:700;font-size:15px;text-decoration:none;padding:14px 28px;border-radius:10px;">Add Your Site →</a>
  <div style="margin-top:32px;padding-top:20px;border-top:1px solid #21262d;">
    <p style="color:#6b7280;font-size:13px;margin:0;">Questions? Just reply to this email.<br>— The OptiAISEO Team</p>
  </div>
  <p style="color:#374151;font-size:11px;margin-top:16px;">OptiAISEO Ltd · 20-22 Wenlock Road · London · N1 7GU · UK</p>
</td></tr></table>
</body></html>`,
            });
            logger.info("[signup] Welcome email sent", { email });
        } catch (emailErr: unknown) {
            logger.warn("[signup] Welcome email failed", { error: (emailErr as Error)?.message });
        }

        // Fire Inngest for drip sequence and magic first audit
        try {
            const { inngest } = await import("@/lib/inngest/client");
            await inngest.send({ name: "user.registered", data: { userId: newUser.id, email, name: name.trim() } });
        } catch (error) {
            logger.warn("[signup] inngest failed", { error: (error as Error)?.message });
        }

        return { success: true };

    } catch (err: unknown) {
        if (err instanceof PrismaClientKnownRequestError && err.code === "P2002")
            return { success: false, error: "An account with this email already exists." };
        logger.error("[signup] Database error:", { error: (err as Error)?.message ?? String(err) });
        if (err instanceof PrismaClientKnownRequestError)
            return { success: false, error: "Our systems are currently starting up. Please try again in a minute." };
        return { success: false, error: "Something went wrong on our end. Please try again in a moment." };
    }
}
