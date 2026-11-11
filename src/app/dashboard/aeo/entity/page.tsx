"use client";
import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function AeoEntityPage() {
    const router = useRouter();
    const params = useSearchParams();
    useEffect(() => {
        const siteId = params.get("siteId");
        router.replace(`/dashboard/aeo?tab=brand${siteId ? `&siteId=${siteId}` : ""}`);
    }, [router, params]);
    return null;
}
