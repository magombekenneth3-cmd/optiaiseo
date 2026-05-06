// src/app/dashboard/planner/RedditPanel.tsx
"use client";

import { useState, useTransition } from "react";
import { updateRedditData } from "@/app/actions/planner";
import { RedditPost } from "@/types/planner";

interface Props {
  siteId: string;
  item: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  onUpdate: (updatedItem: any) => void; // eslint-disable-line @typescript-eslint/no-explicit-any
}

const POST_TYPES = [
  { value: "comment", label: "Comment" },
  { value: "post", label: "Reddit post" },
  { value: "link_drop", label: "Link drop" },
];

export function RedditPanel({ siteId, item, onUpdate }: Props) {
  const [isPending, startTransition] = useTransition();
  const reddit = item.reddit ?? { subreddits: [], posts: [], karmaReady: false };

  const [newSubreddit, setNewSubreddit] = useState("");
  const [newPost, setNewPost] = useState<Partial<RedditPost>>({ type: "comment" });

  const addSubreddit = () => {
    if (!newSubreddit.trim()) return;
    const sub = newSubreddit.startsWith("r/") ? newSubreddit.trim() : `r/${newSubreddit.trim()}`;
    if (reddit.subreddits.includes(sub)) return;
    const updated = { ...reddit, subreddits: [...reddit.subreddits, sub] };
    startTransition(async () => {
      await updateRedditData(siteId, item.id, updated);
      onUpdate({ ...item, reddit: updated });
      setNewSubreddit("");
    });
  };

  const removeSubreddit = (sub: string) => {
    const updated = { ...reddit, subreddits: reddit.subreddits.filter((s: string) => s !== sub) };
    startTransition(async () => {
      await updateRedditData(siteId, item.id, updated);
      onUpdate({ ...item, reddit: updated });
    });
  };

  const toggleKarma = () => {
    const updated = { ...reddit, karmaReady: !reddit.karmaReady };
    startTransition(async () => {
      await updateRedditData(siteId, item.id, updated);
      onUpdate({ ...item, reddit: updated });
    });
  };

  const addPost = () => {
    if (!newPost.subreddit || !newPost.note) return;
    const post: RedditPost = {
      id: `rp-${Date.now()}`,
      subreddit: newPost.subreddit,
      type: newPost.type as RedditPost["type"],
      note: newPost.note,
      date: new Date().toISOString().split("T")[0],
      url: newPost.url,
    };
    const updated = { ...reddit, posts: [post, ...(reddit.posts ?? [])] };
    startTransition(async () => {
      await updateRedditData(siteId, item.id, updated);
      onUpdate({ ...item, reddit: updated });
      setNewPost({ type: "comment" });
    });
  };

  return (
    <div className="space-y-6">

      {/* Karma readiness */}
      <div className="flex items-start gap-3 p-4 rounded-xl border border-border bg-muted/30">
        <input
          type="checkbox"
          checked={reddit.karmaReady}
          onChange={toggleKarma}
          className="mt-1 w-4 h-4 accent-emerald-500"
        />
        <div>
          <p className="text-sm font-semibold">Karma phase complete</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            I&apos;ve commented helpfully 10+ times in target subreddits without any links before promoting this post.
          </p>
        </div>
      </div>

      {/* Target subreddits */}
      <div>
        <h4 className="text-xs uppercase font-bold tracking-wider text-muted-foreground mb-2">Target subreddits</h4>
        <div className="flex gap-2 mb-3">
          <input
            value={newSubreddit}
            onChange={e => setNewSubreddit(e.target.value)}
            onKeyDown={e => e.key === "Enter" && addSubreddit()}
            placeholder="r/forex"
            className="flex-1 bg-muted/40 border border-border rounded-lg px-3 py-1.5 text-sm outline-none focus:border-emerald-500"
          />
          <button
            onClick={addSubreddit}
            disabled={isPending}
            className="px-3 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 text-sm font-bold hover:bg-emerald-500/20"
          >+ Add</button>
        </div>
        <div className="flex flex-wrap gap-2">
          {reddit.subreddits.map((sub: string) => (
            <span key={sub} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-muted/60 border border-border text-xs font-medium">
              {sub}
              <button onClick={() => removeSubreddit(sub)} className="text-muted-foreground hover:text-red-400 leading-none">×</button>
            </span>
          ))}
          {reddit.subreddits.length === 0 && (
            <p className="text-xs text-muted-foreground">No subreddits added yet</p>
          )}
        </div>
      </div>

      {/* Activity log */}
      <div>
        <h4 className="text-xs uppercase font-bold tracking-wider text-muted-foreground mb-2">Activity log</h4>
        <div className="grid grid-cols-2 gap-2 mb-2">
          <input
            value={newPost.subreddit ?? ""}
            onChange={e => setNewPost(p => ({ ...p, subreddit: e.target.value }))}
            placeholder="r/subreddit"
            className="bg-muted/40 border border-border rounded-lg px-3 py-1.5 text-sm outline-none focus:border-emerald-500"
          />
          <select
            value={newPost.type}
            onChange={e => setNewPost(p => ({ ...p, type: e.target.value as RedditPost["type"] }))}
            className="bg-muted/40 border border-border rounded-lg px-3 py-1.5 text-sm outline-none"
          >
            {POST_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <input
            value={newPost.note ?? ""}
            onChange={e => setNewPost(p => ({ ...p, note: e.target.value }))}
            placeholder="What I wrote / shared..."
            className="col-span-2 bg-muted/40 border border-border rounded-lg px-3 py-1.5 text-sm outline-none focus:border-emerald-500"
          />
          <input
            value={newPost.url ?? ""}
            onChange={e => setNewPost(p => ({ ...p, url: e.target.value }))}
            placeholder="Reddit link (optional)"
            className="bg-muted/40 border border-border rounded-lg px-3 py-1.5 text-sm outline-none focus:border-emerald-500"
          />
          <button onClick={addPost} disabled={isPending} className="px-3 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 text-sm font-bold hover:bg-emerald-500/20">
            Log activity
          </button>
        </div>
        <div className="space-y-2 mt-3">
          {(reddit.posts ?? []).map((p: RedditPost) => (
            <div key={p.id} className="flex items-start gap-3 p-3 rounded-lg border border-border bg-muted/20 text-sm">
              <span className="px-1.5 py-0.5 rounded text-[10px] uppercase font-bold bg-muted border border-border text-muted-foreground shrink-0 mt-0.5">
                {p.type.replace("_", " ")}
              </span>
              <div className="min-w-0">
                <p className="font-medium truncate">{p.note}</p>
                <p className="text-xs text-muted-foreground">{p.subreddit} · {p.date}</p>
              </div>
              {p.url && (
                <a href={p.url} target="_blank" rel="noopener noreferrer" className="text-xs text-muted-foreground hover:text-foreground hover:underline shrink-0">↗ View</a>
              )}
            </div>
          ))}
          {(reddit.posts ?? []).length === 0 && (
            <p className="text-xs text-muted-foreground py-2">No activity logged yet</p>
          )}
        </div>
      </div>
    </div>
  );
}
