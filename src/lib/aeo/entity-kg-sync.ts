/**
 * 2.2: KG entity extraction from AEO report results.
 * Called after every AEO audit to store extracted entities as BrandFacts.
 * Connects the kg-builder to the main AEO audit flow.
 */
import { prisma } from "@/lib/prisma";
import { buildKnowledgeGraph } from "@/lib/aeo/kg-builder";
import { logger } from "@/lib/logger";

interface AeoResultForKG {
    checks?: unknown;
    topRecommendations?: string[];
    schemaTypes?: string[];
}

/**
 * After every AEO audit, build/refresh the KG and extract entities
 * into BrandFact records for the entity panel.
 */
export async function syncEntityKnowledgeGraph(siteId: string, domain: string, aeoResult?: AeoResultForKG): Promise<void> {
    try {
        // 1. Build / refresh the KG (this updates Redis cache)
        const kg = await buildKnowledgeGraph(domain);
        if (!kg) return;

        const org = kg["@graph"]?.find((n: { "@type"?: string }) => n["@type"] === "Organization");
        if (!org) return;

        // 2. Extract entities from kg nodes to upsert as BrandFacts
        const factsToUpsert: { factType: string; value: string; verified: boolean }[] = [];

        // Organization name
        if (org.name && typeof org.name === "string") {
            factsToUpsert.push({ factType: "organization_name", value: org.name, verified: true });
        }

        // Services (from kg service nodes)
        const serviceNodes = kg["@graph"]?.filter((n: { "@type"?: string }) => n["@type"] === "Service") ?? [];
        for (const svc of serviceNodes.slice(0, 5)) {
            if (svc.name) factsToUpsert.push({ factType: "service", value: svc.name, verified: true });
        }

        // Schema types from AEO report
        if (Array.isArray(aeoResult?.schemaTypes)) {
            for (const schema of aeoResult.schemaTypes.slice(0, 5)) {
                if (typeof schema === "string") {
                    factsToUpsert.push({ factType: "schema_type", value: schema, verified: true });
                }
            }
        }

        // KnowsAbout topics → factType = "topic"
        if (Array.isArray(org.knowsAbout)) {
            for (const topic of (org.knowsAbout as string[]).slice(0, 6)) {
                if (typeof topic === "string" && topic.length < 80) {
                    factsToUpsert.push({ factType: "topic", value: topic, verified: false });
                }
            }
        }

        // 3. Upsert facts — deduplicated by the unique constraint on (siteId, factType, value)
        for (const fact of factsToUpsert) {
            await prisma.brandFact.upsert({
                where: {
                    siteId_factType_value: {
                        siteId,
                        factType: fact.factType,
                        value: fact.value,
                    },
                },
                create: {
                    siteId,
                    factType: fact.factType,
                    value: fact.value,
                    verified: fact.verified,
                },
                update: {
                    verified: fact.verified,
                },
            });
        }

        logger.info(`[EntityKG] Synced ${factsToUpsert.length} brand facts for ${domain}`);
    } catch (e: unknown) {
        logger.warn("[EntityKG] KG sync failed", { error: (e as Error)?.message });
    }
}
