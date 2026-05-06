"use client";

import { SessionProvider } from "next-auth/react";
import React from "react";

function NextAuthProvider({ children }: { children: React.ReactNode }) {
    return <SessionProvider refetchOnWindowFocus={false} refetchInterval={300}>{children}</SessionProvider>;
}

export { NextAuthProvider };
