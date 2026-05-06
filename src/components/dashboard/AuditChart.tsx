/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import {
    AreaChart,
    Area,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer
} from "recharts";

 
export function AuditChart({ data }: { data?: any[] }) {
    if (!data || data.length === 0) {
        return (
            <div className="w-full h-full min-h-[300px] mt-4 flex items-center justify-center border border-dashed border-border rounded-xl bg-white/[0.01]">
                <div className="flex flex-col items-center gap-2 text-muted-foreground text-center p-6">
                    <svg className="w-8 h-8 opacity-50 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                    </svg>
                    <p className="text-sm font-medium text-zinc-300">No audit data available yet</p>
                    <p className="text-xs text-muted-foreground max-w-xs">Run your first audit from the Audits page to start tracking your SEO performance trends over time.</p>
                </div>
            </div>
        );
    }

    return (
        <div className="w-full mt-4" style={{ height: 'clamp(160px, 35vw, 300px)' }}>
            <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                    data={data}
                    margin={{
                        top: 10,
                        right: 0,
                        left: -20,
                        bottom: 0,
                    }}
                >
                    <defs>
                        <linearGradient id="colorScore" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                        </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" vertical={false} />
                    <XAxis
                        dataKey="name"
                        stroke="#a1a1aa"
                        fontSize={12}
                        tickLine={false}
                        axisLine={false}
                        dy={10}
                    />
                    <YAxis
                        stroke="#a1a1aa"
                        fontSize={12}
                        tickLine={false}
                        axisLine={false}
                        dx={-10}
                        domain={[0, 100]}
                    />
                    <Tooltip
                        contentStyle={{
                            backgroundColor: '#09090b',
                            borderColor: '#ffffff10',
                            borderRadius: '8px',
                            fontSize: '12px',
                            boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
                        }}
                        itemStyle={{ color: '#10b981' }}
                    />
                    <Area
                        type="monotone"
                        dataKey="score"
                        stroke="#10b981"
                        strokeWidth={3}
                        fillOpacity={1}
                        fill="url(#colorScore)"
                        activeDot={{ r: 6, fill: "#10b981", stroke: "#09090b", strokeWidth: 2 }}
                    />
                </AreaChart>
            </ResponsiveContainer>
        </div>
    );
}
