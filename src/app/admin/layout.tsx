import { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isAdminSession } from "@/lib/admin-guard";
import { AdminSidebar } from "@/components/admin/AdminSidebar";
import { Toaster } from "sonner";
import type { Metadata } from "next";
import "@/app/admin/admin.css";

export const metadata: Metadata = {
  title: "Admin Panel — OptiAISEO",
  robots: { index: false, follow: false },
};

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    redirect("/login");
  }

  const isAdmin = await isAdminSession();
  if (!isAdmin) {
    redirect("/dashboard");
  }

  return (
    <div className="admin-root flex min-h-screen">
      <AdminSidebar />

      {/* Mobile header */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-50 h-14 admin-mobile-header flex items-center px-4 border-b border-white/10">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg admin-logo-badge flex items-center justify-center">
            <span className="text-white text-[10px] font-black">A</span>
          </div>
          <span className="text-white font-bold text-sm">Admin Panel</span>
        </div>
      </div>

      {/* Main */}
      <div className="flex-1 flex flex-col min-h-screen min-w-0 pt-14 md:pt-0">
        <main className="flex-1 p-6 md:p-8 overflow-y-auto">
          {children}
        </main>
      </div>

      <Toaster
        position="bottom-right"
        theme="dark"
        toastOptions={{
          style: {
            background: "#18181b",
            border: "1px solid rgba(255,255,255,0.07)",
            color: "#fafafa",
            borderRadius: "10px",
            fontSize: "13.5px",
          },
        }}
      />
    </div>
  );
}
