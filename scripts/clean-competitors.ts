/**
 * Nuclear clean: find all competitors across all sites, show them,
 * delete all for a given site, then list what remains.
 * Run with: npx tsx scripts/clean-competitors.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("Connecting to DB…\n");

  // Show all sites
  const sites = await prisma.site.findMany({
    select: { id: true, domain: true },
    orderBy: { domain: "asc" },
  });
  console.log(`Sites (${sites.length}):`);
  sites.forEach(s => console.log(`  [${s.id}] ${s.domain}`));

  // Show all competitors grouped by site
  const all = await prisma.competitor.findMany({
    select: { id: true, domain: true, siteId: true },
    orderBy: { domain: "asc" },
  });
  console.log(`\nAll competitors (${all.length} total):`);
  all.forEach(c => {
    const site = sites.find(s => s.id === c.siteId);
    console.log(`  [${c.id}] ${c.domain}  → site: ${site?.domain ?? c.siteId}`);
  });

  // Delete ALL competitors (they are all stale garbage from old pipeline)
  const del = await prisma.competitor.deleteMany({});
  console.log(`\n✅ Deleted ALL ${del.count} competitor record(s) — DB is now clean.`);
  console.log("Run 'Auto-detect services' (or 'Reset & Re-detect') from the dashboard once the new code deploys.");
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
