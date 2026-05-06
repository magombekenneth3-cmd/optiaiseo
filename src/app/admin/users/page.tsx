"use client";
import { useEffect, useState, useCallback } from "react";
import { Search, ChevronLeft, ChevronRight } from "lucide-react";
import { UserSubscriptionEditor } from "@/components/admin/UserSubscriptionEditor";

interface AdminUser {
  id: string;
  name: string | null;
  email: string | null;
  tier: string;
  role: string;
  joinDate: string;
  sitesCount: number;
  blogsCount: number;
  auditsCount: number;
}

interface UsersResponse {
  users: AdminUser[];
  total: number;
  page: number;
  pages: number;
}

const TIER_OPTS = ["", "FREE", "PRO", "AGENCY"] as const;

function TierBadge({ tier }: { tier: string }) {
  const cls =
    tier === "PRO"
      ? "admin-tier-pro"
      : tier === "AGENCY"
        ? "admin-tier-agency"
        : "admin-tier-free";
  return <span className={`admin-tier-badge ${cls}`}>{tier}</span>;
}

export default function AdminUsersPage() {
  const [data, setData] = useState<UsersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [tier, setTier] = useState("");
  const [page, setPage] = useState(1);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page) });
    if (search) params.set("search", search);
    if (tier) params.set("tier", tier);
    const res = await fetch(`/api/admin/users?${params}`);
    const json = await res.json();
    setData(json);
    setLoading(false);
  }, [page, search, tier]);

  useEffect(() => {
    const timeout = setTimeout(fetchUsers, 300);
    return () => clearTimeout(timeout);
  }, [fetchUsers]);

  const handleTierUpdate = (userId: string, newTier: string) => {
    setData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        users: prev.users.map((u) => (u.id === userId ? { ...u, tier: newTier } : u)),
      };
    });
  };

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="admin-page-title">Users</h1>
        <p className="admin-page-subtitle">
          {data ? `${data.total.toLocaleString()} total users` : "Loading…"}
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30 pointer-events-none" />
          <input
            id="user-search"
            className="admin-input pl-9"
            placeholder="Search by name or email…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
        </div>
        <select
          id="tier-filter"
          className="admin-select"
          value={tier}
          onChange={(e) => { setTier(e.target.value); setPage(1); }}
        >
          <option value="">All Tiers</option>
          {TIER_OPTS.slice(1).map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="admin-table-wrapper">
        <table className="admin-table">
          <thead>
            <tr>
              <th>User</th>
              <th>Tier</th>
              <th>Sites</th>
              <th>Blogs</th>
              <th>Audits</th>
              <th>Joined</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <tr key={i}>
                  {Array.from({ length: 6 }).map((_, j) => (
                    <td key={j}>
                      <div className="admin-skeleton h-4 rounded w-24" />
                    </td>
                  ))}
                </tr>
              ))
            ) : data?.users.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center py-12 text-white/30">
                  No users found
                </td>
              </tr>
            ) : (
              data?.users.map((user) => (
                <tr key={user.id}>
                  <td>
                    <div>
                      <p className="font-medium text-white">{user.name ?? "—"}</p>
                      <p className="text-xs text-white/40">{user.email}</p>
                    </div>
                  </td>
                  <td>
                    <UserSubscriptionEditor
                      userId={user.id}
                      currentTier={user.tier as "FREE" | "PRO" | "AGENCY"}
                      onUpdate={(newTier) => handleTierUpdate(user.id, newTier)}
                    />
                  </td>
                  <td>{user.sitesCount}</td>
                  <td>{user.blogsCount}</td>
                  <td>{user.auditsCount}</td>
                  <td className="text-white/50 text-xs">{formatDate(user.joinDate)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {data && data.pages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-white/30">
            Page {data.page} of {data.pages}
          </p>
          <div className="flex items-center gap-2">
            <button
              id="users-prev-page"
              className="admin-page-btn"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            {Array.from({ length: Math.min(data.pages, 7) }, (_, i) => i + 1).map((p) => (
              <button
                key={p}
                className={`admin-page-btn ${p === page ? "admin-page-btn-active" : ""}`}
                onClick={() => setPage(p)}
              >
                {p}
              </button>
            ))}
            <button
              id="users-next-page"
              className="admin-page-btn"
              disabled={page >= data.pages}
              onClick={() => setPage((p) => p + 1)}
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
