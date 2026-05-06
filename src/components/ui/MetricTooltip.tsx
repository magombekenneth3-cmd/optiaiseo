"use client";
import { HelpCircle } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface MetricTooltipProps {
    label: string;
    definition: string;
    range?: string;
}

export function MetricTooltip({ label, definition, range }: MetricTooltipProps) {
    return (
        <TooltipProvider delay={200}>
            <Tooltip>
                <TooltipTrigger
                    render={
                        <span className="inline-flex items-center gap-1 cursor-help">
                            {label}
                            <HelpCircle className="w-3.5 h-3.5 text-muted-foreground/50 hover:text-muted-foreground transition-colors" />
                        </span>
                    }
                />
                <TooltipContent side="top" className="max-w-[240px] text-xs">
                    <p>{definition}</p>
                    {range && <p className="mt-1 text-muted-foreground">{range}</p>}
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
    );
}
