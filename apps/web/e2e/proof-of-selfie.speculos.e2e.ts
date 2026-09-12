import {
  clickConnectIfPresent,
  connectMockWallet,
  readState,
  seedDocumentSession,
  test,
  expect,
  writeState,
  ALICE_ADDRESS,
  CHARLIE_ADDRESS,
  MALLORY_ADDRESS,
} from "./fixtures.js";
import type { Page } from "@playwright/test";

/**
 * Proof-of-selfie e2e (ticket 023) on the Speculos/Playwright harness.
 *
 * Asserts the World gate, not detector strings. The author can edit the
 * public bundle before submit — exact redaction content is out of scope.
 *
 * Charlie is a mock injected wallet so this suite can pass independently of
 * the still-broken dashboard Ledger connect (ticket 006). Speculos still
 * boots via the Playwright fixture.
 *
 * Concurrency rule still applies for any later DMK-driven step: never await
 * the device action before `controller.approve()`.
 */

test.describe.configure({ mode: "serial" });

test.describe.serial("proof-of-selfie: flag → proof on request → grant fail-closed", () => {
  let bundlePath = "";
  let documentId = "";

  test("Alice publishes with selfieRequired; detector strings are not the pass condition", async ({
    page,
    sidecar,
  }) => {
    await connectMockWallet(page, sidecar.url, ALICE_ADDRESS());
    await page.goto("/dashboard/documents/redact");
    await clickConnectIfPresent(page);

    await page.getByLabel("Text to analyze").fill(aliceNotes());
    await page.getByRole("button", { name: "Scan locally" }).click();
    const status = page.getByText(/\d+ detected · \d+ accepted/);
    await expect(status).toBeVisible({ timeout: 180_000 });

    const counts = await status.innerText();
    if (/^0 detected/.test(counts)) {
      const reviewed = page.getByLabel("Reviewed source text");
      await reviewed.evaluate(selectFirstWordAndMouseUp);
      const dialog = page.getByRole("dialog", { name: "Classify span" });
      await dialog.getByLabel("Entity").selectOption({ label: "PERSON" });
      await dialog.getByRole("button", { name: "Accept", exact: true }).click();
    }

    await page.getByRole("button", { name: "Encrypt accepted slots" }).click();
    const docHashLine = page.getByText(/docHash: [0-9a-fA-F]{64}/);
    await expect(docHashLine).toBeVisible();
    documentId = (await docHashLine.innerText()).replace(/^docHash:\s*/, "").trim();

    bundlePath = writeState("bundle.soulvault.json", "");
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Download public bundle" }).click(),
    ]);
    await download.saveAs(bundlePath);

    const session = await page.evaluate(() => {
      const current = window.localStorage.getItem("soulvault.document.current");
      const sessionJson = current ? window.localStorage.getItem(`soulvault.document.${current}`) : null;
      return { documentId: current, sessionJson };
    });
    if (!session.documentId || !session.sessionJson) {
      throw new Error("Alice's document session was not written to localStorage");
    }
    writeState("alice-session.json", JSON.stringify(session));

    await page.getByText("Require Selfie Check for grants-from-request").click();
    await page.getByRole("button", { name: "Publish on-chain" }).click();
    await expect(page.getByText(/Published on .* · tx/)).toBeVisible({ timeout: 180_000 });
  });

  test("Alice's DocumentPublished surfaces with the selfie flag", async ({ page }) => {
    await page.goto("/dashboard/events");
    await expect(page.getByText("DocumentPublished").first()).toBeVisible({ timeout: 180_000 });
  });

  test("Charlie cannot request without a Selfie Check proof", async ({ page, sidecar }) => {
    await connectMockWallet(page, sidecar.url, CHARLIE_ADDRESS());
    await page.goto("/dashboard/documents/rehydrate");
    await clickConnectIfPresent(page);
    await uploadBundle(page, bundlePath);
    await expect(page.getByText(/docHash matches registry/)).toBeVisible({ timeout: 180_000 });

    await expect(page.getByText("World Selfie Check")).toBeVisible();
    await expect(page.getByRole("button", { name: "Request rehydration" })).toBeDisabled();

    await page.getByText("Staging fixture (paste JSON)").click();
    await page.getByLabel("Selfie Check proof JSON fixture").fill(
      JSON.stringify({
        nullifier: "e2e-wrong-wallet",
        credentialId: 11,
        signal: selfieSignal(MALLORY_ADDRESS(), documentId),
      }),
    );
    await page.getByRole("button", { name: "Present fixture" }).click();
    await expect(page.getByText(/Selfie Check failed \(signal-mismatch\)/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Request rehydration" })).toBeDisabled();
  });

  test("Charlie presents a fixture proof and posts requestRehydration", async ({ page, sidecar }) => {
    await connectMockWallet(page, sidecar.url, CHARLIE_ADDRESS());
    await page.goto("/dashboard/documents/rehydrate");
    await clickConnectIfPresent(page);
    await uploadBundle(page, bundlePath);
    await expect(page.getByText(/docHash matches registry/)).toBeVisible({ timeout: 180_000 });

    await page.getByText("Staging fixture (paste JSON)").click();
    await page.getByLabel("Selfie Check proof JSON fixture").fill(
      JSON.stringify({
        nullifier: "e2e-charlie-selfie-1",
        credentialId: 11,
        signal: selfieSignal(CHARLIE_ADDRESS(), documentId),
      }),
    );
    await page.getByRole("button", { name: "Present fixture" }).click();
    await expect(page.getByRole("button", { name: "Selfie Check verified" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Request rehydration" })).toBeEnabled();

    await page.getByRole("button", { name: "Request rehydration" }).click();
    await expect(page.getByText(/Request posted — tx/)).toBeVisible({ timeout: 180_000 });
  });

  test("Alice: pre-request grants stay closed; grantToRequest waits on verify", async ({ page, sidecar }) => {
    const session = JSON.parse(readState("alice-session.json")) as { documentId: string; sessionJson: string };
    await connectMockWallet(page, sidecar.url, ALICE_ADDRESS());
    await seedDocumentSession(page, session);
    await page.goto("/dashboard/documents/grants");
    await clickConnectIfPresent(page);

    const preRequest = page.locator("details").filter({ hasText: "Grant without a request" });
    await preRequest.locator("summary").click();
    await expect(preRequest.getByRole("button", { name: /Grant \d+ slots?/ })).toBeDisabled();

    await expect(page.getByText(/selfie (pending|verified)/)).toBeVisible({ timeout: 180_000 });
    await expect(page.getByText("selfie verified")).toBeVisible({ timeout: 60_000 });

    const grantToRequest = page.getByRole("button", { name: /Grant \d+ slots?/ }).first();
    await expect(grantToRequest).toBeEnabled();
    await grantToRequest.click();
    await page.getByRole("button", { name: "Sign & deliver" }).click();
    await expect(page.getByText(/\d+ granted/)).toBeVisible({ timeout: 180_000 });
  });

  test("Charlie unwraps without a second selfie; Mallory cannot request", async ({ page, sidecar }) => {
    await connectMockWallet(page, sidecar.url, CHARLIE_ADDRESS());
    await page.goto("/dashboard/documents/rehydrate");
    await clickConnectIfPresent(page);
    await uploadBundle(page, bundlePath);
    await expect(page.getByText(/docHash matches registry/)).toBeVisible({ timeout: 180_000 });

    const slotToggles = page.locator("div.mt-4.flex.flex-wrap.gap-2").getByRole("button");
    await expect(slotToggles.first()).toBeEnabled({ timeout: 180_000 });
    await slotToggles.first().click();
    await expect(page.getByRole("button", { name: /\(no grant\)/ })).toHaveCount(0);

    await expect(page.getByRole("button", { name: "Request rehydration" })).toBeDisabled();
    await expect(page.getByText("World Selfie Check")).toBeVisible();
    await expect(page.getByRole("button", { name: "Verify with World ID" })).toBeVisible();

    await connectMockWallet(page, sidecar.url, MALLORY_ADDRESS());
    await page.goto("/dashboard/documents/rehydrate");
    await clickConnectIfPresent(page);
    await uploadBundle(page, bundlePath);
    await expect(page.getByText(/docHash matches registry/)).toBeVisible({ timeout: 180_000 });
    await expect(page.getByRole("button", { name: "Request rehydration" })).toBeDisabled();
    await expect(page.getByRole("button", { name: /\(no grant\)/ }).first()).toBeVisible({ timeout: 180_000 });
  });
});

function aliceNotes(): string {
  return [
    "Consultation notes for Jane Q. Sample.",
    "Reach her at jane.sample@example.com or (555) 010-4321 for follow-up.",
    "Reviewing clinician: Dr. Adams.",
    "This closing sentence stays visible to everyone.",
  ].join(" ");
}

function selfieSignal(wallet: string, docHash: string): string {
  const addr = wallet.trim().toLowerCase();
  const hash = docHash.trim().toLowerCase();
  const withPrefix = hash.startsWith("0x") ? hash : `0x${hash}`;
  return `${addr}:${withPrefix}`;
}

function selectFirstWordAndMouseUp(element: Element): void {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent ?? "";
    const match = text.match(/[A-Za-z]{3,}/);
    if (!match || match.index == null) continue;
    const range = document.createRange();
    range.setStart(node, match.index);
    range.setEnd(node, match.index + match[0].length);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    return;
  }
  throw new Error("no word found in reviewed text for a manual author span");
}

async function uploadBundle(page: Page, path: string): Promise<void> {
  const input = page.locator('input[type="file"]');
  await input.setInputFiles(path);
}
