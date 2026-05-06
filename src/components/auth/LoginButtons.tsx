"use client";

import { signIn } from "next-auth/react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

const GoogleIcon = () => (
    <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24">
        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
);

const GithubIcon = () => (
    <svg className="w-5 h-5 shrink-0" fill="currentColor" viewBox="0 0 24 24">
        <path fillRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clipRule="evenodd" />
    </svg>
);

const Spinner = () => (
    <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
);

export function LoginButtons() {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [loading, setLoading] = useState<string | null>(null);
    const [error, setError] = useState("");
    const router = useRouter();

    const handleOAuth = async (provider: string) => {
        setLoading(provider);
        await signIn(provider, { callbackUrl: "/dashboard" });
    };

    const handleCredentials = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");
        setLoading("credentials");

        const result = await signIn("credentials", {
            email,
            password,
            redirect: false,
        });

        setLoading(null);

        if (result?.error) {
            // FIX 4: Surface a specific message when the account uses OAuth sign-in.
            if (result.error === "OAuthAccount") {
                setError(
                    "This email uses Google or GitHub sign-in — please use that button instead."
                );
            } else {
                setError("Invalid email or password.");
            }
        } else {
            // FIX 4: Use router.push + router.refresh instead of hard location change
            // so the NextAuth session is properly picked up without a full page reload.
            router.push("/dashboard");
            router.refresh();
        }
    };

    const socialBtnClass =
        "w-full flex items-center justify-center gap-3 px-4 py-2.5 border border-border rounded-xl bg-card hover:bg-accent hover:-translate-y-px text-sm font-medium transition-all duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none";

    const inputClass =
        "w-full px-4 py-2.5 bg-background border border-border rounded-xl text-sm placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all duration-200";

    return (
        <div className="space-y-5">
            {/* OAuth buttons */}
            <div className="space-y-3">
                <button
                    className={socialBtnClass}
                    disabled={loading !== null}
                    onClick={() => handleOAuth("github")}
                >
                    {loading === "github" ? <Spinner /> : <GithubIcon />}
                    Continue with GitHub
                </button>

                <button
                    className={socialBtnClass}
                    disabled={loading !== null}
                    onClick={() => handleOAuth("google")}
                >
                    {loading === "google" ? <Spinner /> : <GoogleIcon />}
                    Continue with Google
                </button>
            </div>

            {/* Divider */}
            <div className="relative">
                <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-border" />
                </div>
                <div className="relative flex justify-center text-xs">
                    <span className="px-3 bg-card text-muted-foreground">or sign in with email</span>
                </div>
            </div>

            {/* Email + Password form */}
            <form onSubmit={handleCredentials} className="space-y-4">
                {error && (
                    <div className="bg-destructive/10 border border-destructive/30 text-destructive text-sm px-4 py-3 rounded-xl">
                        {error}
                    </div>
                )}

                <div>
                    <label htmlFor="login-email" className="block text-sm font-medium text-foreground mb-1.5">
                        Email address
                    </label>
                    <input
                        id="login-email"
                        type="email"
                        autoComplete="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className={inputClass}
                        placeholder="you@example.com"
                    />
                </div>

                <div>
                    <div className="flex items-center justify-between mb-1.5">
                        <label htmlFor="login-password" className="block text-sm font-medium text-foreground">
                            Password
                        </label>
                        <Link
                            href="/forgot-password"
                            className="text-xs text-brand hover:opacity-80 transition-opacity"
                        >
                            Forgot password?
                        </Link>
                    </div>
                    <input
                        id="login-password"
                        type="password"
                        autoComplete="current-password"
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className={inputClass}
                        placeholder="••••••••"
                    />
                </div>

                <button
                    type="submit"
                    disabled={loading !== null}
                    className="w-full py-2.5 px-4 bg-foreground text-background font-bold rounded-xl text-sm hover:opacity-90 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                    {loading === "credentials" ? <><Spinner /> Signing in…</> : "Sign In"}
                </button>
            </form>
        </div>
    );
}
