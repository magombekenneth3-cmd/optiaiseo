import Link from "next/link";
import { Home, Search } from "lucide-react";

export default function NotFound() {
    return (
        <div className="flex flex-col items-center justify-center min-h-screen gap-8 text-center px-4 bg-background">
            <div className="relative flex flex-col items-center gap-6">
                {/* Big 404 */}
                <div className="flex items-center gap-4">
                    <span className="text-[120px] font-black tracking-tighter leading-none text-foreground/10 select-none">
                        404
                    </span>
                </div>

                <div className="flex flex-col gap-2">
                    <h1 className="text-2xl font-bold tracking-tight">Page not found</h1>
                    <p className="text-muted-foreground text-sm max-w-sm">
                        This page doesn&apos;t exist or has been moved. Let&apos;s get you back on track.
                    </p>
                </div>

                <div className="flex items-center gap-3 mt-2">
                    <Link
                        href="/dashboard"
                        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-foreground text-background text-sm font-semibold hover:opacity-90 transition-all"
                    >
                        <Home className="w-4 h-4" />
                        Back to Dashboard
                    </Link>
                    <Link
                        href="/dashboard/audits"
                        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-card border border-border hover:bg-accent text-sm font-medium transition-colors"
                    >
                        <Search className="w-4 h-4" />
                        Run an Audit
                    </Link>
                </div>
            </div>
        </div>
    );
}
