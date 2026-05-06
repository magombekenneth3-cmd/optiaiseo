import { getToken } from "next-auth/jwt";
import type { NextRequest } from "next/server";

export interface AuthUser {
  id: string;
  email: string | null;
  subscriptionTier: string;
  role: string;
  gscConnected: boolean;
}

export async function getAuthUser(req: NextRequest): Promise<AuthUser | null> {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (!token?.id) return null;
  return {
    id: token.id as string,
    email: (token.email as string | null) ?? null,
    subscriptionTier: (token.subscriptionTier as string | undefined) ?? "FREE",
    role: (token.role as string | undefined) ?? "USER",
    gscConnected: (token.gscConnected as boolean | undefined) ?? false,
  };
}
