/**
 * src/types/next-auth.d.ts
 * Extends NextAuth Session and JWT types with platform-specific fields.
 */
import "next-auth";

declare module "next-auth" {
    interface Session {
        user?: {
            id?: string;
            name?: string | null;
            email?: string | null;
            image?: string | null;
            subscriptionTier?: string;
            gscConnected?: boolean;
        };
        error?: string;
    }
}

declare module "next-auth/jwt" {
    interface JWT {
        error?: string;
    }
}
