import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
    console.log("Step 1 — Mark stuck migration as rolled-back...");
    await prisma.$executeRaw`
        UPDATE "_prisma_migrations"
        SET
            "finished_at"    = NOW(),
            "rolled_back_at" = NOW()
        WHERE "migration_name" = '20260415_brand_fact_unique_and_source'
          AND "rolled_back_at" IS NULL
    `;
    console.log("✓ Migration marked rolled-back");

    console.log("Step 2 — Deduplicate BrandFact rows...");
    const result = await prisma.$executeRaw`
        DELETE FROM "BrandFact"
        WHERE ctid NOT IN (
            SELECT MIN(ctid)
            FROM "BrandFact"
            GROUP BY "siteId", "factType", "value"
        )
    `;
    console.log(`✓ Removed ${result} duplicate BrandFact rows`);

    console.log("\nDone. Now run: npx prisma migrate dev --name add_leaderboard_opt_out");
}

main()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => prisma.$disconnect());
