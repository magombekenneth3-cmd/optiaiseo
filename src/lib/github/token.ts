import { prisma } from "@/lib/prisma";
import { decryptToken, isEncrypted, encryptToken } from "@/lib/crypto/token-encryption";

export async function getGitHubToken(userId: string): Promise<string | null> {
    const account = await prisma.account.findFirst({
        where: { userId, provider: "github" },
        select: { id: true, access_token: true },
    });

    if (!account?.access_token) return null;

    const token = isEncrypted(account.access_token)
        ? decryptToken(account.access_token)
        : account.access_token;

    if (!isEncrypted(account.access_token) && process.env.TOKEN_ENCRYPTION_KEY) {
        await prisma.account.update({
            where: { id: account.id },
            data: { access_token: encryptToken(token) },
        }).catch(() => {});
    }

    return token;
}
