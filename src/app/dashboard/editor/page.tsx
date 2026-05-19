import { Metadata } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { EditorShell } from "./EditorShell";

export const metadata: Metadata = {
    title: "Content Editor | OptiAISEO",
    description: "Write, analyze, and optimize your content for search engines in real time.",
};

interface PageProps {
    searchParams: Promise<{ keyword?: string }>;
}

export default async function EditorPage({ searchParams }: PageProps) {
    const session = await getServerSession(authOptions);
    if (!session) {
        redirect("/login");
    }

    const { keyword } = await searchParams;
    const initialKeyword = keyword ? String(keyword).trim().slice(0, 120) : "";

    return (
        <div className="flex flex-col gap-6 w-full max-w-7xl mx-auto h-full min-h-[calc(100vh-140px)]">
            <div className="flex flex-col gap-1.5">
                <h1 className="text-2xl font-bold tracking-tight">Real-Time Content Editor</h1>
                <p className="text-muted-foreground text-sm">
                    Optimize your content against real SERP competitors. Enter a target keyword, paste your draft, and watch your score improve.
                </p>
            </div>
            <div className="flex-1 min-h-0">
                <EditorShell initialKeyword={initialKeyword} />
            </div>
        </div>
    );
}
