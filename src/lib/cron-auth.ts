import crypto from 'crypto';

export function isCronAuthorized(req: Request): boolean {
    const secret = process.env.CRON_SECRET;

    if (!secret) {
        throw new Error(
            '[CronAuth] CRON_SECRET is not set — all cron endpoints are effectively disabled. ' +
            'Set CRON_SECRET (min 32 chars) in your deployment environment and redeploy.'
        );
    }

    const authHeader = req.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) return false;

    const provided = authHeader.slice(7);

    const a = crypto.createHash("sha256").update(provided).digest();
    const b = crypto.createHash("sha256").update(secret).digest();

    return crypto.timingSafeEqual(a, b);
}
