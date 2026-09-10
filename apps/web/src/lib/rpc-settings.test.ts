import { afterEach, describe, expect, it } from "vitest";

import { clearRpcUrlOverride, getRpcUrlOverride, parseRpcUrlList, setRpcUrlOverride } from "./rpc-settings";

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

  it("accepts a comma-separated provider list, normalized and deduped", () => {
    expect(setRpcUrlOverride("https://a.example/v3/key , https://b.example/ , https://a.example/v3/key/")).toBe(
      "https://a.example/v3/key,https://b.example",
    );
    expect(getRpcUrlOverride()).toBe("https://a.example/v3/key,https://b.example");
  });

  it("list parsing skips garbage entries but keeps valid ones", () => {
    expect(parseRpcUrlList("ftp://x, not a url , https://ok.example")).toEqual(["https://ok.example"]);
    expect(parseRpcUrlList("garbage")).toEqual([]);
  });

  it("rejects a list with no valid entries without persisting", () => {
    expect(setRpcUrlOverride("https://ok.example,ftp://x")).toBe("https://ok.example");
    expect(setRpcUrlOverride("ftp://x,not a url")).toBeNull();
    expect(getRpcUrlOverride()).toBe("https://ok.example");
  });
});
