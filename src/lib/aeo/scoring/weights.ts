/**
 * scoring/weights.ts — Single source of truth for all AEO scoring weights.
 *
 * Design decisions:
 * - Impact weights are shared across aggregate, layer, and dimension scoring
 *   so a check's impact level is defined once and applied consistently.
 * - Citation prediction weights are check-ID-specific — they model which checks
 *   most influence whether an AI engine will cite the page.
 * - Grade thresholds are defined here so the boundary between "B" and "C" is
 *   never duplicated between the deep audit and the lite audit.
 */

import type { AeoCheck, AeoResult } from "../index";

// ── Impact weights ──────────────────────────────────────────────────────────
// Used by computeLayerScore, computeAggregateScore, and dimension scoring.

export const IMPACT_WEIGHTS: Record<AeoCheck["impact"], number> = {
    high: 15,
    medium: 8,
    low: 4,
} as const;

// ── Grade thresholds ────────────────────────────────────────────────────────

export const GRADE_THRESHOLDS: { min: number; grade: AeoResult["grade"] }[] = [
    { min: 85, grade: "A" },
    { min: 70, grade: "B" },
    { min: 55, grade: "C" },
    { min: 40, grade: "D" },
    { min: 0,  grade: "F" },
];

// ── Citation prediction weights ─────────────────────────────────────────────
// Per-check weights that model how much each check influences the probability
// of an AI engine citing the page. A 0 or missing weight means the check
// doesn't affect citation prediction.

export const CITATION_PREDICTION_WEIGHTS: Record<string, number> = {
    schema_faq: 15,
    schema_organization: 12,
    eeat_author: 10,
    eeat_about: 10,
    content_definitions: 8,
    content_statistics: 10,
    content_entity_density: 12,
    content_micro_answers: 10,
    tech_robots: 8,
    tech_canonical: 5,
} as const;

// ── Dimension → Category mapping ────────────────────────────────────────────
// Maps each dimension to the AeoCheck categories it draws from.

export const DIMENSION_CATEGORIES: Record<
    keyof import("../index").AeoDimensions,
    AeoCheck["category"][]
> = {
    technicalReadiness: ["schema", "technical", "eeat"],
    contentReadiness: ["content"],
    aiVisibility: [],   // computed from GSoV, not checks
    citationQuality: ["citation", "geo", "aio"],
} as const;

// ── Layer → Category mapping ────────────────────────────────────────────────

export const LAYER_CATEGORIES = {
    aeo: ["schema", "eeat", "content", "technical", "citation"] as AeoCheck["category"][],
    geo: ["geo"] as AeoCheck["category"][],
    aio: ["aio"] as AeoCheck["category"][],
} as const;
