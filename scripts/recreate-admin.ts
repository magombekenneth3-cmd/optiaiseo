
import prisma from "@/lib/prisma";
import bcrypt from "bcryptjs";

const [email, password] = process.argv.slice(2);

if (!email || !password) {
    console.error("Usage: npx tsx scripts/recreate-admin.ts <email> <password>");
    process.exit(1);
}

async function main() {
    const hashed = await bcrypt.hash(password, 12);

    const existing = await prisma.user.findUnique({ where: { email } });

    if (existing) {
        await prisma.user.update({
            where: { email },
            data: {
                password: hashed,
                role: "SUPER_ADMIN",
                subscriptionTier: "AGENCY",
                emailVerified: new Date(),
            },
        });
        console.log(`✓ Updated existing user ${email} → SUPER_ADMIN`);
    } else {
        await prisma.user.create({
            data: {
                email,
                name: "Admin",
                password: hashed,
                role: "SUPER_ADMIN",
                subscriptionTier: "AGENCY",
                emailVerified: new Date(),
                credits: 9999,
            },
        });
        console.log(`✓ Created new SUPER_ADMIN user: ${email}`);
    }
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
