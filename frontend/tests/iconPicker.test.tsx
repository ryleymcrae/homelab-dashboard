import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const ASSET = { name: "0123456789abcdef.png", url: "/api/assets/0123456789abcdef.png", size: 2048, uploadedAt: 1, usedBy: [] as string[] };
const api = vi.hoisted(() => ({
  listAssets: vi.fn(),
  uploadAsset: vi.fn(),
  deleteAsset: vi.fn(),
}));
vi.mock("../src/api/client", () => ({ api }));
let snapshot: any = null;
vi.mock("../src/hooks/SnapshotContext", () => ({ useSnapshot: () => ({ snapshot }) }));

import { AssetGallery, IconPicker } from "../src/components/IconPicker";
import { BottomNav } from "../src/components/BottomNav";
import { faviconHref } from "../src/api/favicon";

beforeEach(() => {
  api.listAssets.mockResolvedValue([ASSET]);
  api.uploadAsset.mockResolvedValue({ name: "fedcba9876543210.png", url: "/api/assets/fedcba9876543210.png" });
  api.deleteAsset.mockResolvedValue({ ok: true });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  snapshot = null;
});

function openPicker(props: Partial<React.ComponentProps<typeof IconPicker>> = {}) {
  const onPick = vi.fn();
  const onClose = vi.fn();
  render(<IconPicker title="Logo" defaultLabel="▲" onPick={onPick} onClose={onClose} {...props} />);
  return { onPick, onClose };
}

describe("IconPicker", () => {
  it("picks a built-in glyph by name", () => {
    const { onPick, onClose } = openPicker();
    fireEvent.click(screen.getByRole("button", { name: "star" }));
    expect(onPick).toHaveBeenCalledWith("star");
    expect(onClose).toHaveBeenCalled();
  });

  it("picks an uploaded image by its URL", async () => {
    const { onPick } = openPicker();
    fireEvent.click(await screen.findByRole("button", { name: `Use image ${ASSET.name}` }));
    expect(onPick).toHaveBeenCalledWith(ASSET.url);
  });

  it("uploads and selects the new image in one step", async () => {
    const { onPick } = openPicker();
    const file = new File([new Uint8Array([0x89, 0x50])], "logo.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Image file to upload"), { target: { files: [file] } });
    await waitFor(() => expect(onPick).toHaveBeenCalledWith("/api/assets/fedcba9876543210.png"));
    expect(api.uploadAsset).toHaveBeenCalledWith(file);
  });

  it("takes a URL, or goes back to the default", () => {
    const { onPick } = openPicker();
    fireEvent.change(screen.getByLabelText("Image URL or path"), { target: { value: " https://example.com/logo.png " } });
    fireEvent.click(screen.getByRole("button", { name: "Use" }));
    expect(onPick).toHaveBeenLastCalledWith("https://example.com/logo.png");
    cleanup();
    const second = openPicker();
    fireEvent.click(screen.getByRole("button", { name: "Use default (▲)" }));
    expect(second.onPick).toHaveBeenCalledWith(null);
  });

  it("closes on Escape wherever focus is, and takes focus when it opens", () => {
    const { onClose } = openPicker();
    expect(document.activeElement?.closest('[role="dialog"]')).not.toBeNull();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("offers no glyphs for a banner", () => {
    openPicker({ kind: "image", defaultLabel: "none" });
    expect(screen.queryByRole("button", { name: "star" })).toBeNull();
  });
});

describe("AssetGallery (manage)", () => {
  it("won't offer to delete an image that's in use, and says where", async () => {
    api.listAssets.mockResolvedValue([{ ...ASSET, usedBy: ["dashboard › logo"] }]);
    render(<AssetGallery manage />);
    expect(await screen.findByText(/Used by dashboard › logo/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Delete" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("deletes an unused image, and shows the server's reason if it refuses", async () => {
    render(<AssetGallery manage />);
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    await waitFor(() => expect(api.deleteAsset).toHaveBeenCalledWith(ASSET.name));

    api.deleteAsset.mockRejectedValueOnce(new Error("This image is still in use."));
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "This image is still in use.");
  });
});

describe("AssetGallery sync", () => {
  it("refreshes every gallery on screen after an upload in one of them", async () => {
    render(
      <>
        <AssetGallery manage />
        <AssetGallery onPick={() => {}} />
      </>
    );
    await waitFor(() => expect(api.listAssets).toHaveBeenCalledTimes(2));
    const file = new File([new Uint8Array([0x89])], "a.png", { type: "image/png" });
    fireEvent.change(screen.getAllByLabelText("Image file to upload")[1], { target: { files: [file] } });
    await waitFor(() => expect(api.listAssets).toHaveBeenCalledTimes(4));
  });
});

describe("favicon", () => {
  it("uses an image as-is and draws a glyph (or the default ▲) as SVG", () => {
    expect(faviconHref("/api/assets/0123456789abcdef.png")).toBe("/api/assets/0123456789abcdef.png");
    expect(decodeURIComponent(faviconHref("star"))).toContain(">★</text>");
    expect(decodeURIComponent(faviconHref(null))).toContain(">▲</text>");
  });
});

describe("BottomNav", () => {
  it("shows a configured icon per tab and the built-in glyph elsewhere", () => {
    snapshot = { alertsActive: 0, dashboard: { navIcons: { home: "/api/assets/0123456789abcdef.png", alerts: "flame" } } };
    const { container } = render(
      <MemoryRouter>
        <BottomNav />
      </MemoryRouter>
    );
    expect(container.querySelector('a[href="/"] img')?.getAttribute("src")).toBe("/api/assets/0123456789abcdef.png");
    expect(screen.getByRole("link", { name: /Alerts/ }).textContent).toContain("◆");
    expect(screen.getByRole("link", { name: /Settings/ }).textContent).toContain("⚙");
  });
});
