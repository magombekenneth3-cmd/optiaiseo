"use client";

import { signIn } from "next-auth/react";
import {
    type ButtonHTMLAttributes,
    type ReactNode,
    useState,
} from "react";

type OAuthProvider = "google-gsc" | "google-ga4" | "github" | "google";

interface OAuthConnectButtonProps
    extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "onClick" | "type"> {
    provider: OAuthProvider;
    callbackUrl: string;
    children: ReactNode;
    connectingChildren?: ReactNode;
}

/**
 * Starts an OAuth connection through NextAuth's CSRF-protected client API.
 * Do not replace this with a link to `/api/auth/signin/<provider>`: with a
 * custom NextAuth sign-in page, a GET request is redirected to that page
 * instead of starting the provider authorization flow.
 */
export function OAuthConnectButton({
    provider,
    callbackUrl,
    children,
    connectingChildren,
    disabled,
    ...buttonProps
}: OAuthConnectButtonProps) {
    const [connecting, setConnecting] = useState(false);

    const handleConnect = async () => {
        if (connecting || disabled) return;

        setConnecting(true);
        try {
            await signIn(provider, { callbackUrl });
        } catch {
            // Network failures leave the user on this page; make the CTA usable again.
            setConnecting(false);
        }
    };

    return (
        <button
            {...buttonProps}
            type="button"
            onClick={handleConnect}
            disabled={disabled || connecting}
            aria-busy={connecting || undefined}
        >
            {connecting && connectingChildren ? connectingChildren : children}
        </button>
    );
}
