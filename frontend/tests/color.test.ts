import { describe, expect, it, afterEach } from "vitest";
import { applyAccentColor, isValidHexColor, shade, toRgba } from "../src/api/color";

describe("isValidHexColor", () => {
  it("accepts 6-digit hex with or without a leading #", () => {
    expect(isValidHexColor("#8855ff")).toBe(true);
    expect(isValidHexColor("8855FF")).toBe(true);
  });

  it("rejects short hex, non-hex characters, and garbage", () => {
    expect(isValidHexColor("#fff")).toBe(false);
    expect(isValidHexColor("not-a-color")).toBe(false);
    expect(isValidHexColor("")).toBe(false);
  });
});

describe("shade", () => {
  it("mixes toward black for a negative amount", () => {
    expect(shade("#ffffff", -1)).toBe("#000000");
  });

  it("mixes toward white for a positive amount", () => {
    expect(shade("#000000", 1)).toBe("#ffffff");
  });

  it("returns the input unchanged for an invalid color", () => {
    expect(shade("nope", -0.15)).toBe("nope");
  });
});

describe("toRgba", () => {
  it("converts a hex color into an rgba() string at the given alpha", () => {
    expect(toRgba("#8855ff", 0.16)).toBe("rgba(136, 85, 255, 0.16)");
  });

  it("returns the input unchanged for an invalid color", () => {
    expect(toRgba("nope", 0.5)).toBe("nope");
  });
});

describe("applyAccentColor", () => {
  afterEach(() => {
    applyAccentColor(null);
  });

  it("sets the three primary-color custom properties for a valid hex", () => {
    applyAccentColor("#8855ff");
    const root = document.documentElement.style;
    expect(root.getPropertyValue("--color-primary")).toBe("#8855ff");
    expect(root.getPropertyValue("--color-primary-strong")).not.toBe("");
    expect(root.getPropertyValue("--color-primary-soft")).not.toBe("");
  });

  it("clears the custom properties for null, undefined, or an invalid hex", () => {
    const root = document.documentElement.style;
    applyAccentColor("#8855ff");
    applyAccentColor(null);
    expect(root.getPropertyValue("--color-primary")).toBe("");
    applyAccentColor("#8855ff");
    applyAccentColor(undefined);
    expect(root.getPropertyValue("--color-primary")).toBe("");
    applyAccentColor("#8855ff");
    applyAccentColor("garbage");
    expect(root.getPropertyValue("--color-primary")).toBe("");
  });
});
