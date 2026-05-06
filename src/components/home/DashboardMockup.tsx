"use client";

import { AuditChart } from "@/components/dashboard/AuditChart";

export function DashboardMockup() {
    return (
        <div className="w-full max-w-5xl mx-auto rounded-2xl border border-white/10 bg-zinc-950 shadow-2xl overflow-hidden flex flex-col md:flex-row h-[500px] text-left">
            {/* Fake Sidebar */}
            <div className="w-16 md:w-56 border-r border-white/5 bg-white/[0.02] flex flex-col p-4 shrink-0">
                <div className="flex items-center gap-2 mb-8 px-2">
                    <div className="w-6 h-6 rounded bg-gradient-to-br from-emerald-500 to-blue-500 shrink-0" />
                    <div className="hidden md:block text-sm font-bold text-white tracking-tight">SEO UI</div>
                </div>
                <div className="flex flex-col gap-3">
                    {['Dashboard', 'Audit Reports', 'Content & Blogs', 'Settings'].map((item, i) => (
                        <div key={i} className={`flex items-center gap-3 p-2 rounded-lg ${i === 0 ? 'bg-white/5 text-emerald-400' : 'text-zinc-500'}`}>
                            <div className={`w-5 h-5 rounded shrink-0 ${i === 0 ? 'bg-emerald-500/20' : 'bg-zinc-800'}`} />
                            <div className="hidden md:block text-xs font-medium">{item}</div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Fake Main Content */}
            <div className="flex-1 flex flex-col p-6 w-full overflow-hidden">
                {/* Fake Header */}
                <div className="flex items-center justify-between mb-8">
                    <div className="text-lg font-bold text-white">Dashboard Overview</div>
                    <div className="flex gap-2 items-center">
                        <div className="w-8 h-8 rounded-full bg-zinc-800 border border-white/10" />
                        <div className="px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-bold">Pro Plan</div>
                    </div>
                </div>

                {/* Fake Metrics Row */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8 z-10 relative">
                    <div className="p-4 rounded-xl border border-white/5 bg-white/[0.02] flex flex-col gap-1 backdrop-blur-sm relative overflow-hidden group">
                        <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                        <div className="text-xs font-medium text-zinc-500">Average SEO Score</div>
                        <div className="text-2xl font-bold text-white relative flex items-center gap-2">
                           92%
                           <span className="relative flex h-2 w-2">
                             <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                             <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                           </span>
                        </div>
                        <div className="text-[10px] text-emerald-400 font-medium">+4% this week</div>
                    </div>
                    <div className="p-4 rounded-xl border border-white/5 bg-white/[0.02] flex flex-col gap-1 backdrop-blur-sm relative overflow-hidden group">
                        <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                        <div className="text-xs font-medium text-zinc-500">Pending PR Fixes</div>
                        <div className="text-2xl font-bold text-white">3</div>
                        <div className="text-[10px] text-zinc-500 font-medium">awaiting merge</div>
                    </div>
                    <div className="p-4 rounded-xl border border-white/5 bg-white/[0.02] flex flex-col gap-1 backdrop-blur-sm">
                        <div className="text-xs font-medium text-zinc-500">Content Generated</div>
                        <div className="text-2xl font-bold text-white">14</div>
                        <div className="text-[10px] text-emerald-400 font-medium">blogs this week</div>
                    </div>
                </div>

                {/* Fake Chart */}
                <div className="flex-1 rounded-xl border border-white/5 bg-white/[0.02] p-4 flex flex-col overflow-hidden relative backdrop-blur-sm">
                    <div className="text-sm font-semibold text-white mb-2 z-10">Recent Audit Activity</div>
                    <div className="absolute inset-0 top-10 pointer-events-none opacity-80">
                        <AuditChart />
                    </div>
                </div>
            </div>
        </div>
    );
}
