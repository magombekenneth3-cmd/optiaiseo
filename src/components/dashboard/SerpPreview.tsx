"use client";
import { useState } from "react";

const TITLE_LIMIT  = 60;
const DESC_LIMIT   = 160;
const MOBILE_TITLE = 50;
const MOBILE_DESC  = 120;

interface SerpPreviewProps {
    url:         string;
    title:       string;
    description: string;
    siteName?:   string;
    favicon?:    string;
}

export function SerpPreview({ url, title, description, favicon }: SerpPreviewProps) {
    const [view, setView] = useState<"desktop" | "mobile">("desktop");

    const tLimit = view === "desktop" ? TITLE_LIMIT  : MOBILE_TITLE;
    const dLimit = view === "desktop" ? DESC_LIMIT   : MOBILE_DESC;

    const truncate = (s: string, n: number) =>
        s.length > n ? s.slice(0, n - 1) + "…" : s;

    const displayTitle = truncate(title, tLimit);
    const displayDesc  = truncate(description, dLimit);

    let breadcrumb = url;
    try {
        const u    = new URL(url.startsWith("http") ? url : `https://${url}`);
        breadcrumb = [u.hostname, ...u.pathname.split("/").filter(Boolean)].join(" › ");
    } catch { }

    return (
        <div className="space-y-4">
            <div className="flex gap-2">
                {(["desktop", "mobile"] as const).map((d) => (
                    <button
                        key={d}
                        onClick={() => setView(d)}
                        className={`px-3 py-1 text-xs rounded-full border transition-colors font-medium ${
                            view === d
                                ? "bg-primary text-primary-foreground border-primary"
                                : "border-border text-muted-foreground hover:border-foreground/40"
                        }`}
                    >
                        {d.charAt(0).toUpperCase() + d.slice(1)}
                    </button>
                ))}
            </div>

            <div className={`bg-white rounded-xl border border-border/40 shadow-sm p-5 ${
                view === "mobile" ? "max-w-sm" : "max-w-xl"
            }`}>
                <div className="flex items-center gap-2 mb-1">
                    {favicon && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={favicon} alt="" className="w-4 h-4 rounded-sm" />
                    )}
                    <span className="text-xs text-gray-600 truncate">{breadcrumb}</span>
                </div>

                <p className={`text-blue-700 hover:underline cursor-pointer font-medium leading-snug ${
                    view === "mobile" ? "text-sm" : "text-lg"
                }`}>
                    {displayTitle}
                    {title.length > tLimit && (
                        <span className="ml-1 text-xs text-red-500 no-underline">
                            ({title.length - tLimit} chars over)
                        </span>
                    )}
                </p>

                <p className={`text-gray-600 mt-1 leading-normal ${
                    view === "mobile" ? "text-xs" : "text-sm"
                }`}>
                    {displayDesc}
                    {description.length > dLimit && (
                        <span className="ml-1 text-red-500">
                            ({description.length - dLimit} chars over)
                        </span>
                    )}
                </p>
            </div>

            <div className="flex gap-6 text-xs text-muted-foreground">
                <span>
                    Title:{" "}
                    <span className={title.length > tLimit ? "text-red-500 font-medium" : "text-green-600 font-medium"}>
                        {title.length}/{tLimit}
                    </span>
                </span>
                <span>
                    Description:{" "}
                    <span className={description.length > dLimit ? "text-red-500 font-medium" : "text-green-600 font-medium"}>
                        {description.length}/{dLimit}
                    </span>
                </span>
            </div>
        </div>
    );
}
