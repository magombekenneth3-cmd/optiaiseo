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


export type AuditProfile = 'full' | 'free' | 'page';

const FULL_MODULES: AuditModule[] = [
    BasicsAnalyticsModule,
    TechnicalModule,
    OnPageModule,
    KeywordsModule,
    ContentQualityModule,
    KeywordOptimisationModule,
    ImageSeoModule,
    OffPageModule,
    LocalModule,
    BrandEntityModule,
    SchemaModule,
    AiVisibilityModule,
    PerformanceModule,
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
    ContentQualityModule,
    AccessibilityModule,
    KeywordOptimisationModule,
    ImageSeoModule,
    SchemaModule,
    AiVisibilityModule,
    BrandEntityModule,
    TechnicalModule,
];

const PROFILE_MODULES: Record<AuditProfile, AuditModule[]> = {
    full: FULL_MODULES,
    free: FREE_MODULES,
    page: PAGE_MODULES,
};

/**
 * Factory — builds an AuditEngine pre-loaded with the correct module set.
 *
 * @param profile 'full'  → 15 modules (paid dashboard homepage audit)
 *                'free'  → 3 modules (unauthenticated trial)
 *                'page'  → 10 modules (per-page sub-audit in Inngest fan-out)
 */
export function getAuditEngine(profile: AuditProfile = 'full'): AuditEngine {
    return new AuditEngine(PROFILE_MODULES[profile]);
}

/** @deprecated Use getAuditEngine('full') instead */
export const getFullAuditEngine = () => getAuditEngine('full');

