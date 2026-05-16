import { logger } from "@/lib/logger";
import { Resend } from "resend";

let _resend: Resend | null = null;
function getResend(): Resend {
    if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY);
    return _resend;
}

function escapeHtml(str: string): string {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export interface BacklinkAlertEmailData {
    userName: string;
    domain: string;
    gained: { domain: string; dr: number | null }[];
    lost: { domain: string; dr: number | null }[];
    siteId: string;
}

function drBadge(dr: number | null): string {
    const color = dr == null ? "#6b7280" : dr >= 60 ? "#16a34a" : dr >= 30 ? "#d97706" : "#dc2626";
    return `<span style="font-size:10px;font-weight:700;padding:2px 6px;border-radius:4px;background:${color}20;color:${color};border:1px solid ${color}40;">DR ${dr ?? "—"}</span>`;
}

function buildHtml(data: BacklinkAlertEmailData): string {
    const appUrl = process.env.NEXTAUTH_URL ?? "https://optiaiseo.online";
    const dashUrl = `${appUrl}/dashboard/backlinks?siteId=${data.siteId}`;

    const gainedRows = data.gained.slice(0, 10).map(g => `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border-bottom:1px solid #1f2937;">
            <div style="display:flex;align-items:center;gap:8px;">
                <span style="color:#34d399;font-size:14px;font-weight:700;">+</span>
                <span style="font-size:13px;color:#f4f4f5;">${escapeHtml(g.domain)}</span>
            </div>
            ${drBadge(g.dr)}
        </div>
    `).join("");

    const lostRows = data.lost.slice(0, 10).map(l => `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border-bottom:1px solid #1f2937;">
            <div style="display:flex;align-items:center;gap:8px;">
                <span style="color:#ef4444;font-size:14px;font-weight:700;">−</span>
                <span style="font-size:13px;color:#f4f4f5;">${escapeHtml(l.domain)}</span>
            </div>
            ${drBadge(l.dr)}
        </div>
    `).join("");

    return `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body style="margin:0;padding:0;background:#09090b;font-family:'Inter',Arial,sans-serif;color:#f4f4f5;">
    <div style="max-width:560px;margin:0 auto;padding:0 0 32px 0;">
        <div style="background:linear-gradient(135deg,#1d4ed8,#7c3aed);padding:28px 24px;text-align:center;">
            <div style="font-size:10px;font-weight:700;letter-spacing:2px;color:rgba(255,255,255,.7);text-transform:uppercase;margin-bottom:6px;">Backlink Alert</div>
            <h1 style="font-size:20px;font-weight:800;margin:0 0 4px;color:#fff;">${escapeHtml(data.domain)}</h1>
            <p style="font-size:12px;color:rgba(255,255,255,.65);margin:0;">Hi ${escapeHtml(data.userName)} — we detected backlink changes</p>
        </div>

        <div style="padding:20px 24px;border-bottom:1px solid #1f2937;">
            <div style="display:flex;gap:16px;">
                <div style="flex:1;text-align:center;padding:14px;background:#052e16;border-radius:10px;border:1px solid #16a34a30;">
                    <div style="font-size:28px;font-weight:800;color:#34d399;">+${data.gained.length}</div>
                    <div style="font-size:11px;color:#6b7280;margin-top:2px;">Gained</div>
                </div>
                <div style="flex:1;text-align:center;padding:14px;background:#1c0a0a;border-radius:10px;border:1px solid #dc262630;">
                    <div style="font-size:28px;font-weight:800;color:#f87171;">−${data.lost.length}</div>
                    <div style="font-size:11px;color:#6b7280;margin-top:2px;">Lost</div>
                </div>
            </div>
        </div>

        ${data.gained.length > 0 ? `
        <div style="padding:16px 24px;border-bottom:1px solid #1f2937;">
            <h2 style="font-size:13px;font-weight:700;margin:0 0 10px;color:#34d399;">New Referring Domains</h2>
            ${gainedRows}
            ${data.gained.length > 10 ? `<p style="font-size:11px;color:#6b7280;margin:8px 0 0;">+${data.gained.length - 10} more</p>` : ""}
        </div>` : ""}

        ${data.lost.length > 0 ? `
        <div style="padding:16px 24px;border-bottom:1px solid #1f2937;">
            <h2 style="font-size:13px;font-weight:700;margin:0 0 10px;color:#f87171;">Lost Referring Domains</h2>
            ${lostRows}
            ${data.lost.length > 10 ? `<p style="font-size:11px;color:#6b7280;margin:8px 0 0;">+${data.lost.length - 10} more</p>` : ""}
        </div>` : ""}

        <div style="padding:20px 24px;text-align:center;">
            <a href="${dashUrl}" style="display:inline-block;background:#3b82f6;color:#fff;font-weight:700;font-size:13px;padding:12px 28px;border-radius:10px;text-decoration:none;">
                View Backlink Dashboard →
            </a>
        </div>

        <div style="padding:14px 24px;border-top:1px solid #1f2937;text-align:center;">
            <p style="font-size:10px;color:#52525b;margin:0;">You're receiving this because backlink monitoring is enabled for ${escapeHtml(data.domain)}.</p>
            <a href="${appUrl}/dashboard/settings?tab=notifications" style="font-size:10px;color:#4ade80;text-decoration:none;">Manage notification preferences</a>
        </div>
    </div>
</body>
</html>`;
}

function buildText(data: BacklinkAlertEmailData): string {
    const lines = [
        `Backlink Alert — ${data.domain}`,
        `Hi ${data.userName}`,
        "",
        `+${data.gained.length} gained, −${data.lost.length} lost`,
        "",
    ];
    if (data.gained.length > 0) {
        lines.push("New Referring Domains:");
        data.gained.slice(0, 10).forEach(g => lines.push(`  + ${g.domain} (DR ${g.dr ?? "—"})`));
    }
    if (data.lost.length > 0) {
        lines.push("", "Lost Referring Domains:");
        data.lost.slice(0, 10).forEach(l => lines.push(`  − ${l.domain} (DR ${l.dr ?? "—"})`));
    }
    lines.push("", `View dashboard: ${process.env.NEXTAUTH_URL ?? "https://optiaiseo.online"}/dashboard/backlinks?siteId=${data.siteId}`);
    return lines.join("\n");
}

export async function sendBacklinkAlertEmail(
    toEmail: string,
    data: BacklinkAlertEmailData,
): Promise<{ success: boolean; error?: string }> {
    if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM_DOMAIN) {
        logger.warn("[Email] Resend not configured — backlink alert not sent");
        return { success: false, error: "Email service not configured" };
    }

    const total = data.gained.length + data.lost.length;
    const subject = data.gained.length > 0 && data.lost.length > 0
        ? `${data.domain}: +${data.gained.length} new, −${data.lost.length} lost backlinks`
        : data.gained.length > 0
            ? `${data.domain}: +${data.gained.length} new backlink${data.gained.length !== 1 ? "s" : ""} detected`
            : `${data.domain}: ${data.lost.length} backlink${data.lost.length !== 1 ? "s" : ""} lost`;

    try {
        await getResend().emails.send({
            from: `OptiAISEO <noreply@${process.env.RESEND_FROM_DOMAIN}>`,
            to: toEmail,
            subject,
            html: buildHtml(data),
            text: buildText(data),
            headers: {
                "List-Unsubscribe": `<${process.env.NEXTAUTH_URL ?? "https://optiaiseo.online"}/dashboard/settings?tab=notifications>`,
                "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
                "Precedence": "bulk",
            },
        });
        logger.info("[Email] Sent backlink alert", { domain: data.domain, gained: data.gained.length, lost: data.lost.length });
        return { success: true };
    } catch (err: unknown) {
        logger.error("[Email] Failed to send backlink alert", { error: (err as Error)?.message ?? String(err) });
        return { success: false, error: (err as Error)?.message ?? String(err) };
    }
}
