import fs from "node:fs";
import path from "node:path";

import { test as speculosTest, expect } from "@soulvault/dmk-speculos-browser/playwright";
import type { Page } from "@playwright/test";
import { privateKeyToAccount } from "viem/accounts";

import { injectedWalletInitScript } from "./helpers/injected-wallet.js";
import { startSidecarSigner, type SidecarSigner } from "./helpers/sidecar-signer.js";

export { expect };

type HexAddress = `0x${string}`;

export type ActorConfig = {
  registryAddress: HexAddress;
  rpcUrl: string;
  chainId: number;
  stateDir: string;
};

const registryAddress = process.env.SOULVAULT_E2E_REGISTRY_ADDRESS as string;
const rpcUrl = process.env.SOULVAULT_E2E_RPC_URL as string;
const chainId = Number(process.env.SOULVAULT_E2E_CHAIN_ID);
const stateDir = process.env.SOULVAULT_E2E_STATE_DIR as string;

export const actor: ActorConfig = { registryAddress: registryAddress as HexAddress, rpcUrl, chainId, stateDir };
export { rpcUrl, chainId, stateDir };

const registryOverrideSeed: [string, string] = ["soulvault.documentRegistryOverride", registryAddress];

export const stateFile = (name: string): string => path.join(stateDir, name);
export const readState = (name: string): string => fs.readFileSync(stateFile(name), "utf8");
export const writeState = (name: string, contents: string): string => {
  fs.writeFileSync(stateFile(name), contents);
  return stateFile(name);
};

export const ALICE_ADDRESS = (): string => privateKeyToAccount(process.env.SOULVAULT_E2E_ALICE_KEY as `0x${string}`).address; // anvil account[1]
export const MALLORY_ADDRESS = (): string => privateKeyToAccount(process.env.SOULVAULT_E2E_MALLORY_KEY as `0x${string}`).address; // anvil account[2]
export const CHARLIE_ADDRESS = (): string => privateKeyToAccount(process.env.SOULVAULT_E2E_CHARLIE_KEY as `0x${string}`).address; // anvil account[3]

// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- Playwright's extend wants explicit empty test fixtures when only adding worker fixtures
export const test = speculosTest.extend<{}, { sidecar: SidecarSigner }>({
  sidecar: [
    async ({}, use) => {
      const signer = await startSidecarSigner({
        rpcUrl,
        chainId,
        keys: {
          [ALICE_ADDRESS()]: process.env.SOULVAULT_E2E_ALICE_KEY as string,
          [MALLORY_ADDRESS()]: process.env.SOULVAULT_E2E_MALLORY_KEY as string,
          [CHARLIE_ADDRESS()]: process.env.SOULVAULT_E2E_CHARLIE_KEY as string,
        },
      });
      await use(signer);
      await signer.stop();
    },
    { scope: "worker", auto: true } as const,
  ],
});

/**
 * Connects the mock browser wallet on /dashboard and seeds the registry
 * override + RPC. Connection state is in-memory in the wallet provider, so a
 * later hard navigation loses it — call `reconnectMockWallet` when a test
 * lands on "Connect to continue" after a goto.
 */
export async function connectMockWallet(page: Page, sidecarUrl: string, address: string): Promise<void> {
  await page.addInitScript(injectedWalletInitScript({ address, sidecarUrl, chainId, rpcUrl }));
  await seedRegistryOverride(page);
  await page.goto("/dashboard", { waitUntil: "load" });
  await clickConnectIfPresent(page);
}

/** Clicks "Connect browser wallet" whenever the connect panel is showing. */
export async function clickConnectIfPresent(page: Page): Promise<void> {
  const connect = page.getByRole("button", { name: "Connect browser wallet" });
  if ((await connect.count()) > 0) {
    await expect(connect).toBeEnabled({ timeout: 30_000 });
    await connect.click();
    await expect(page.getByRole("button", { name: "Disconnect" })).toBeVisible({ timeout: 30_000 });
  } else {
    await expect(page.getByRole("button", { name: "Disconnect" })).toBeVisible({ timeout: 30_000 });
  }
}

/** localStorage seeds every context needs to bypass live ENS discovery. */
export async function seedRegistryOverride(page: Page): Promise<void> {
  await page.addInitScript(
    ([key, value]) => {
      window.localStorage.setItem(key, value);
    },
    registryOverrideSeed,
  );
}

/** Seeds Alice's document session (slot keys) from a previous test's export. */
export async function seedDocumentSession(
  page: Page,
  session: { documentId: string; sessionJson?: string } & Record<string, unknown>,
): Promise<void> {
  const documentId = session.documentId.replace(/^0x/i, "").toLowerCase();
  const sessionJson = typeof session.sessionJson === "string" ? session.sessionJson : JSON.stringify(session);
  await page.addInitScript(
    ({ id, json }) => {
      window.localStorage.setItem(`soulvault.document.${id}`, json);
      window.localStorage.setItem("soulvault.document.current", id);
    },
    { id: documentId, json: sessionJson },
  );
}

/**
 * Navigates the device right until an approval screen is visible, then presses
 * both buttons. Never auto-approves: every press waits for real screen text.
 */
export async function reviewAndApprove(
  controller: {
    pollScreen(): Promise<ReadonlyArray<{ text: string }>>;
    pressRight(): Promise<void>;
    pressBoth(): Promise<void>;
  },
  matcher: RegExp = /approve|accept and send|sign/i,
): Promise<void> {
  for (let step = 0; step < 60; step += 1) {
    const screen = await controller.pollScreen();
    const text = screen.map((event) => event.text).join(" | ");
    if (matcher.test(text)) {
      await controller.pressBoth();
      return;
    }
    await controller.pressRight();
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("Speculos review did not reach an approval screen");
}
