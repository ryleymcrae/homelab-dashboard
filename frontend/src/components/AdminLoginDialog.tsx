import React from "react";
import { Modal } from "./Modal";
import { LoginForm } from "./LoginForm";

/**
 * Guest mode keeps viewing open, so there's no full-page login gate to
 * escape it -- this is the "become admin" entry point instead, opened
 * from the Header's "Log In" button (only shown when guest mode is on
 * and this client isn't already admin -- see components/Header.tsx).
 */
export function AdminLoginDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal onClose={onClose} size="confirm">
      <div style={{ fontSize: "var(--text-lg)", fontWeight: 700, marginBottom: 4 }}>Log In</div>
      <div style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)", marginBottom: 16 }}>
        Guest mode is active -- log in to make changes.
      </div>
      <LoginForm onSuccess={onClose} />
    </Modal>
  );
}
