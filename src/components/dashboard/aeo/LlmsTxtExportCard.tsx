"use client";

import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  AlertCircle,
  Check,
  Copy,
  Download,
  ExternalLink,
  FileText,
  GitPullRequest,
  Link2,
  Loader2,
  RefreshCw,
} from "lucide-react";
import {
  createLlmsTxtPR,
  getLlmsTxtExportData,
  type LlmsTxtExportData,
} from "@/app/actions/llmsTxt";

interface LlmsTxtExportCardProps {
  siteId: string;
  domain: string;
}

type FormatTab = "standard" | "full";
type CopyState = "idle" | "copied" | "error";

export function LlmsTxtExportCard({ siteId, domain }: LlmsTxtExportCardProps) {
  const headingId = useId();
  const standardTabId = useId();
  const fullTabId = useId();
  const panelId = useId();

  const [data, setData] = useState<LlmsTxtExportData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeFormat, setActiveFormat] = useState<FormatTab>("standard");

  const [mdCopyState, setMdCopyState] = useState<CopyState>("idle");
  const [urlCopyState, setUrlCopyState] = useState<CopyState>("idle");
  const [announcement, setAnnouncement] = useState<string>("");

  const [creatingPr, setCreatingPr] = useState<boolean>(false);
  const [prUrl, setPrUrl] = useState<string | null>(null);
  const [prMessage, setPrMessage] = useState<string | null>(null);
  const [prError, setPrError] = useState<string | null>(null);

  const mdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const urlTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const announceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastAnnouncementRef = useRef<string>("");
  const standardTabRef = useRef<HTMLButtonElement | null>(null);
  const fullTabRef = useRef<HTMLButtonElement | null>(null);

  const announce = useCallback((message: string) => {
    if (announceTimerRef.current) clearTimeout(announceTimerRef.current);
    const nextMsg =
      lastAnnouncementRef.current === message ? `${message}\u00A0` : message;
    lastAnnouncementRef.current = nextMsg;
    setAnnouncement(nextMsg);
    announceTimerRef.current = setTimeout(() => {
      setAnnouncement("");
    }, 2500);
  }, []);

  useEffect(() => {
    return () => {
      if (mdTimerRef.current) clearTimeout(mdTimerRef.current);
      if (urlTimerRef.current) clearTimeout(urlTimerRef.current);
      if (announceTimerRef.current) clearTimeout(announceTimerRef.current);
    };
  }, []);

  const loadPreview = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await getLlmsTxtExportData(siteId);
      if (!res.success) {
        setLoadError(res.error);
        setData(null);
      } else {
        setData(res.data);
      }
    } catch {
      setLoadError("Unable to load llms.txt preview right now.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [siteId]);

  useEffect(() => {
    let active = true;
    setPrUrl(null);
    setPrMessage(null);
    setPrError(null);
    setMdCopyState("idle");
    setUrlCopyState("idle");
    setLoading(true);
    setLoadError(null);

    getLlmsTxtExportData(siteId)
      .then((res) => {
        if (!active) return;
        if (!res.success) {
          setLoadError(res.error);
          setData(null);
        } else {
          setData(res.data);
        }
      })
      .catch(() => {
        if (!active) return;
        setLoadError("Unable to load llms.txt preview right now.");
        setData(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [siteId]);

  const activeContent =
    data === null
      ? ""
      : activeFormat === "full"
        ? data.fullContent
        : data.standardContent;

  const activeFilename = activeFormat === "full" ? "llms-full.txt" : "llms.txt";

  const activeDownloadHref =
    data === null
      ? "#"
      : activeFormat === "full"
        ? `${data.hostedFullPath}&download=1`
        : `${data.hostedPath}&download=1`;

  const handleCopyText = async (
    value: string,
    target: "markdown" | "url",
  ) => {
    const setTargetState = target === "markdown" ? setMdCopyState : setUrlCopyState;
    const timerRef = target === "markdown" ? mdTimerRef : urlTimerRef;
    const successLabel =
      target === "markdown"
        ? `${activeFilename} copied to clipboard`
        : "Hosted llms.txt URL copied to clipboard";

    if (timerRef.current) clearTimeout(timerRef.current);

    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard API unavailable");
      }
      await navigator.clipboard.writeText(value);
      setTargetState("copied");
      announce(successLabel);
    } catch {
      setTargetState("error");
      announce("Copy failed. Check clipboard permissions.");
    }

    timerRef.current = setTimeout(() => {
      setTargetState("idle");
    }, 2200);
  };

  const handleCopyHostedUrl = () => {
    if (!data) return;
    const path = activeFormat === "full" ? data.hostedFullPath : data.hostedPath;
    const origin =
      typeof window !== "undefined" && window.location?.origin
        ? window.location.origin
        : "";
    void handleCopyText(`${origin}${path}`, "url");
  };

  const handleCreatePr = async () => {
    if (!data || creatingPr) return;
    setCreatingPr(true);
    setPrUrl(null);
    setPrMessage(null);
    setPrError(null);

    try {
      const res = await createLlmsTxtPR({
        siteId,
        includeFull: true,
      });

      if (!res.success) {
        setPrError(res.error);
        announce(`GitHub PR failed: ${res.error}`);
      } else if (res.alreadyUpToDate) {
        setPrMessage("Repository public/llms.txt and public/llms-full.txt are already up to date.");
        announce("Repository llms.txt files are already up to date.");
      } else if (res.prUrl) {
        setPrUrl(res.prUrl);
        setPrMessage(`Pull Request created with ${res.files.join(" and ")}.`);
        announce("GitHub Pull Request created.");
      } else {
        setPrMessage(`Committed ${res.files.join(" and ")}.`);
      }
    } catch {
      const msg = "Failed to create GitHub Pull Request. Please try again.";
      setPrError(msg);
      announce(msg);
    } finally {
      setCreatingPr(false);
    }
  };

  const handleTabKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft" || e.key === "Home" || e.key === "End") {
      e.preventDefault();
      let next: FormatTab;
      if (e.key === "Home") next = "standard";
      else if (e.key === "End") next = "full";
      else next = activeFormat === "standard" ? "full" : "standard";
      setActiveFormat(next);
      (next === "standard" ? standardTabRef : fullTabRef).current?.focus();
    }
  };

  return (
    <div className="rounded-2xl border border-border bg-card p-5 flex flex-col gap-4">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <span
            aria-hidden="true"
            className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 shrink-0"
          >
            <FileText className="w-4 h-4" />
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 id={headingId} className="text-sm font-bold text-foreground">
                llms.txt &amp; llms-full.txt Generator
              </h2>
              {data && (
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border ${
                    data.compliance.valid
                      ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/25"
                      : "bg-amber-500/10 text-amber-400 border-amber-500/25"
                  }`}
                >
                  {data.compliance.valid
                    ? `Spec Compliant · ${data.compliance.pageEntries} links`
                    : `Partial · ${data.compliance.pageEntries} links`}
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Structured AI crawler index built from verified pages, blogs, brand facts, FAQs, and GSC queries for{" "}
              <span className="text-foreground/90 font-medium">{domain}</span>.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => void loadPreview()}
          disabled={loading}
          className="min-h-8 px-2.5 py-1.5 rounded-lg border border-border bg-background/60 hover:bg-muted text-xs font-medium text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 transition-colors disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <RefreshCw
            aria-hidden="true"
            className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`}
          />
          Refresh
        </button>
      </div>

      {/* Live region kept mounted outside action buttons for reliable screen-reader announcements */}
      <span role="status" aria-live="polite" className="sr-only">
        {announcement}
      </span>

      {loadError && (
        <div
          role="alert"
          className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-xs text-rose-300 flex items-center gap-2"
        >
          <AlertCircle aria-hidden="true" className="w-4 h-4 shrink-0" />
          <span>{loadError}</span>
        </div>
      )}

      {loading && !data ? (
        <div className="rounded-xl border border-border/60 bg-muted/20 p-6 flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" />
          <span>Building full-site llms.txt &amp; llms-full.txt…</span>
        </div>
      ) : (
        data && (
          <>
            {/* Source coverage badges */}
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
              <div className="rounded-lg border border-border/60 bg-background/50 px-2.5 py-1.5">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Core Pages
                </p>
                <p className="text-sm font-bold text-foreground tabular-nums">
                  {data.stats.corePages}
                </p>
              </div>
              <div className="rounded-lg border border-border/60 bg-background/50 px-2.5 py-1.5">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Blogs
                </p>
                <p className="text-sm font-bold text-foreground tabular-nums">
                  {data.stats.blogPosts}
                </p>
              </div>
              <div className="rounded-lg border border-border/60 bg-background/50 px-2.5 py-1.5">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Brand Facts
                </p>
                <p className="text-sm font-bold text-foreground tabular-nums">
                  {data.stats.brandFacts}
                </p>
              </div>
              <div className="rounded-lg border border-border/60 bg-background/50 px-2.5 py-1.5">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  FAQs
                </p>
                <p className="text-sm font-bold text-foreground tabular-nums">
                  {data.stats.faqs}
                </p>
              </div>
              <div className="rounded-lg border border-border/60 bg-background/50 px-2.5 py-1.5">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  GSC Queries
                </p>
                <p className="text-sm font-bold text-foreground tabular-nums">
                  {data.stats.topQueries}
                </p>
              </div>
              <div className="rounded-lg border border-border/60 bg-background/50 px-2.5 py-1.5">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  AEO Data
                </p>
                <p className="text-sm font-bold text-foreground">
                  {data.stats.hasAeoSummary ? "Synced" : "None"}
                </p>
              </div>
            </div>

            {/* Format selector tabs + action toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div
                role="tablist"
                aria-label="llms.txt document format"
                className="inline-flex rounded-lg border border-border bg-background/60 p-0.5"
              >
                <button
                  ref={standardTabRef}
                  type="button"
                  role="tab"
                  id={standardTabId}
                  tabIndex={activeFormat === "standard" ? 0 : -1}
                  aria-selected={activeFormat === "standard"}
                  aria-controls={panelId}
                  onClick={() => setActiveFormat("standard")}
                  onKeyDown={handleTabKeyDown}
                  className={`min-h-8 px-3 py-1 rounded-md text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${
                    activeFormat === "standard"
                      ? "bg-card text-foreground shadow-sm border border-border/70"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  llms.txt
                </button>
                <button
                  ref={fullTabRef}
                  type="button"
                  role="tab"
                  id={fullTabId}
                  tabIndex={activeFormat === "full" ? 0 : -1}
                  aria-selected={activeFormat === "full"}
                  aria-controls={panelId}
                  onClick={() => setActiveFormat("full")}
                  onKeyDown={handleTabKeyDown}
                  className={`min-h-8 px-3 py-1 rounded-md text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${
                    activeFormat === "full"
                      ? "bg-card text-foreground shadow-sm border border-border/70"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  llms-full.txt
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <a
                  href={activeDownloadHref}
                  download={activeFilename}
                  className="min-h-8 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-semibold inline-flex items-center gap-1.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  <Download aria-hidden="true" className="w-3.5 h-3.5" />
                  <span>Download {activeFilename}</span>
                </a>

                <button
                  type="button"
                  onClick={handleCopyHostedUrl}
                  className="min-h-8 min-w-8 px-3 py-1.5 rounded-lg border border-border bg-background/80 hover:bg-muted text-xs font-medium text-foreground inline-flex items-center gap-1.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  {urlCopyState === "copied" ? (
                    <Check aria-hidden="true" className="w-3.5 h-3.5 text-emerald-400" />
                  ) : urlCopyState === "error" ? (
                    <AlertCircle aria-hidden="true" className="w-3.5 h-3.5 text-rose-400" />
                  ) : (
                    <Link2 aria-hidden="true" className="w-3.5 h-3.5" />
                  )}
                  <span>
                    {urlCopyState === "copied"
                      ? "Copied URL"
                      : urlCopyState === "error"
                        ? "Copy failed"
                        : "Copy Hosted URL"}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => void handleCopyText(activeContent, "markdown")}
                  className="min-h-8 min-w-8 px-3 py-1.5 rounded-lg border border-border bg-background/80 hover:bg-muted text-xs font-medium text-foreground inline-flex items-center gap-1.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  {mdCopyState === "copied" ? (
                    <Check aria-hidden="true" className="w-3.5 h-3.5 text-emerald-400" />
                  ) : mdCopyState === "error" ? (
                    <AlertCircle aria-hidden="true" className="w-3.5 h-3.5 text-rose-400" />
                  ) : (
                    <Copy aria-hidden="true" className="w-3.5 h-3.5" />
                  )}
                  <span>
                    {mdCopyState === "copied"
                      ? "Copied"
                      : mdCopyState === "error"
                        ? "Copy failed"
                        : "Copy Markdown"}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => void handleCreatePr()}
                  disabled={creatingPr}
                  className="min-h-8 px-3 py-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 text-xs font-semibold text-emerald-300 inline-flex items-center gap-1.5 transition-colors disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  {creatingPr ? (
                    <Loader2 aria-hidden="true" className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <GitPullRequest aria-hidden="true" className="w-3.5 h-3.5" />
                  )}
                  <span>{creatingPr ? "Creating PR…" : "Create GitHub PR"}</span>
                </button>
              </div>
            </div>

            {/* PR status / setup alert */}
            {prError && (
              <div
                role="alert"
                className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2 text-xs text-amber-200 flex items-center gap-2"
              >
                <AlertCircle aria-hidden="true" className="w-4 h-4 shrink-0 text-amber-400" />
                <span>{prError}</span>
              </div>
            )}

            {prMessage && (
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2 text-xs text-emerald-200 flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  <Check aria-hidden="true" className="w-4 h-4 shrink-0 text-emerald-400" />
                  <span>{prMessage}</span>
                </span>
                {prUrl && (
                  <a
                    href={prUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 font-semibold text-emerald-300 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    <span>Open Pull Request</span>
                    <ExternalLink aria-hidden="true" className="w-3 h-3" />
                  </a>
                )}
              </div>
            )}

            {/* Preview TabPanel */}
            <div
              role="tabpanel"
              id={panelId}
              aria-labelledby={
                activeFormat === "standard" ? standardTabId : fullTabId
              }
              className="rounded-xl border border-border/70 bg-background/70 overflow-hidden"
            >
              <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/60 bg-muted/30 text-[11px] text-muted-foreground">
                <span className="font-mono">{activeFilename}</span>
                <span className="tabular-nums">
                  {activeContent.split("\n").length} lines · {activeContent.length} chars
                </span>
              </div>
              <pre className="p-3.5 max-h-64 overflow-auto text-xs font-mono text-foreground/90 whitespace-pre-wrap break-words leading-relaxed">
                {activeContent}
              </pre>
            </div>
          </>
        )
      )}
    </div>
  );
}
