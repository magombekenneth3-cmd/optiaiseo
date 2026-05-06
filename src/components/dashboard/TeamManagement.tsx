"use client";

import { useState } from "react";
import { Users, Mail, Shield, Trash2, Clock, CheckCircle, Crown, Eye, Edit3, UserPlus, AlertCircle, Lock } from "lucide-react";
import { toast } from "sonner";
import Image from "next/image";

type Role = "VIEWER" | "EDITOR" | "ADMIN";

interface Member {
    id: string;
    name: string;
    email: string;
    image: string | null;
    role: string;
    joinedAt: string;
}

interface Invitation {
    id: string;
    email: string;
    role: string;
    sentAt: string;
    expiresAt: string;
    token: string;
}

const ROLE_META: Record<Role, { label: string; icon: typeof Eye; color: string; description: string }> = {
    VIEWER: { label: "Viewer", icon: Eye,    color: "text-blue-400",   description: "Read-only access to all reports" },
    EDITOR: { label: "Editor", icon: Edit3,  color: "text-amber-400",  description: "Can run audits and generate content" },
    ADMIN:  { label: "Admin",  icon: Shield, color: "text-violet-400", description: "Full access, cannot manage billing" },
};

function RoleBadge({ role }: { role: string }) {
    const meta = ROLE_META[role as Role] ?? ROLE_META.VIEWER;
    const Icon = meta.icon;
    return (
        <span className={`inline-flex items-center gap-1 text-[11px] font-semibold ${meta.color}`}>
            <Icon className="w-3 h-3" /> {meta.label}
        </span>
    );
}

function Avatar({ name, image }: { name: string; image: string | null }) {
    if (image) return <Image src={image} alt={name} width={32} height={32} className="w-8 h-8 rounded-full object-cover" />;
    const initials = name.split(" ").map(w => w[0]).join("").toUpperCase().substring(0, 2);
    return (
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-brand/60 to-brand flex items-center justify-center text-[10px] font-bold text-white shrink-0">
            {initials}
        </div>
    );
}

interface TeamManagementClientProps {
    members: Member[];
    invitations: Invitation[];
    plan: string;
}

