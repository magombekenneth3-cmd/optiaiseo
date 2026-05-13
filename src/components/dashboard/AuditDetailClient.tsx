"use client";

import { createContext, useContext, useState } from "react";
import type { ReactNode } from "react";
import type { NormalisedIssue } from "@/lib/seo-audit/parse-audit-result";

export type SeverityFilter = "all" | "critical" | "high" | "medium" | "low";

const FilterContext = createContext<SeverityFilter>("all");

export function useAuditFilter() {
    return useContext(FilterContext);
}

interface Props {
    domain: string;
    issues: NormalisedIssue[];
    runDate: string;
    children: ReactNode;
}

export function AuditDetailClient({ children }: Props) {
    const [activeFilter] = useState<SeverityFilter>("all");

    return (
        <FilterContext.Provider value={activeFilter}>
            {children}
        </FilterContext.Provider>
    );
}
