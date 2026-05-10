/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import { logger } from "@/lib/logger";

import { useState } from "react";
import {
  X, CheckCircle, Loader2, FileText, Code2, Save, Sparkles,
  ChevronDown, ChevronUp, Shield, AlertTriangle, Info,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeExternalLinks from "rehype-external-links";
import { ContentEditor } from "./ContentEditor";
import { toast } from "sonner";
import type { ContentScoreResult } from "@/lib/content-scoring";
import type { CitationCriterion } from "@/lib/blog/ai-citation-template";

interface Blog {
  id: string;
  title: string;
  content: string;
  status: string;
  targetKeywords: string[];
  citationScore?: number | null;
  citationCriteria?: unknown;
}


function CitationScorePanel({
  score,
  criteria,
}: {
  score: number;
  criteria: CitationCriterion[];
}) {
  const [expanded, setExpanded] = useState(false);

  const color =
    score >= 80 ? "text-emerald-400 border-emerald-500/30 bg-emerald-500/8" :
    score >= 60 ? "text-amber-400 border-amber-500/30 bg-amber-500/8" :
                  "text-rose-400 border-rose-500/30 bg-rose-500/8";

  const barColor =
    score >= 80 ? "bg-emerald-500" :
    score >= 60 ? "bg-amber-500" :
                  "bg-rose-500";

  const label =
    score >= 80 ? "Citation Ready" :
    score >= 60 ? "Needs Minor Work" :
                  "Not Citation Ready";

  const topFix = criteria.find((c) => !c.passed && c.weight === Math.max(...criteria.filter(x => !x.passed).map(x => x.weight)));

  return (
    <div className={`rounded-xl border ${color} px-4 py-3 transition-all`}>
      {/* Header row */}
      <div
        className="flex items-center justify-between gap-3 cursor-pointer"
        onClick={() => setExpanded((v) => !v)}
        role="button"
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-2.5">
          <Shield className="w-4 h-4 shrink-0" />
          <div>
            <span className="text-xs font-bold uppercase tracking-wider">
              AI Citation Score
            </span>
            <span className="ml-2 text-xs font-medium opacity-70">{label}</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Mini bar */}
          <div className="hidden sm:flex items-center gap-2 w-28">
            <div className="flex-1 h-1.5 rounded-full bg-current opacity-20">
              <div
                className={`h-1.5 rounded-full ${barColor}`}
                style={{ width: `${score}%` }}
              />
            </div>
            <span className="text-sm font-black tabular-nums">{score}</span>
            <span className="text-xs opacity-60">/100</span>
          </div>
          {expanded ? <ChevronUp className="w-3.5 h-3.5 opacity-60" /> : <ChevronDown className="w-3.5 h-3.5 opacity-60" />}
        </div>
      </div>

      {/* Top fix line — always visible when failing */}
      {!expanded && score < 60 && topFix && (
        <p className="mt-2 text-xs opacity-80 leading-relaxed pl-6.5">
          <span className="font-semibold">Top fix: </span>{topFix.fix}
        </p>
      )}

      {/* Expanded criteria breakdown */}
      {expanded && (
        <div className="mt-3 flex flex-col gap-1.5 pl-1">
          {criteria.map((c) => (
            <div key={c.id} className="flex items-start gap-2.5 text-xs">
              {c.passed ? (
                <CheckCircle className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className={`font-semibold ${c.passed ? "text-foreground" : "text-foreground"}`}>
                    {c.label}
                  </span>
                  <span className={`shrink-0 tabular-nums font-bold text-xs ${c.passed ? "text-emerald-400" : "text-rose-400"}`}>
                    {c.score}/{c.weight}
                  </span>
                </div>
                {!c.passed && (
                  <p className="text-muted-foreground leading-relaxed mt-0.5">
                    {c.fix}
                  </p>
                )}
              </div>
            </div>
          ))}

          {/* Score bar */}
          <div className="mt-2 pt-2 border-t border-current border-opacity-20">
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="opacity-60">Citation readiness</span>
              <span className="font-bold">{score}/100 — threshold: 60</span>
            </div>
            <div className="h-2 rounded-full bg-current opacity-15">
              <div
                className={`h-2 rounded-full transition-all duration-500 ${barColor}`}
                style={{ width: `${score}%` }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


export function ReviewBlogModal({
  blog,
  onClose,
  onPublish,
}: {
  blog: Blog;
  onClose: () => void;
  onPublish: (id: string) => Promise<{ success: boolean; mediumUrl?: string; hashnodeUrl?: string }>;
}) {
  const [isPublishing, setIsPublishing] = useState(false);
  const [isSaving, setIsSaving]         = useState(false);
  const [isImproving, setIsImproving]   = useState(false);
  const [activeTab, setActiveTab]       = useState<"preview" | "editor">("preview");
  const [editedContent, setEditedContent] = useState(blog.content);
  const [scoreResult, setScoreResult]   = useState<ContentScoreResult | null>(null);

  // Parse persisted citation criteria from the blog record
  const citationScore = blog.citationScore ?? null;
  const citationCriteria: CitationCriterion[] = Array.isArray(blog.citationCriteria)
    ? (blog.citationCriteria as CitationCriterion[])
    : [];

  const handlePublish = async () => {
    setIsPublishing(true);
    const { success } = await onPublish(blog.id);
    setIsPublishing(false);
    if (success) onClose();
  };

  const handleSaveEdits = async () => {
    setIsSaving(true);
    try {
      const res = await fetch(`/api/blogs/${blog.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: editedContent }),
      });
      if (!res.ok) throw new Error("Failed to save edits");
      toast.success("Edits saved successfully");
    } catch (error) {
      logger.error("Error:", { error: (error as any)?.message || error });
      toast.error("Failed to save edits");
    } finally {
      setIsSaving(false);
    }
  };

  const handleAIImprove = async () => {
    setIsImproving(true);
    try {
      const issues: string[] = [];
      if (scoreResult) {
        if (scoreResult.topOpportunities?.length) issues.push(...scoreResult.topOpportunities);
        const missingTerms = scoreResult.subScores?.nlpTerms?.missing;
        if (missingTerms?.length) issues.push(`Add missing semantic terms: ${missingTerms.join(", ")}`);
        const missingHeadings = scoreResult.subScores?.headings?.missing;
        if (missingHeadings?.length) issues.push(`Add missing headings: ${missingHeadings.join(", ")}`);
      }

      // Append citation gaps as additional issues so the improve endpoint fixes them too
      const failingCitation = citationCriteria
        .filter((c) => !c.passed)
        .sort((a, b) => b.weight - a.weight)
        .slice(0, 3)
        .map((c) => `[CITATION] ${c.fix}`);

      const res = await fetch(`/api/blogs/${blog.id}/improve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          issues: [...issues, ...failingCitation],
          citationScore,
          scoreData: scoreResult
            ? {
                wordCount:       scoreResult.subScores?.wordCount,
                keywords:        scoreResult.subScores?.exactKeywords,
                readabilityGrade:scoreResult.subScores?.readability?.gradeLevel,
                missingTerms:    scoreResult.subScores?.nlpTerms?.missing,
                missingHeadings: scoreResult.subScores?.headings?.missing,
              }
            : null,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "AI improve failed");
      }

      const { content } = await res.json();
      if (content) {
        setEditedContent(content);
        toast.success("AI has improved the content for citation readiness!", {
          duration: 5000,
          description: "Switch to Content Editor to review the changes.",
        });
        setActiveTab("editor");
      }
    } catch (err: unknown) {
      logger.error("Error:", { error: (err as any)?.message || err });
      toast.error((err as Error).message || "AI improvement failed. Please try again.");
    } finally {
      setIsImproving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80">
      <div
        className={`relative w-full ${
          activeTab === "editor" ? "max-w-7xl" : "max-w-4xl"
        } bg-background border border-border rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] transition-all duration-300`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-card/50">
          <div className="flex-1">
            <h2 className="text-xl font-bold text-foreground pr-8">{blog.title}</h2>
            <div className="flex items-center gap-3 mt-1.5 text-sm text-muted-foreground">
              <span className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-muted border border-border">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                Draft
              </span>
              {blog.targetKeywords?.[0] && (
                <span className="flex items-center gap-1">
                  <span className="font-medium text-muted-foreground">Target:</span>{" "}
                  {blog.targetKeywords[0]}
                </span>
              )}
              {/* Citation score badge */}
              {citationScore !== null && (
                <span
                  className={`flex items-center gap-1 px-2 py-0.5 rounded border text-xs font-bold ${
                    citationScore >= 80
                      ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                      : citationScore >= 60
                        ? "bg-amber-500/10 border-amber-500/30 text-amber-400"
                        : "bg-rose-500/10 border-rose-500/30 text-rose-400"
                  }`}
                >
                  <Shield className="w-3 h-3" />
                  AI Citation: {citationScore}/100
                </span>
              )}
            </div>
          </div>

          {/* Tab Switcher */}
          <div className="flex items-center bg-card border border-border rounded-lg p-1 mr-12">
            <button
              onClick={() => setActiveTab("preview")}
              className={`flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                activeTab === "preview"
                  ? "bg-muted text-foreground shadow"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <FileText className="w-4 h-4" />
              Preview
            </button>
            <button
              onClick={() => setActiveTab("editor")}
              className={`flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                activeTab === "editor"
                  ? "bg-muted text-foreground shadow"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Code2 className="w-4 h-4" />
              Content Editor
            </button>
          </div>

          <button
            onClick={onClose}
            className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded-full transition-colors absolute top-4 right-4"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Citation Score Panel — shown in preview tab when data is available */}
        {activeTab === "preview" && citationScore !== null && citationCriteria.length > 0 && (
          <div className="px-6 pt-4 pb-0">
            <CitationScorePanel score={citationScore} criteria={citationCriteria} />
          </div>
        )}

        {/* Notice when citation score is missing (old blog, pre-migration) */}
        {activeTab === "preview" && citationScore === null && (
          <div className="px-6 pt-4 pb-0">
            <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/40 border border-border rounded-lg px-3 py-2">
              <Info className="w-3.5 h-3.5 shrink-0" />
              AI Citation Score not available for this draft — regenerate to get a score.
            </div>
          </div>
        )}

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto bg-background">
          {activeTab === "preview" ? (
            <div className="p-8 prose prose-invert prose-emerald max-w-none prose-img:rounded-xl prose-img:w-full prose-img:object-cover prose-headings:scroll-m-20">
              <ReactMarkdown
                rehypePlugins={[
                  rehypeRaw,
                  [rehypeExternalLinks, { target: "_blank", rel: ["noopener", "noreferrer"] }],
                ]}
              >
                {editedContent}
              </ReactMarkdown>
            </div>
          ) : (
            <div className="h-full">
              <ContentEditor
                initialContent={editedContent}
                initialKeyword={blog.targetKeywords?.[0] || ""}
                blogId={blog.id}
                onContentChange={(content) => setEditedContent(content)}
                onScoreChange={(score) => setScoreResult(score)}
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border bg-card/50 flex justify-between items-center gap-3">
          <div className="flex items-center gap-2">
            {activeTab === "editor" && (
              <button
                onClick={handleSaveEdits}
                disabled={isSaving}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-foreground bg-muted hover:bg-accent border border-border rounded-lg transition-colors disabled:opacity-50"
              >
                {isSaving ? (
                  <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                ) : (
                  <Save className="w-4 h-4 text-emerald-400" />
                )}
                Save Edits
              </button>
            )}

            {/* AI Improve — targets citation gaps when score < 60 */}
            <button
              onClick={handleAIImprove}
              disabled={isImproving || isPublishing}
              title={
                citationScore !== null && citationScore < 60
                  ? `Fix ${citationCriteria.filter((c) => !c.passed).length} citation gaps to reach 60/100`
                  : "Let Gemini AI rewrite this content to improve quality and citation readiness"
              }
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-purple-300 bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/30 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isImproving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  AI Improving...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  {citationScore !== null && citationScore < 60
                    ? `Fix Citation Gaps (${citationScore}/100)`
                    : "AI Improve"}
                </>
              )}
            </button>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground bg-muted hover:bg-accent rounded-lg transition-colors border border-transparent"
            >
              Cancel
            </button>
            <button
              onClick={handlePublish}
              disabled={isPublishing}
              className="flex items-center gap-2 px-5 py-2 text-sm font-medium text-primary-foreground bg-primary hover:bg-emerald-400 rounded-lg transition-colors shadow-[0_0_15px_rgba(16,185,129,0.2)] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isPublishing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Publishing...
                </>
              ) : (
                <>
                  <CheckCircle className="w-4 h-4" />
                  Approve &amp; Publish
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
