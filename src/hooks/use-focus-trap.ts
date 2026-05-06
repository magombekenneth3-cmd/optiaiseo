import { useEffect, type RefObject } from "react";

const FOCUSABLE_SELECTORS = [
    "a[href]",
    "button:not([disabled])",
    "input:not([disabled])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    "[tabindex]:not([tabindex='-1'])",
].join(", ");

/**
 * Traps keyboard focus inside `ref` while `active` is true.
 * Also focuses the panel element on open and restores focus to `triggerRef` on close.
 *
 * Usage:
 *   const panelRef = useRef<HTMLDivElement>(null);
 *   const triggerRef = useRef<HTMLButtonElement>(null);
 *   useFocusTrap(panelRef, open, triggerRef);
 */
export function useFocusTrap(
    ref: RefObject<HTMLElement | null>,
    active: boolean,
    triggerRef?: RefObject<HTMLElement | null>,
) {
    useEffect(() => {
        if (!active || !ref.current) return;

        // Focus the panel itself on open
        const el = ref.current;
        el.focus();

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key !== "Tab") return;
            const focusable = Array.from(
                el.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS),
            ).filter(n => !n.closest("[hidden]") && !n.closest("[aria-hidden='true']"));

            if (focusable.length === 0) { e.preventDefault(); return; }

            const first = focusable[0];
            const last  = focusable[focusable.length - 1];

            if (e.shiftKey) {
                if (document.activeElement === first || document.activeElement === el) {
                    e.preventDefault();
                    last.focus();
                }
            } else {
                if (document.activeElement === last) {
                    e.preventDefault();
                    first.focus();
                }
            }
        };

        document.addEventListener("keydown", handleKeyDown);

        return () => {
            document.removeEventListener("keydown", handleKeyDown);
            // Restore focus to the trigger element on unmount/close
            triggerRef?.current?.focus();
        };
    }, [active, ref, triggerRef]);
}
