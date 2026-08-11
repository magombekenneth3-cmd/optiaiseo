"use client";

import React, { useState } from "react";

export function LiveWhiteLabelPreviewer() {
    const [agencyName, setAgencyName] = useState("Apex Digital SEO Agency");
    const [customDomain, setCustomDomain] = useState("seo.agencyclient.com");
    const [primaryColor, setPrimaryColor] = useState("#06b6d4");
    const [clientName, setClientName] = useState("Acme Corp");

    return (
        <div className="p-6 bg-slate-900 border border-slate-800 rounded-xl shadow-xl">
            <h3 className="text-base font-bold text-white mb-1">
                Autonomous White-Label Agency Autopilot & Live Previewer
            </h3>
            <p className="text-xs text-slate-400 mb-6">
                Customize agency branding, custom CNAME domain, and live client PDF audit reports.
            </p>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Form Controls */}
                <div className="space-y-4">
                    <div>
                        <label className="block text-xs font-semibold text-slate-300 mb-1">
                            Agency Business Name
                        </label>
                        <input
                            type="text"
                            value={agencyName}
                            onChange={(e) => setAgencyName(e.target.value)}
                            className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-md text-xs text-white focus:outline-none focus:border-cyan-500"
                        />
                    </div>

                    <div>
                        <label className="block text-xs font-semibold text-slate-300 mb-1">
                            Custom CNAME Domain
                        </label>
                        <input
                            type="text"
                            value={customDomain}
                            onChange={(e) => setCustomDomain(e.target.value)}
                            className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-md text-xs text-white focus:outline-none focus:border-cyan-500"
                        />
                    </div>

                    <div>
                        <label className="block text-xs font-semibold text-slate-300 mb-1">
                            Client Organization Name
                        </label>
                        <input
                            type="text"
                            value={clientName}
                            onChange={(e) => setClientName(e.target.value)}
                            className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-md text-xs text-white focus:outline-none focus:border-cyan-500"
                        />
                    </div>

                    <div>
                        <label className="block text-xs font-semibold text-slate-300 mb-1">
                            Primary Accent Brand Color
                        </label>
                        <div className="flex items-center gap-3">
                            <input
                                type="color"
                                value={primaryColor}
                                onChange={(e) => setPrimaryColor(e.target.value)}
                                className="h-8 w-14 bg-transparent border-0 cursor-pointer rounded"
                            />
                            <span className="text-xs text-slate-400 font-mono">{primaryColor}</span>
                        </div>
                    </div>

                    <div className="pt-2">
                        <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-md text-xs text-emerald-400 font-medium flex items-center justify-between">
                            <span>CNAME Active: {customDomain}</span>
                            <span className="font-bold text-emerald-400">Target: cname.optiaiseo.com</span>
                        </div>
                    </div>
                </div>

                {/* Live PDF Digest Preview Pane */}
                <div className="p-5 bg-slate-950 border border-slate-800 rounded-lg shadow-inner flex flex-col justify-between min-h-[320px]">
                    <div>
                        <div className="flex items-center justify-between pb-3 mb-4 border-b border-slate-800">
                            <div className="flex items-center gap-2">
                                <div
                                    className="w-3 h-3 rounded-full"
                                    style={{ backgroundColor: primaryColor }}
                                ></div>
                                <span className="text-xs font-bold text-white">{agencyName}</span>
                            </div>
                            <span className="text-[10px] text-slate-500 font-mono">{customDomain}</span>
                        </div>

                        <div className="text-center py-4">
                            <h4 className="text-sm font-extrabold text-white">{clientName}</h4>
                            <p className="text-[11px] text-slate-400">
                                Executive AEO & Generative Search Visibility Audit
                            </p>
                        </div>

                        <div className="grid grid-cols-2 gap-2 my-4">
                            <div className="p-2.5 bg-slate-900 border border-slate-800 rounded text-center">
                                <span className="text-[10px] text-slate-400 block">Overall Health</span>
                                <span className="text-base font-bold text-emerald-400">94/100</span>
                            </div>
                            <div className="p-2.5 bg-slate-900 border border-slate-800 rounded text-center">
                                <span className="text-[10px] text-slate-400 block">LLM Citation Rate</span>
                                <span className="text-base font-bold text-sky-400">90%</span>
                            </div>
                        </div>
                    </div>

                    <div className="pt-3 border-t border-slate-800 text-[10px] text-slate-500 flex items-center justify-between">
                        <span>Report generated for {clientName}</span>
                        <span>Powered by {agencyName}</span>
                    </div>
                </div>
            </div>
        </div>
    );
}