export function TeamManagementClient({ members: initialMembers, invitations: initialInvitations, plan }: TeamManagementClientProps) {
    const [members, setMembers] = useState(initialMembers);
    const [invitations, setInvitations] = useState(initialInvitations);
    const [email, setEmail] = useState("");
    const [role, setRole] = useState<Role>("VIEWER");
    const [loading, setLoading] = useState(false);
    const isFreePlan = plan === "FREE";

    async function handleInvite(e: React.FormEvent) {
        e.preventDefault();
        if (!email.trim()) return;
        setLoading(true);
        try {
            const res = await fetch("/api/team", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({ email, role }),
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error ?? "Failed to invite");
            setInvitations(prev => [json.invitation, ...prev]);
            setEmail("");
            toast.success(`Invitation sent to ${email}`);
        } catch (e: unknown) {
            toast.error(e instanceof Error ? e.message : "Failed to send invitation");
        } finally {
            setLoading(false);
        }
    }

    async function handleRemoveMember(memberId: string) {
        if (!confirm("Remove this team member?")) return;
        try {
            const res = await fetch(`/api/team/${memberId}`, { method: "DELETE", credentials: "include" });
            if (!res.ok) throw new Error("Failed to remove member");
            setMembers(prev => prev.filter(m => m.id !== memberId));
            toast.success("Team member removed");
        } catch {
            toast.error("Failed to remove team member");
        }
    }

    return (
        <div className="max-w-2xl mx-auto space-y-7">
            <div>
                <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
                    <Users className="w-5 h-5 text-brand" /> Team Management
                </h1>
                <p className="text-sm text-muted-foreground mt-1">
                    Invite colleagues to collaborate on your OptiAISEO workspace.
                </p>
            </div>

            {/* Invite form */}
            <div className="card-elevated p-5">
                <h2 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
                    <UserPlus className="w-4 h-4 text-brand" /> Invite Team Member
                </h2>

                {isFreePlan ? (
                    <div className="flex items-start gap-3 p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl">
                        <Lock className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                        <div>
                            <p className="text-sm font-semibold text-amber-300">Pro or Agency plan required</p>
                            <p className="text-xs text-muted-foreground mt-0.5">
                                Team collaboration is available on paid plans.{" "}
                                <a href="/dashboard/billing" className="text-brand underline underline-offset-2">Upgrade now →</a>
                            </p>
                        </div>
                    </div>
                ) : (
                    <form onSubmit={handleInvite} className="flex gap-2 flex-wrap">
                        <input
                            type="email"
                            required
                            value={email}
                            onChange={e => setEmail(e.target.value)}
                            placeholder="colleague@company.com"
                            id="team-invite-email"
                            className="flex-1 min-w-52 bg-accent/30 border border-border rounded-lg px-3 py-2 text-sm placeholder:text-muted-foreground outline-none focus:border-brand transition-colors"
                        />
                        <select
                            value={role}
                            onChange={e => setRole(e.target.value as Role)}
                            id="team-invite-role"
                            className="bg-accent/30 border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-brand"
                        >
                            {(Object.keys(ROLE_META) as Role[]).map(r => (
                                <option key={r} value={r}>{ROLE_META[r].label}</option>
                            ))}
                        </select>
                        <button
                            type="submit"
                            disabled={loading}
                            className="btn-primary px-4 py-2 text-sm rounded-lg disabled:opacity-60 whitespace-nowrap"
                            id="team-invite-submit"
                        >
                            {loading ? "Sending…" : "Send Invite"}
                        </button>
                    </form>
                )}

                {/* Role descriptions */}
                <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {(Object.entries(ROLE_META) as [Role, (typeof ROLE_META)[Role]][]).map(([r, meta]) => {
                        const Icon = meta.icon;
                        return (
                            <div key={r} className="flex gap-2 p-2 rounded-lg bg-accent/20">
                                <Icon className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${meta.color}`} />
                                <div>
                                    <p className="text-[11px] font-semibold">{meta.label}</p>
                                    <p className="text-[10px] text-muted-foreground">{meta.description}</p>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Active members */}
            <div className="card-elevated overflow-hidden">
                <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
                    <h2 className="text-sm font-semibold text-foreground">
                        Active Members <span className="text-muted-foreground font-normal">({members.length})</span>
                    </h2>
                    <span aria-label="You are the workspace owner" title="You are the workspace owner">
                        <Crown className="w-4 h-4 text-amber-400" />
                    </span>
                </div>
                {members.length === 0 ? (
                    <div className="px-5 py-8 text-center text-sm text-muted-foreground">
                        No team members yet — send your first invitation above.
                    </div>
                ) : (
                    <ul className="divide-y divide-border">
                        {members.map(m => (
                            <li key={m.id} className="flex items-center gap-3 px-5 py-3.5">
                                <Avatar name={m.name} image={m.image} />
                                <div className="min-w-0 flex-1">
                                    <p className="text-sm font-medium truncate">{m.name}</p>
                                    <p className="text-xs text-muted-foreground truncate">{m.email}</p>
                                </div>
                                <RoleBadge role={m.role} />
                                <button
                                    onClick={() => handleRemoveMember(m.id)}
                                    className="ml-1 p-1.5 rounded-lg text-muted-foreground hover:text-rose-400 hover:bg-rose-400/10 transition-colors"
                                    aria-label="Remove member"
                                >
                                    <Trash2 className="w-3.5 h-3.5" />
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            {/* Pending invitations */}
            {invitations.length > 0 && (
                <div className="card-elevated overflow-hidden">
                    <div className="px-5 py-3.5 border-b border-border">
                        <h2 className="text-sm font-semibold text-foreground">
                            Pending Invitations <span className="text-muted-foreground font-normal">({invitations.length})</span>
                        </h2>
                    </div>
                    <ul className="divide-y divide-border">
                        {invitations.map(inv => {
                            const expires = new Date(inv.expiresAt);
                            const daysLeft = Math.ceil((expires.getTime() - Date.now()) / 86400_000);
                            return (
                                <li key={inv.id} className="flex items-center gap-3 px-5 py-3.5">
                                    <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center shrink-0">
                                        <Mail className="w-3.5 h-3.5 text-muted-foreground" />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <p className="text-sm font-medium truncate">{inv.email}</p>
                                        <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                                            <Clock className="w-3 h-3" />
                                            Expires in {daysLeft} day{daysLeft !== 1 ? "s" : ""}
                                        </p>
                                    </div>
                                    <RoleBadge role={inv.role} />
                                    <span aria-label="Pending" title="Pending">
                                        <CheckCircle className="w-3.5 h-3.5 text-amber-400 ml-1" />
                                    </span>
                                </li>
                            );
                        })}
                    </ul>
                </div>
            )}

            {/* Agency plan upsell */}
            {plan === "PRO" && (
                <div className="flex items-start gap-3 p-4 bg-violet-500/10 border border-violet-500/20 rounded-xl">
                    <AlertCircle className="w-4 h-4 text-violet-400 shrink-0 mt-0.5" />
                    <div>
                        <p className="text-sm font-semibold text-violet-300">Need more team seats?</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                            The Agency plan includes unlimited seats and client portal access.{" "}
                            <a href="/dashboard/billing" className="text-brand underline underline-offset-2">Upgrade to Agency →</a>
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
}
