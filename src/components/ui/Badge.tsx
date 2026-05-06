import { cn } from "@/lib/utils";

export type BadgeVariant = "neutral" | "success" | "warning" | "danger" | "info";

const variantCls: Record<BadgeVariant, string> = {
    neutral: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20",
    success: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    warning: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    danger:  "bg-rose-500/10 text-rose-400 border-rose-500/20",
    info:    "bg-blue-500/10 text-blue-400 border-blue-500/20",
};

export function Badge({
    children,
    variant = "neutral",
    className,
}: {
    children: React.ReactNode;
    variant?: BadgeVariant;
    className?: string;
}) {
    return (
        <span
            className={cn(
                "inline-flex items-center gap-1 px-2 py-0.5 rounded-md",
                "text-[11px] font-medium border",
                variantCls[variant],
                className,
            )}
        >
            {children}
        </span>
    );
}
