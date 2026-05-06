import { PrismaClient, Role } from "@prisma/client";

const prisma = new PrismaClient();
const ADMIN_EMAIL = "kennethdavid256@gmail.com";

async function main() {
  const user = await prisma.user.findUnique({ where: { email: ADMIN_EMAIL } });
  if (!user) {
    console.log(`[seed-admin] User ${ADMIN_EMAIL} not found. They must sign up first.`);
    return;
  }

  await prisma.user.update({
    where: { email: ADMIN_EMAIL },
    data: { role: Role.SUPER_ADMIN },
  });

  console.log(`[seed-admin] ✅ ${ADMIN_EMAIL} is now SUPER_ADMIN`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());