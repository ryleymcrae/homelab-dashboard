import React, { useEffect, useRef } from "react";

interface ModalProps {
  children: React.ReactNode;
  onClose: () => void;
  /** "confirm": small centered card, for a yes/no decision.
   *  "panel": larger card with a fixed height, for scrollable content
   *  (logs, config editors, diffs...). Both share the same overlay,
   *  border, radius, and shadow -- only size differs. */
  size?: "confirm" | "panel";
}

const SIZE_STYLES: Record<NonNullable<ModalProps["size"]>, React.CSSProperties> = {
  confirm: { maxWidth: 360, width: "100%" },
  panel: { maxWidth: 720, width: "100%", height: "80%", display: "flex", flexDirection: "column" },
};

/**
 * Shared shell for every dialog in the app -- dark overlay, centered
 * `.card`, click-outside (or Escape) to close. Introduced so
 * ConfirmDialog and LogsDialog (and every new admin-action dialog) look
 * and behave identically instead of each reinventing the overlay.
 */
export function Modal({ children, onClose, size = "confirm" }: ModalProps) {
  const card = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // Escape closes from anywhere, not only while focus happens to be on
  // the overlay; and focus moves into the dialog (unless something in it,
  // like a typed-confirmation field, already took it) so keyboard and
  // screen-reader users land where the dialog is.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeRef.current();
    document.addEventListener("keydown", onKey);
    if (!card.current?.contains(document.activeElement)) card.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(6, 10, 16, 0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
        padding: "var(--space-4)",
      }}
      onClick={onClose}
    >
      <div
        ref={card}
        tabIndex={-1}
        className="card"
        style={{ boxShadow: "var(--shadow-modal)", outline: "none", ...SIZE_STYLES[size] }}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
