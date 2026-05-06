/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';
import { logger } from "@/lib/logger";

import { type ComponentProps } from 'react';
import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useMaybeSessionContext, useMaybeRoomContext } from '@livekit/components-react';
import { type VariantProps } from 'class-variance-authority';
import { PhoneOffIcon } from 'lucide-react';

/**
 * Props for the AgentDisconnectButton component.
 */
export interface AgentDisconnectButtonProps
  extends Omit<ComponentProps<'button'>, 'ref'>,
  VariantProps<typeof buttonVariants> {
  /** Custom icon to display. Defaults to PhoneOffIcon. */
  icon?: React.ReactNode;
  /** The size of the button. @default 'default' */
  size?: 'default' | 'sm' | 'lg' | 'icon';
  /** The variant of the button. @default 'destructive' */
  variant?: 'default' | 'outline' | 'destructive' | 'ghost' | 'link';
  /** The children to render. */
  children?: React.ReactNode;
  /** The callback for when the button is clicked. */
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
}

/**
 * Inner component — only rendered when a LiveKitRoom context exists.
 * Safely calls useSessionContext here.
 */
function DisconnectButtonInner({
  icon,
  size = 'default',
  variant = 'destructive',
  children,
  onClick,
  ...props
}: AgentDisconnectButtonProps) {
  const sessionCtx = useMaybeSessionContext();

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    onClick?.(event);
    if (typeof sessionCtx?.end === 'function') {
      sessionCtx.end();
    }
  };

  return (
     
    <Button size={size} variant={variant} onClick={handleClick} {...props as any}>
      {icon ?? <PhoneOffIcon />}
      {children ?? <span className={cn(size?.includes('icon') && 'sr-only')}>END CALL</span>}
    </Button>
  );
}

/**
 * A button to disconnect from the current agent session.
 * Safe to render outside a LiveKitRoom — renders disabled when no room context is present.
 *
 * @example
 * ```tsx
 * <AgentDisconnectButton onClick={() => logger.debug('Disconnecting...')} />
 * ```
 */
export function AgentDisconnectButton(props: AgentDisconnectButtonProps) {
  const roomContext = useMaybeRoomContext();

  // Guard: don't call useSessionContext outside a LiveKitRoom — it throws
  if (!roomContext) {
    const { icon, size = 'default', variant = 'destructive', children, ...rest } = props;
     
    return (
      <Button size={size} variant={variant} disabled {...rest as any}>
        {icon ?? <PhoneOffIcon />}
        {children ?? <span className={cn(size?.includes('icon') && 'sr-only')}>END CALL</span>}
      </Button>
    );
  }

  return <DisconnectButtonInner {...props} />;
}
