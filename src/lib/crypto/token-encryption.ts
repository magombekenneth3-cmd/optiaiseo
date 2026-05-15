import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function getEncryptionKey(): Buffer {
    const key = process.env.TOKEN_ENCRYPTION_KEY;
    if (!key) return Buffer.alloc(0);
    const decoded = Buffer.from(key, "base64");
    if (decoded.length !== 32) {
        throw new Error("TOKEN_ENCRYPTION_KEY must be exactly 32 bytes (base64-encoded)");
    }
    return decoded;
}

export function encryptToken(plaintext: string): string {
    const key = getEncryptionKey();
    if (key.length === 0) return plaintext;
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return Buffer.concat([iv, authTag, encrypted]).toString("base64");
}

export function decryptToken(ciphertext: string): string {
    const key = getEncryptionKey();
    if (key.length === 0) return ciphertext;
    try {
        const data = Buffer.from(ciphertext, "base64");
        if (data.length < IV_LENGTH + AUTH_TAG_LENGTH) return ciphertext;
        const iv = data.subarray(0, IV_LENGTH);
        const authTag = data.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
        const encrypted = data.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
        const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
        decipher.setAuthTag(authTag);
        return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
    } catch {
        return ciphertext;
    }
}

export function isEncrypted(token: string): boolean {
    if (!token) return false;
    try {
        const data = Buffer.from(token, "base64");
        return data.length > IV_LENGTH + AUTH_TAG_LENGTH && !token.startsWith("gho_") && !token.startsWith("ghp_");
    } catch {
        return false;
    }
}
