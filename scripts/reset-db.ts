import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("Dropping schema public...");
  await prisma.$executeRawUnsafe(`DROP SCHEMA public CASCADE;`);
  await prisma.$executeRawUnsafe(`CREATE SCHEMA public;`);
  await prisma.$executeRawUnsafe(`GRANT ALL ON SCHEMA public TO postgres;`);
  await prisma.$executeRawUnsafe(`GRANT ALL ON SCHEMA public TO public;`);
  console.log("Schema public dropped and recreated cleanly.");
}

main()
  .catch((e) => {
    console.error("Error resetting schema:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
