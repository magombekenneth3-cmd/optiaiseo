/**
 * One-time script to grant SUPER_ADMIN role to the first admin user.
 * Run once after initial deployment:
 *   pnpm tsx scripts/bootstrap-admin.ts admin@yourcompany.com
 */
import prisma from "@/lib/prisma";

const email = process.argv[2];

if (!email || !email.includes("@")) {
    console.error("Usage: pnpm tsx scripts/bootstrap-admin.ts <email>");
    process.exit(1);
}

async function main() {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
        console.error(`No user found with email: ${email}`);
        console.error("The user must have logged in at least once before being granted admin.");
        process.exit(1);
    }

    if (user.role === "SUPER_ADMIN") {
        console.log(`${email} already has SUPER_ADMIN role.`);
        return;
    }

    await prisma.user.update({
        where: { email },
        data: { role: "SUPER_ADMIN" },
    });

    console.log(`✓ Granted SUPER_ADMIN to ${email}`);
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
