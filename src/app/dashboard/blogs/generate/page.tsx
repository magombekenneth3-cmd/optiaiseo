import { redirect } from "next/navigation";

// The Generate flow is now embedded directly on /dashboard/blogs.
// Any bookmarked or linked /blogs/generate URL is redirected cleanly.
export default function GeneratePage() {
    redirect("/dashboard/blogs");
}
