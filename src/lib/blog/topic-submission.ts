import { toast } from "sonner";
import { generateBlog } from "@/app/actions/blog";
import {
    refreshExistingPageFromGap,
    type RefreshExistingPageGapInput,
    type RefreshActionResult,
} from "@/app/actions/contentDecay";
import { formatUrlPathForDisplay } from "@/lib/gsc/topic-cluster";
import { showActionError } from "@/lib/ui/action-errors";
import type { SelectedTopicContext } from "@/lib/content/surgical-refresh";

export interface AuthorSubmissionPayload {
    authorName: string;
    authorRole: string;
    authorBio: string;
    realExperience: string;
    realNumbers: string;
    localContext: string;
    keyword: string;
    topicContext?: SelectedTopicContext;
}

export interface TopicDispatchOptions {
    preflightId?: string;
    forceSerpMismatch?: boolean;
    forceExistingPage?: boolean;
    requestId?: string;
}

export interface TopicDispatchDeps {
    generateBlogFn?: typeof generateBlog;
    refreshPageFn?: (input: RefreshExistingPageGapInput) => Promise<RefreshActionResult>;
}

/**
 * Returns true when the selected topic came from an `UPDATE_PAGE` opportunity and
 * the user kept the default `"refresh"` mode rather than switching to `"new_article"`.
 */
export function isSurgicalRefreshSelection(
    author: AuthorSubmissionPayload
): author is AuthorSubmissionPayload & {
    topicContext: SelectedTopicContext & { existingPageUrl: string };
} {
    return (
        author.topicContext?.executionMode === "refresh" &&
        typeof author.topicContext.existingPageUrl === "string" &&
        author.topicContext.existingPageUrl.trim().length > 0
    );
}

/**
 * Pure server-action dispatcher that routes `UPDATE_PAGE` selections in `"refresh"` mode
 * to `refreshExistingPageFromGap` and routes new-article requests to `generateBlog`.
 */
export async function dispatchTopicAction(
    pipelineType: string | undefined,
    siteId: string,
    author: AuthorSubmissionPayload,
    options?: TopicDispatchOptions,
    deps?: TopicDispatchDeps
): Promise<{
    routedMode: "refresh" | "new_article";
    result: RefreshActionResult | Awaited<ReturnType<typeof generateBlog>>;
}> {
    if (isSurgicalRefreshSelection(author)) {
        const refreshPage = deps?.refreshPageFn ?? refreshExistingPageFromGap;
        const { topicContext } = author;
        const result = await refreshPage({
            siteId,
            targetUrl: topicContext.existingPageUrl,
            keyword: author.keyword?.trim() || topicContext.keyword,
            clusterQueries: topicContext.clusterQueries,
            recommendedAction: topicContext.recommendedAction,
            author: {
                authorName: author.authorName,
                authorRole: author.authorRole,
                authorBio: author.authorBio,
                realExperience: author.realExperience,
                realNumbers: author.realNumbers,
                localContext: author.localContext,
            },
            requestId: options?.requestId,
        });
        return { routedMode: "refresh", result };
    }

    const createBlog = deps?.generateBlogFn ?? generateBlog;
    const { topicContext: _omitContext, ...cleanAuthor } = author;
    const result = await createBlog(pipelineType, siteId, cleanAuthor, options);
    return { routedMode: "new_article", result };
}

/**
 * Shared client submission handler for both `/dashboard/blogs` and `/dashboard/keywords`
 * `GenerateBlogButton` triggers: shows mode-accurate loading/success toasts, routes
 * credit/rate-limit codes to the upgrade modal, and resets the request idempotency key.
 */
export async function submitTopicStepperAction(params: {
    pipelineType: string | undefined;
    siteId: string;
    author: AuthorSubmissionPayload;
    options?: Omit<TopicDispatchOptions, "requestId">;
    requestIdRef: { current: string | null };
    setIsPending: (pending: boolean) => void;
    onSuccess: (routedMode: "refresh" | "new_article") => void;
    onUpgradeRequired: () => void;
}): Promise<{ success: boolean; error?: string }> {
    const refreshContext = isSurgicalRefreshSelection(params.author)
        ? params.author.topicContext
        : null;
    const isRefresh = refreshContext !== null;
    params.requestIdRef.current ??= crypto.randomUUID();
    params.setIsPending(true);

    const targetPath = refreshContext
        ? formatUrlPathForDisplay(refreshContext.existingPageUrl) ?? refreshContext.existingPageUrl
        : null;

    const loadingId = toast.loading(
        isRefresh
            ? `Refreshing ${targetPath} with cluster queries…`
            : "Starting… Researching keywords & selecting pipeline."
    );

    try {
        const { routedMode, result } = await dispatchTopicAction(
            params.pipelineType,
            params.siteId,
            params.author,
            { ...params.options, requestId: params.requestIdRef.current }
        );
        toast.dismiss(loadingId);

        if (result && "success" in result && result.success) {
            params.requestIdRef.current = null;
            params.onSuccess(routedMode);

            if (routedMode === "refresh") {
                const refreshRes = result as RefreshActionResult;
                const addedCount = refreshRes.refreshSummary?.clusterQueriesAdded?.length ?? 0;
                const detail = addedCount > 0
                    ? `Updated ${targetPath} and integrated ${addedCount} uncovered cluster ${addedCount === 1 ? "query" : "queries"}.`
                    : `Surgical refresh draft created for ${targetPath}.`;
                toast.success(`Page refresh draft created — ${detail}`, { duration: 8000 });
            } else {
                toast.success("Your post is being written — research and generation are running in the background.", {
                    duration: 8000,
                });
            }
            return { success: true };
        }

        const errRes = result as { success: false; error?: string; code?: string };
        if (
            errRes.code === "insufficient_credits" ||
            errRes.code === "rate_limit" ||
            errRes.code === "credits_locked"
        ) {
            params.onUpgradeRequired();
        } else {
            showActionError(errRes);
        }
        return { success: false, error: errRes.error || "Operation could not be started." };
    } catch (error: unknown) {
        toast.dismiss(loadingId);
        const msg = (error as Error)?.message || "Please check your connection and try again.";
        toast.error(`Network error — ${msg}`);
        return { success: false, error: msg };
    } finally {
        params.setIsPending(false);
    }
}
