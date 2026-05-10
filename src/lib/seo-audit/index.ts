import { AuditEngine } from './engine';
import type { AuditModule } from './types';
import { BasicsAnalyticsModule } from './modules/basics';
import { OnPageModule } from './modules/onpage';
import { KeywordsModule } from './modules/keywords';
import { OffPageModule } from './modules/offpage';
import { TechnicalModule } from './modules/technical';
import { LocalModule } from './modules/local';
import { SocialModule } from './modules/social';
import { AccessibilityModule } from './modules/accessibility';
import { PerformanceModule } from './modules/performance';
import { ContentQualityModule } from './modules/content-quality';
import { SchemaModule } from './modules/schema';
import { AiVisibilityModule } from './modules/ai-visibility';
import { KeywordOptimisationModule } from './modules/keyword-optimisation';
import { ImageSeoModule } from './modules/image-seo';
import { BrandEntityModule } from './modules/brand-entity';

export * from './types';
export * from './engine';

// Single source of truth for which modules run in each audit profile.
// Both Inngest functions (audit.ts, free-audit.ts) use getAuditEngine() —
// no more duplicated module lists in separate files.

export type AuditProfile = 'full' | 'free' | 'page';

const FULL_MODULES: AuditModule[] = [
    // Technical
    BasicsAnalyticsModule,
    TechnicalModule,
    // Content
    OnPageModule,
    KeywordsModule,
    ContentQualityModule,
    KeywordOptimisationModule,
    ImageSeoModule,
    // Authority + Brand Entity
    OffPageModule,
    LocalModule,
    BrandEntityModule,           // ← Brand Entity Score: org schema, logo, favicon, sameAs
    // AI Visibility
    SchemaModule,
    AiVisibilityModule,
    // Performance
    PerformanceModule,
    // Cross-cutting
    SocialModule,
    AccessibilityModule,
];

const FREE_MODULES: AuditModule[] = [
    OnPageModule,
    TechnicalModule,
    ContentQualityModule,
];

const PAGE_MODULES: AuditModule[] = [
    OnPageModule,
    TechnicalModule,
    SchemaModule,
    AiVisibilityModule,
    KeywordOptimisationModule,
    ImageSeoModule,
    BrandEntityModule,
];

const PROFILE_MODULES: Record<AuditProfile, AuditModule[]> = {
    full: FULL_MODULES,
    free: FREE_MODULES,
    page: PAGE_MODULES,
};

/**
 * Factory — builds an AuditEngine pre-loaded with the correct module set.
 *
 * @param profile 'full'  → all 13 modules (paid dashboard audit)
 *                'free'  → 3 modules (unauthenticated trial)
 *                'page'  → 4 modules (per-page sub-audit in Inngest fan-out)
 */
export function getAuditEngine(profile: AuditProfile = 'full'): AuditEngine {
    return new AuditEngine(PROFILE_MODULES[profile]);
}

/** @deprecated Use getAuditEngine('full') instead */
export const getFullAuditEngine = () => getAuditEngine('full');

