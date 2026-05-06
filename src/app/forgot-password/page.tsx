import { Metadata } from "next";
import Link from "next/link";
import { ForgotPasswordForm } from "./ForgotPasswordForm";

export const metadata: Metadata = {
    title: "Forgot Password | OptiAISEO",
    description: "Reset your OptiAISEO account password.",
    robots: { index: false, follow: false },
};

export default function ForgotPasswordPage() {
    return (
        <div className="min-h-screen bg-background flex flex-col justify-center py-12 sm:px-6 lg:px-8 relative overflow-hidden">
            {/* Background glow */}
            <div className="absolute top-0 -translate-y-12 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-primary/20 blur-[120px] rounded-full pointer-events-none" />

            <div className="sm:mx-auto sm:w-full sm:max-w-md relative z-10">
                {/* Logo */}
                <div className="flex justify-center mb-6">
                    <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
                        <div className="w-12 h-12 rounded-xl bg-brand flex items-center justify-center shadow-lg">
                            <span className="font-black text-white tracking-tighter text-xs">Opti</span>
                        </div>
                    </Link>
                </div>
                <h1 className="mt-2 text-center text-3xl font-extrabold tracking-tight">Forgot password?</h1>
                <p className="mt-2 text-center text-sm text-muted-foreground">
                    Enter your email and we&apos;ll send you a reset link
                </p>
            </div>

            <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md relative z-10 px-4 sm:px-0">
                <div className="card-surface py-8 px-4 sm:rounded-2xl sm:px-10">
                    <ForgotPasswordForm />
                </div>
            </div>
        </div>
    );
}
