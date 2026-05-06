import { runAeoAudit, runAeoAuditLite } from "./index";

export async function compareWithCompetitors(
    domain: string,
    competitors: string[],
    coreServices?: string
) {
    // Run audits sequentially to avoid massive API costs and rate limit timeouts
    const ownResult = await runAeoAudit(domain, coreServices);
    
    const competitorResults = [];
    for (const c of competitors.slice(0, 3)) {
        competitorResults.push(await runAeoAuditLite(c, coreServices));
    }

    return {
        own: {
            domain,
            score: ownResult.score,
            gsov: ownResult.generativeShareOfVoice,
            citationLikelihood: ownResult.citationLikelihood,
            grade: ownResult.grade,
            multiModelResults: ownResult.multiModelResults,
        },
        competitors: competitorResults.map((r, i) => ({
            domain: competitors[i],
            score: r.score,
            gsov: r.generativeShareOfVoice,
            citationLikelihood: r.citationLikelihood,
            grade: r.grade,
            multiModelResults: r.multiModelResults,
        })),
        // What checks are competitors passing that you are not?
        competitorAdvantages: competitorResults.flatMap((r, i) => {
            const theirPassed = r.checks.filter(c => c.passed).map(c => c.id);
            const yourFailed = ownResult.checks.filter(c => !c.passed).map(c => c.id);
            const gaps = theirPassed.filter(id => yourFailed.includes(id));
            return gaps.map(id => ({
                competitor: competitors[i],
                checkId: id,
                label: r.checks.find(c => c.id === id)?.label,
            }));
        }),
    };
}
