import { redirect } from "next/navigation";

// Redirect any old /dashboard/settings/billing links to the correct URL
export default function BillingRedirectPage() {
    redirect("/dashboard/billing");
}
