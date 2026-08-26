import { Metadata } from "next";

export const metadata: Metadata = {
    title: "Operations | OptiAISEO",
    description: "Monitor and manage mutation operations across your site.",
};

export default function OperationsLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return children;
}
