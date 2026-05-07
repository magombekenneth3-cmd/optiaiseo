import { logger } from "@/lib/logger";
import { Type, type Tool, GoogleGenAI } from "@google/genai";
import { runSiteAudit } from "@/lib/audit";
import { auditMultiModelMentions } from "@/lib/aeo/multi-model";
import { type AeoCheck } from "@/lib/aeo";
import { generateAeoFixInternal } from "@/lib/aeo/fix-engine";
import { pushFixToGitHub } from "@/app/actions/aeoFix";
import { prisma } from "@/lib/prisma";
import { AI_MODELS } from "@/lib/constants/ai-models";

// Module-level singleton — avoids re-instantiating the SDK on every tool call
const _visionAI = process.env.GEMINI_API_KEY
    ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
    : null;

const parseDomain = (input: string) => {
    return input.replace(/^(https?:\/\/)?(www\.)?/, "").split("/")[0];
};

export const TOOL_DEFINITIONS: Tool[] = [
    {
        functionDeclarations: [
            {
                name: "runSiteAudit",
                description: "Scans a website URL for core SEO signals (Title, Meta Description, Word Count) and returns a basic audit report.",
                parameters: {
                    type: Type.OBJECT,
                    properties: {
                        url: {
                            type: Type.STRING,
                            description: "The URL or domain to audit (e.g., example.com)",
                        },
                    },
                    required: ["url"],
                },
            },
            {
                name: "checkCompetitor",
                description: "Compares the user's domain against a competitor domain to see who has a higher Generative Share of Voice (AEO Score) across AI models.",
                parameters: {
                    type: Type.OBJECT,
                    properties: {
                        myDomain: {
                            type: Type.STRING,
                            description: "The user's domain (e.g., example.com)",
                        },
                        competitorDomain: {
                            type: Type.STRING,
                            description: "The competitor's domain (e.g., competitor.com)",
                        },
                    },
                    required: ["myDomain", "competitorDomain"],
                },
            },
            {
                name: "analyzeScreenshot",
                description: "Analyzes an image or screenshot uploaded by the user — such as a Google Search Console traffic graph, a Google AI Overview result, or any analytics dashboard. Identifies trends, drops, anomalies, and provides strategic recommendations.",
                parameters: {
                    type: Type.OBJECT,
                    properties: {
                        imageBase64: {
                            type: Type.STRING,
                            description: "Base64-encoded image data of the screenshot to analyze.",
                        },
                        mimeType: {
                            type: Type.STRING,
                            description: "MIME type of the image (e.g. 'image/png', 'image/jpeg').",
                        },
                        context: {
                            type: Type.STRING,
                            description: "Optional extra context from the user about what the screenshot shows.",
                        },
                    },
                    required: ["imageBase64", "mimeType"],
                },
            },
            {
                name: "triggerAutoFix",
                description: "Triggers the self-healing engine to automatically generate a fix for a specific SEO/AEO issue and open a GitHub Pull Request in the user's connected repository.",
                parameters: {
                    type: Type.OBJECT,
                    properties: {
                        domain: {
                            type: Type.STRING,
                            description: "The domain to fix",
                        },
                        issueType: {
                            type: Type.STRING,
                            description: "The type of issue to fix (e.g., 'title-tag', 'meta-description', 'schema-markup', 'missing-faq')",
                        },
                        issueDetail: {
                            type: Type.STRING,
                            description: "Optional short description of the specific problem to fix.",
                        },
                    },
                    required: ["domain", "issueType"],
                },
            },
            {
                name: "saveExpertiseInterview",
                description: "Saves the collected expertise data from the onboarding interview to the user's site profile. Call this after gathering all answers from the structured interview questions.",
                parameters: {
                    type: Type.OBJECT,
                    properties: {
                        siteId:         { type: Type.STRING, description: "The site ID to update" },
                        realExperience: { type: Type.STRING, description: "The specific result or experience the user shared" },
                        realNumbers:    { type: Type.STRING, description: "Concrete numbers, costs, yields, or metrics mentioned" },
                        localContext:   { type: Type.STRING, description: "Location and regional context mentioned by the user" },
                    },
                    required: ["siteId", "realExperience"],
                },
            },
        ],
    },
];

 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function executeTool(name: string, args: Record<string, any>): Promise<any> {
    try {
        switch (name) {
            case "runSiteAudit": {
                const domain = parseDomain(args.url);
                logger.debug(`[Voice Tool] Running audit for: ${domain}`);
                const result = await runSiteAudit(domain);
                return {
                    domain: domain,
                    overallScore: result.score || 0,
                    seoScore: result.categoryScores?.seo || 0,
                    performanceScore: result.categoryScores?.performance || 0,
                    status: "Audit complete. Summarize these scores for the user and tell them what to focus on.",
                };
            }

            case "checkCompetitor": {
                const myDomain = parseDomain(args.myDomain);
                const competitorDomain = parseDomain(args.competitorDomain);

                logger.debug(`[Voice Tool] Comparing ${myDomain} vs ${competitorDomain}`);

                // Run AEO checks in parallel
                const [myAeo, compAeo] = await Promise.all([
                    auditMultiModelMentions(myDomain),
                    auditMultiModelMentions(competitorDomain)
                ]);

                return {
                    myDomain,
                    myScore: myAeo.overallScore,
                    competitorDomain,
                    competitorScore: compAeo.overallScore,
                    winner: myAeo.overallScore > compAeo.overallScore ? myDomain : (myAeo.overallScore < compAeo.overallScore ? competitorDomain : "Tie"),
                    status: "Comparison complete. Tell the user who is winning in AI search and suggest ways to improve.",
                };
            }

            case "analyzeScreenshot": {
                logger.debug(`[Voice Tool] Analyzing uploaded screenshot`);

                if (!_visionAI) {
                    return { error: "Vision analysis unavailable: GEMINI_API_KEY is not set." };
                }

                const response = await _visionAI.models.generateContent({
                    model: AI_MODELS.GEMINI_FLASH,
                    contents: [
                        {
                            role: "user",
                            parts: [
                                {
                                    inlineData: {
                                        mimeType: args.mimeType || "image/png",
                                        data: args.imageBase64,
                                    },
                                },
                                {
                                    text: `You are an expert SEO and digital marketing analyst. Analyze this screenshot carefully.
${args.context ? `User context: "${args.context}"` : ""}

Provide a concise analysis covering:
1. What this screenshot shows (type of dashboard, metric, time range if visible)
2. The key trend or finding (e.g., a traffic drop on a specific date, a competitor appearing in AI overviews)
3. The most likely cause based on what you can see
4. One specific, actionable recommendation

Keep your response under 150 words — it will be read aloud to the user.`,
                                },
                            ],
                        },
                    ],
                });

                const analysisText =
                    response.candidates?.[0]?.content?.parts?.[0]?.text ??
                    "I couldn't extract a clear analysis from that image. Could you describe what you're seeing?";

                return {
                    analysis: analysisText,
                    status: "Vision analysis complete. Read the analysis to the user verbatim, then ask if they want a full audit or competitor check.",
                };
            }

            case "triggerAutoFix": {
                const domain = parseDomain(args.domain);
                logger.debug(`[Voice Tool] Triggering autofix for ${domain} (${args.issueType})`);

                const site = await prisma.site.findFirst({
                    where: { domain: { contains: domain } },
                    select: { id: true, domain: true, githubRepoUrl: true },
                });

                if (!site) {
                    return {
                        status: "error",
                        message: `No site matching "${domain}" found in your OptiAISEO account. Tell the user to add the site first from the My Sites page.`,
                    };
                }

                if (!site.githubRepoUrl) {
                    return {
                        status: "no_github",
                        message: "This site doesn't have a GitHub repository connected. Tell the user to go to their site settings and add a GitHub repo URL to enable auto-fix Pull Requests.",
                    };
                }

                const check: AeoCheck = {
                    id: args.issueType,
                    category: "technical",
                    label: args.issueType
                        .replace(/-/g, " ")
                        .replace(/\b\w/g, (c: string) => c.toUpperCase()),
                    passed: false,
                    impact: "high",
                    detail: args.issueDetail || `Voice agent flagged issue: ${args.issueType}`,
                    recommendation: args.issueDetail || `Fix the ${args.issueType} issue on ${domain}`,
                };

                const fixResult = await generateAeoFixInternal(check, domain, site.githubRepoUrl);

                if (!fixResult.success) {
                    return {
                        status: "fix_failed",
                        message: `The fix engine couldn't generate a patch: ${fixResult.error}. Tell the user they can fix this manually from the Audit Reports page.`,
                    };
                }

                const prResult = await pushFixToGitHub({
                    repoUrl: site.githubRepoUrl,
                    filePath: fixResult.filePath,
                    content: fixResult.fix,
                    commitMessage: `fix(aeo): ${check.label} — auto-fix via OptiAISEO Voice Agent`,
                    siteId: site.id,
                });

                if (!prResult.success) {
                    return {
                        status: "pr_failed",
                        message: `Fix generated but PR failed: ${prResult.error}. The user may need to reconnect their GitHub account from Settings.`,
                    };
                }

                return {
                    status: "success",
                    prUrl: prResult.url,
                    filePath: fixResult.filePath,
                    message: `Pull Request created successfully. Tell the user their fix for "${check.label}" is ready to review at: ${prResult.url}`,
                };
            }

            case "saveExpertiseInterview": {
                const { siteId, realExperience, realNumbers, localContext } = args as Record<string, string>;
                await prisma.site.update({
                    where: { id: siteId },
                    data: {
                        realExperience: realExperience || undefined,
                        realNumbers:    realNumbers    || undefined,
                        localContext:   localContext   || undefined,
                    },
                });
                return {
                    success: true,
                    message: "Expertise saved to your site profile. All future articles will use these details.",
                };
            }

            default:
                throw new Error(`Unknown tool: ${name}`);
         
        }
     
    } catch (e: unknown) {
        logger.error(`[Voice Tool] Error executing ${name}:`, { error: (e as Error)?.message || String(e) });
        return { error: `Tool execution failed: ${(e as Error).message}` };
    }
}
