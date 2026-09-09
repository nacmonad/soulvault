import { afterEach, describe, expect, it } from "vitest";

import { clearRpcUrlOverride, getRpcUrlOverride, setRpcUrlOverride } from "./rpc-settings";

// Minimal localStorage over a Map — jsdom is not configured for this project.
const store = new Map<string, string>();
Object.defineProperty(globalThis, "window", {
  value: { localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) } },
  configurable: true,
});

afterEach(() => {
  clearRpcUrlOverride();
});

describe("rpc-settings", () => {
  it("returns null when nothing is stored", () => {
    expect(getRpcUrlOverride()).toBeNull();
  });

  it("persists a valid https URL, trimmed of a trailing slash", () => {
    expect(setRpcUrlOverride("https://rpc.example/v3/key/")).toBe("https://rpc.example/v3/key");
    expect(getRpcUrlOverride()).toBe("https://rpc.example/v3/key");
  });

  it("persists http for local nodes", () => {
    expect(setRpcUrlOverride("http://localhost:8545")).toBe("http://localhost:8545");
  });

  it("rejects non-http protocols and garbage without persisting", () => {
    expect(setRpcUrlOverride("ftp://x")).toBeNull();
    expect(setRpcUrlOverride("not a url")).toBeNull();
    expect(setRpcUrlOverride("")).toBeNull();
    expect(getRpcUrlOverride()).toBeNull();
  });

  it("clear removes the override", () => {
    setRpcUrlOverride("https://rpc.example");
    clearRpcUrlOverride();
    expect(getRpcUrlOverride()).toBeNull();
  });
});
