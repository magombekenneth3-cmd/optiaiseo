"use client";

import { useState } from "react";
import { Key, Plus, Trash2, Copy, Check, Eye, EyeOff } from "lucide-react";
import { createApiKey, listApiKeys, revokeApiKey } from "@/app/actions/apiKey";

type KeyRow = {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
};

function timeAgo(date: Date | null): string {
  if (!date) return "Never";
  const diff = Date.now() - new Date(date).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return `${days}d ago`;
}

function KeyRow({ row, onRevoke }: { row: KeyRow; onRevoke: (id: string) => void }) {
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleRevoke = async () => {
    if (!confirming) { setConfirming(true); return; }
    setLoading(true);
    await revokeApiKey(row.id);
    onRevoke(row.id);
  };

  return (
    <div className="flex items-center justify-between gap-4 p-4 rounded-xl border border-border bg-card">
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
          <Key className="w-4 h-4 text-muted-foreground" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground truncate">{row.name}</p>
          <p className="text-xs text-muted-foreground font-mono">{row.keyPrefix}••••••••••••</p>
        </div>
      </div>
      <div className="hidden sm:flex items-center gap-6 text-xs text-muted-foreground shrink-0">
        <span>Last used: {timeAgo(row.lastUsedAt)}</span>
        <span className="px-2 py-0.5 rounded-full border border-border bg-muted/40 font-mono">{row.scopes.join(", ")}</span>
      </div>
      <button
        onClick={handleRevoke}
        disabled={loading}
        aria-label={confirming ? "Confirm revoke API key" : "Revoke API key"}
        className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
          confirming
            ? "bg-red-500/10 text-red-400 border border-red-500/25 hover:bg-red-500/20"
            : "border border-border text-muted-foreground hover:text-foreground hover:border-red-500/30"
        }`}
      >
        <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
        {confirming ? "Confirm" : "Revoke"}
      </button>
    </div>
  );
}

function NewKeyResult({ rawKey, onDismiss }: { rawKey: string; onDismiss: () => void }) {
  const [copied, setCopied] = useState(false);
  const [visible, setVisible] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(rawKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="p-4 rounded-xl border border-emerald-500/25 bg-emerald-500/5">
      <p className="text-xs font-bold text-emerald-400 mb-2 uppercase tracking-wider">Save your key — it won&apos;t be shown again</p>
      <div className="flex items-center gap-2">
        <code className="flex-1 text-xs font-mono bg-background border border-border rounded-lg px-3 py-2 text-foreground overflow-hidden">
          {visible ? rawKey : `${rawKey.slice(0, 12)}${"•".repeat(40)}`}
        </code>
        <button
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Hide key" : "Show key"}
          className="p-2 rounded-lg border border-border hover:bg-accent transition-colors"
        >
          {visible ? <EyeOff className="w-4 h-4" aria-hidden="true" /> : <Eye className="w-4 h-4" aria-hidden="true" />}
        </button>
        <button
          onClick={copy}
          aria-label="Copy API key"
          className="p-2 rounded-lg border border-border hover:bg-accent transition-colors"
        >
          {copied ? <Check className="w-4 h-4 text-emerald-400" aria-hidden="true" /> : <Copy className="w-4 h-4" aria-hidden="true" />}
        </button>
      </div>
      <button onClick={onDismiss} className="mt-3 text-xs text-muted-foreground hover:text-foreground transition-colors">
        I&apos;ve saved it — dismiss
      </button>
    </div>
  );
}

interface Props {
  initialKeys: KeyRow[];
}

export function ApiKeyManager({ initialKeys }: Props) {
  const [keys, setKeys] = useState<KeyRow[]>(initialKeys);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [error, setError] = useState("");

  const handleCreate = async () => {
    if (!name.trim()) { setError("Enter a name for the key."); return; }
    setCreating(true);
    setError("");
    const res = await createApiKey(name.trim());
    if (res.success) {
      setNewKey(res.key);
      setName("");
      const fresh = await listApiKeys();
      if (fresh.success) setKeys(fresh.keys.map((k) => ({ ...k, lastUsedAt: k.lastUsedAt ? new Date(k.lastUsedAt) : null, expiresAt: k.expiresAt ? new Date(k.expiresAt) : null, createdAt: new Date(k.createdAt) })));
    } else {
      setError(res.error);
    }
    setCreating(false);
  };

  const handleRevoke = (id: string) => setKeys((prev) => prev.filter((k) => k.id !== id));

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          placeholder="e.g. Agency dashboard integration"
          aria-label="API key name"
          maxLength={64}
          className="flex-1 h-10 px-4 text-sm bg-background border border-border rounded-xl focus:outline-none focus:border-foreground/40 transition-colors"
        />
        <button
          onClick={handleCreate}
          disabled={creating}
          aria-label="Create API key"
          className="h-10 px-4 rounded-xl bg-foreground text-background text-sm font-semibold hover:opacity-90 transition-all disabled:opacity-50 flex items-center gap-2"
        >
          <Plus className="w-4 h-4" aria-hidden="true" />
          {creating ? "Creating…" : "Create"}
        </button>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}
      {newKey && <NewKeyResult rawKey={newKey} onDismiss={() => setNewKey(null)} />}

      <div className="space-y-2">
        {keys.length === 0
          ? <p className="text-sm text-muted-foreground text-center py-8">No API keys yet. Create one above.</p>
          : keys.map((k) => <KeyRow key={k.id} row={k} onRevoke={handleRevoke} />)
        }
      </div>

      <div className="p-4 rounded-xl border border-border bg-card/50">
        <p className="text-xs font-bold text-foreground mb-2">API Usage</p>
        <code className="text-xs font-mono text-muted-foreground block">
          GET /api/v1/aeo/score?siteId=YOUR_SITE_ID
        </code>
        <code className="text-xs font-mono text-muted-foreground block mt-1">
          Authorization: Bearer oai_your_key_here
        </code>
      </div>
    </div>
  );
}
