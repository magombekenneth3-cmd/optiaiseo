"use server";

import { logger } from "@/lib/logger";
import prisma from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { revalidatePath, revalidateTag } from "next/cache";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

async function getSessionUserId(): Promise<string | null> {
    const session = await getServerSession(authOptions);
    return session?.user?.id ?? null;
}

async function getCurrentUser(include?: Parameters<typeof prisma.user.findUnique>[0]["include"]) {
    const userId = await getSessionUserId();
    if (!userId) return null;
    return prisma.user.findUnique({ where: { id: userId }, include });
}

export async function updateProfile(formData: FormData) {
    try {
        const user = await getCurrentUser();
        if (!user) return { success: false, error: "Unauthorized" };

        const name = (formData.get("name") as string | null)?.trim();
        const email = (formData.get("email") as string | null)?.toLowerCase().trim();

        if (!name || !email) return { success: false, error: "Name and email are required" };
        if (name.length > 100) return { success: false, error: "Name must be under 100 characters." };

        if (email !== user.email?.toLowerCase()) {
            return {
                success: false,
                error: "Email address cannot be changed here. Please contact support.",
            };
        }

        const authorRole = (formData.get("authorRole") as string | null)?.slice(0, 100) ?? null;
        const authorBio = (formData.get("authorBio") as string | null)?.slice(0, 1000) ?? null;
        const realExperience = (formData.get("realExperience") as string | null)?.slice(0, 1000) ?? null;
        const realNumbers = (formData.get("realNumbers") as string | null)?.slice(0, 500) ?? null;
        const localContext = (formData.get("localContext") as string | null)?.slice(0, 200) ?? null;

        const existingPrefs = (user.preferences as Record<string, string> | null) ?? {};

        await prisma.user.update({
            where: { id: user.id },
            data: {
                name,
                preferences: {
                    ...existingPrefs,
                    ...(authorRole !== null ? { authorRole } : {}),
                    ...(authorBio !== null ? { authorBio } : {}),
                    ...(realExperience !== null ? { realExperience } : {}),
                    ...(realNumbers !== null ? { realNumbers } : {}),
                    ...(localContext !== null ? { localContext } : {}),
                },
            },
        });

        logger.info("User updated profile", { userId: user.id });
        revalidatePath("/dashboard/settings");
        revalidatePath("/dashboard");
        revalidateTag(`user-${user.id}`);
        return { success: true };
    } catch (error: unknown) {
        logger.error("Failed to update profile", { error: (error as Error)?.message || String(error) });
        return { success: false, error: "Internal error" };
    }
}

export async function changePassword(currentPassword: string, newPassword: string) {
    try {
        const user = await getCurrentUser();
        if (!user) return { success: false, error: "Unauthorized" };

        if (
            !newPassword ||
            newPassword.length < 8 ||
            !/[A-Z]/.test(newPassword) ||
            !/[0-9]/.test(newPassword)
        ) {
            return { success: false, error: "New password must be at least 8 characters and include an uppercase letter and a number." };
        }

        if (currentPassword === newPassword) {
            return { success: false, error: "New password must be different from your current password." };
        }

        if (!user.password) {
            return { success: false, error: "Your account uses social sign-in. Use Forgot Password from the login page to add a password." };
        }

        const passwordMatch = await bcrypt.compare(currentPassword, user.password);
        if (!passwordMatch) {
            return { success: false, error: "Current password is incorrect." };
        }

        const hashedPassword = await bcrypt.hash(newPassword, 12);
        await prisma.user.update({
            where: { id: user.id },
            data: { password: hashedPassword },
        });

        logger.info("User changed password", { userId: user.id });
        return { success: true };
    } catch (error: unknown) {
        logger.error("Failed to change password:", { error: (error as Error)?.message || String(error) });
        return { success: false, error: "Internal error" };
    }
}

export async function deleteAccount() {
    try {
        const user = await getCurrentUser({ subscription: true });
        if (!user) return { success: false, error: "Unauthorized" };

        const stripeSubId = (user as typeof user & { subscription?: { stripeSubscriptionId?: string | null } })
            .subscription?.stripeSubscriptionId ?? null;

        await prisma.$transaction(async (tx) => {
            await tx.session.deleteMany({ where: { userId: user.id } });
            await tx.user.delete({ where: { id: user.id } });
        });

        logger.info("User deleted account", { userId: user.id });

        if (stripeSubId && process.env.STRIPE_SECRET_KEY) {
            try {
                const { getStripe } = await import("@/lib/stripe/client");
                await getStripe().subscriptions.cancel(stripeSubId);
            } catch (stripeErr: unknown) {
                logger.error("[deleteAccount] Stripe cancel failed after DB delete:", {
                    error: (stripeErr as Error)?.message || String(stripeErr),
                    stripeSubId,
                });
            }
        }

        return { success: true };
    } catch (error: unknown) {
        logger.error("Failed to delete account:", { error: (error as Error)?.message || String(error) });
        return { success: false, error: "Failed to delete account. Please try again or contact support." };
    }
}

export async function updateWhiteLabel(formData: FormData) {
    try {
        const user = await getCurrentUser();
        if (!user) return { success: false, error: "Unauthorized" };

        if (user.subscriptionTier !== "AGENCY") {
            return { success: false, error: "White-label exports are only available on the Agency plan." };
        }

        const companyName = (formData.get("companyName") as string | null)?.trim() || "OptiAISEO";
        const primaryColor = (formData.get("primaryColor") as string | null)?.trim() || "#2563eb";
        const logoUrl = (formData.get("logoUrl") as string | null)?.trim() || "";

        if (!/^#[0-9A-Fa-f]{6}$/.test(primaryColor)) {
            return { success: false, error: "Invalid color format. Use a hex color like #2563eb." };
        }

        if (logoUrl) {
            try {
                new URL(logoUrl);
            } catch {
                return { success: false, error: "Invalid logo URL." };
            }
        }

        if (companyName.length > 100) {
            return { success: false, error: "Company name must be under 100 characters." };
        }

        await prisma.user.update({
            where: { id: user.id },
            data: { whiteLabel: { companyName, primaryColor, logoUrl } },
        });

        logger.info("User updated white-label config", { userId: user.id });
        revalidatePath("/dashboard/settings");
        revalidateTag(`user-${user.id}`);
        return { success: true };
    } catch (error: unknown) {
        logger.error("Failed to update white label config:", { error: (error as Error)?.message || String(error) });
        return { success: false, error: "Internal error" };
    }
}