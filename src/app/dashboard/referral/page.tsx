import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { ReferralClient } from "./ReferralClient";

export const metadata: Metadata = {
    title: "Refer & Earn — OptiAISEO",
    description: "Earn 20% recurring commission on every paying customer you refer to OptiAISEO.",
};

export default async function ReferralPage() {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) redirect("/login");

    return <ReferralClient />;
}
