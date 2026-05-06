"use client";
import { useEffect, useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";

function AcceptInviteContent() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const token = searchParams.get("token");
    const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
    const [message, setMessage] = useState("");

    useEffect(() => {
        if (!token) {
            setStatus("error");
            setMessage("Invalid invitation link.");
            return;
        }
        fetch("/api/team/accept", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ token }),
        })
            .then(async (res) => {
                if (res.ok) {
                    setStatus("success");
                    setTimeout(() => router.push("/dashboard"), 2000);
                } else {
                    const text = await res.text();
                    setStatus("error");
                    setMessage(text || "Something went wrong.");
                }
            })
            .catch(() => {
                setStatus("error");
                setMessage("Network error. Please try again.");
            });
    }, [token, router]);

    return (
        <div className="min-h-screen flex items-center justify-center">
            <div className="text-center space-y-4 max-w-md px-6">
                {status === "loading" && <p className="text-muted-foreground">Accepting invitation...</p>}
                {status === "success" && (
                    <>
                        <h1 className="text-2xl font-bold text-foreground">You are in! 🎉</h1>
                        <p className="text-muted-foreground">Redirecting you to the dashboard...</p>
                    </>
                )}
                {status === "error" && (
                    <>
                        <h1 className="text-2xl font-bold text-foreground">Invitation Error</h1>
                        <p className="text-muted-foreground">{message}</p>
                        <a href="/login" className="inline-block mt-4 px-6 py-2 bg-brand text-white rounded-lg font-semibold">Go to Login</a>
                    </>
                )}
            </div>
        </div>
    );
}

export default function AcceptInvitePage() {
    return (
        <Suspense>
            <AcceptInviteContent />
        </Suspense>
    );
}
