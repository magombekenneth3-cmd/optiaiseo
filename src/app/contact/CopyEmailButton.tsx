'use client';

import { useState } from 'react';
import { Copy, Check } from 'lucide-react';

export function CopyEmailButton({ email }: { email: string }) {
    const [copied, setCopied] = useState(false);

    async function handleCopy() {
        try {
            await navigator.clipboard.writeText(email);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            const el = document.createElement('textarea');
            el.value = email;
            document.body.appendChild(el);
            el.select();
            document.execCommand('copy');
            document.body.removeChild(el);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    }

    return (
        <button
            onClick={handleCopy}
            aria-label={copied ? 'Copied!' : `Copy ${email} to clipboard`}
            title={copied ? 'Copied!' : 'Copy email'}
            className="inline-flex items-center gap-1 ml-2 px-2 py-0.5 rounded-lg text-xs font-medium transition-all"
            style={{
                background: copied ? 'rgba(16,185,129,0.12)' : 'var(--muted)',
                color: copied ? 'var(--brand)' : 'var(--muted-foreground)',
                border: `1px solid ${copied ? 'rgba(16,185,129,0.3)' : 'var(--border)'}`,
            }}
        >
            {copied
                ? <><Check className="w-3 h-3" /> Copied!</>
                : <><Copy className="w-3 h-3" /> Copy</>
            }
        </button>
    );
}
