import { PrismaClient, Role } from "@prisma/client";

const prisma = new PrismaClient();
const ADMIN_EMAIL = "kennethdavid256@gmail.com";

async function main() {
  const user = await prisma.user.findUnique({ where: { email: ADMIN_EMAIL } });
  if (!user) {
    console.log(`[seed-admin] User ${ADMIN_EMAIL} not found. They must sign up first.`);
    return;
  }

  // 1. Promote to SUPER_ADMIN role + ENTERPRISE tier
  await prisma.user.update({
    where: { email: ADMIN_EMAIL },
    data: {
      role:             Role.SUPER_ADMIN,
      subscriptionTier: "ENTERPRISE",
    },
  });

  // 2. Upsert a Subscription row so [Auth/Tier] guard doesn't warn on every request.
  //    No real Stripe IDs — admin access is granted via the role column, not Stripe.
  await prisma.subscription.upsert({
    where:  { userId: user.id },
    update: {
      status:           "active",
      currentPeriodEnd: new Date("2099-01-01"),
    },
    create: {
      userId:           user.id,
      status:           "active",
      currentPeriodEnd: new Date("2099-01-01"),
    },
  });

  console.log(`[seed-admin] ✅ ${ADMIN_EMAIL} → SUPER_ADMIN / ENTERPRISE + Subscription row upserted`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());