import React from "react";

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
      onKeyDown={(e) => e.key === "Escape" && onClose()}
    >
      <div
        className="card"
        style={{ boxShadow: "var(--shadow-modal)", ...SIZE_STYLES[size] }}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
