"use client";

import { createContext, useContext, useState } from "react";
import type { ReactNode } from "react";
import type { NormalisedIssue } from "@/lib/seo-audit/parse-audit-result";

export type SeverityFilter = "all" | "critical" | "high" | "medium" | "low";

type FilterContextValue = {
    activeFilter: SeverityFilter;
    setActiveFilter: (f: SeverityFilter) => void;
};

const FilterContext = createContext<FilterContextValue>({
    activeFilter: "all",
    setActiveFilter: () => {},
});

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
    const [activeFilter, setActiveFilter] = useState<SeverityFilter>("all");

    return (
        <FilterContext.Provider value={{ activeFilter, setActiveFilter }}>
            {children}
        </FilterContext.Provider>
    );
}
