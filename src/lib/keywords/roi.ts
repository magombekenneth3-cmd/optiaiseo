const CTR_CURVE: Record<number, number> = {
    1: 0.278, 2: 0.154, 3: 0.113, 4: 0.082, 5: 0.062,
    6: 0.048, 7: 0.038, 8: 0.031, 9: 0.025, 10: 0.022,
};

export interface RoiEstimate {
    estimatedClicks:     number;
    estimatedRevenueUsd: number;
    revenueRangeMin:     number;
    revenueRangeMax:     number;
    ctr:                 number;
    confidence:          "high" | "medium" | "low";
}

export function estimateKeywordRoi(params: {
    position:      number;
    searchVolume:  number;
    cpc:           number;
    hasAnswerBox?: boolean;
    hasLocalPack?: boolean;
}): RoiEstimate {
    const { position, searchVolume, cpc, hasAnswerBox, hasLocalPack } = params;

    let ctr = CTR_CURVE[Math.min(position, 10)] ?? 0.01;
    if (hasAnswerBox) ctr *= 0.78;
    if (hasLocalPack) ctr *= 0.85;

    const estimatedClicks     = Math.round(searchVolume * ctr);
    const conversionProxy     = 0.4;
    const estimatedRevenueUsd = estimatedClicks * cpc * conversionProxy;

    const confidence: RoiEstimate["confidence"] =
        searchVolume > 500 && position <= 10 ? "high" :
        searchVolume > 100 ? "medium" : "low";

    return {
        estimatedClicks,
        estimatedRevenueUsd:  Math.round(estimatedRevenueUsd * 100) / 100,
        revenueRangeMin:      Math.round(estimatedRevenueUsd * 0.5  * 100) / 100,
        revenueRangeMax:      Math.round(estimatedRevenueUsd * 2.0  * 100) / 100,
        ctr:                  Math.round(ctr * 10000) / 100,
        confidence,
    };
}

export function opportunityGap(params: {
    currentPosition: number;
    searchVolume:    number;
    cpc:             number;
}): number {
    const current = estimateKeywordRoi({ ...params, position: params.currentPosition });
    const target  = estimateKeywordRoi({ ...params, position: 3 });
    return Math.round(target.estimatedRevenueUsd - current.estimatedRevenueUsd);
}
