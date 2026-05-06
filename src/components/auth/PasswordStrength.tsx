"use client";

/**
 * Shared PasswordStrength component.
 * Used in ResetPasswordForm and ChangePasswordForm.
 */
export function PasswordStrength({ password }: { password: string }) {
    const checks = [
        { label: "8+ characters", ok: password.length >= 8 },
        { label: "Uppercase letter", ok: /[A-Z]/.test(password) },
        { label: "Number or symbol", ok: /[0-9!@#$%^&*]/.test(password) },
        {
            label: "No common pattern",
            ok:
                password.length > 0 &&
                !/^(.)\1+$/.test(password) &&
                !/^(012|123|234|345|456|567|678|789|890|password|qwerty)/i.test(password),
        },
    ];
    const score = checks.filter((c) => c.ok).length;
    const barColor =
        score === 4
            ? "bg-emerald-500"
            : score === 3
            ? "bg-emerald-500"
            : score === 2
            ? "bg-amber-500"
            : score === 1
            ? "bg-orange-500"
            : "bg-red-500";

    if (!password) return null;

    return (
        <div className="mt-2 space-y-1.5">
            <div className="flex gap-1 h-1">
                {[0, 1, 2, 3].map((i) => (
                    <div
                        key={i}
                        className={`flex-1 rounded-full transition-colors ${i < score ? barColor : "bg-white/10"}`}
                    />
                ))}
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1">
                {checks.map((c) => (
                    <span
                        key={c.label}
                        className={`text-[11px] flex items-center gap-1 ${c.ok ? "text-emerald-400" : "text-zinc-600"}`}
                    >
                        <span>{c.ok ? "✓" : "○"}</span> {c.label}
                    </span>
                ))}
            </div>
        </div>
    );
}
