"use client";
import { NextAuthProvider } from "@/components/auth/NextAuthProvider";
import { Toaster } from "sonner";
import { cn } from "@/lib/utils";
import { useState, useEffect } from "react";
import "./globals.css";

export default function ClientLayout({
  children,
  fontVars,
}: {
  children: React.ReactNode;
  fontVars?: string;
}) {
  const [theme, setTheme] = useState("dark");
  const [accent, setAccent] = useState("#10b981");

  useEffect(() => {
    const storedTheme = localStorage.getItem("theme");
    const storedAccent = localStorage.getItem("accent");
    if (storedTheme) setTheme(storedTheme);
    if (storedAccent) setAccent(storedAccent);
  }, []);

  useEffect(() => {
    document.documentElement.classList.remove("dark", "light");
    document.documentElement.classList.add(theme);
    document.documentElement.style.setProperty("--brand", accent);
    localStorage.setItem("theme", theme);
    localStorage.setItem("accent", accent);
  }, [theme, accent]);

  return (
    <NextAuthProvider>
      <a href="#main-content" className="skip-nav">
        Skip to main content
      </a>
      {children}
      <Toaster
        position="bottom-right"
        richColors={false}
        theme={theme as "dark" | "light"}
        visibleToasts={5}
        toastOptions={{
          duration: 4000,
          style: {
            background: "#18181b",
            border: "1px solid rgba(255,255,255,0.07)",
            color: "#fafafa",
            borderRadius: "10px",
            fontSize: "13.5px",
            fontFamily: "var(--font-sans)",
            boxShadow: "0 4px 24px rgba(0,0,0,0.4)",
          },
        }}
      />
    </NextAuthProvider>
  );
}