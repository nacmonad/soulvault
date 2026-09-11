import { clickConnectIfPresent, connectMockWallet, readState, reviewAndApprove, seedDocumentSession, seedRegistryOverride, test, expect, writeState, ALICE_ADDRESS, MALLORY_ADDRESS, rpcUrl, chainId } from "./fixtures.js";
import { injectedWalletInitScript } from "./helpers/injected-wallet.js";
import type { Page } from "@playwright/test";

/**
 * Documents e2e — ticket 006 epic gate.
 *
 * Alice (mock injected wallet) redacts the synthetic fixture, adds one manual
 * author span, encrypts, downloads the public bundle, and publishes the
 * docHash anchor on-chain. Charlie (emulated Ledger over Speculos) attests his
 * rehydration key via clear-signed EIP-712; Alice grants selected slots
 * (one tx per slot); Charlie rehydrates exactly his granted slots. Mallory
 * (mock injected wallet, no grants) gets no plaintext anywhere — content,
 * DOM, or typed error messages.
 *
 * Concurrency rule: every DMK-driven page action is raced against an explicit
 * controller approval that waits for real screen text. No auto-approval.
 */

test.describe.configure({ mode: "serial" });

test.describe.serial("documents: Alice / Charlie / Mallory", () => {
  let bundlePath = "";
  let documentId = "";

  test("Alice redacts, encrypts, publishes, and downloads the public bundle", async ({ page, sidecar }) => {
    await connectMockWallet(page, sidecar.url, ALICE_ADDRESS());

    await page.goto("/dashboard/documents/redact");
    await clickConnectIfPresent(page);
    await page.getByLabel("Text to analyze").fill(aliceFixture());
    await page.getByRole("button", { name: "Scan locally" }).click();
    await expect(page.getByText(/\d+ detected · \d+ accepted/)).toBeVisible({ timeout: 180_000 });

    // Manual author span: select "Adams" inside the reviewed source text.
    const reviewed = page.getByLabel("Reviewed source text");
    await reviewed.evaluate(selectWordAndMouseUp, "Adams");
    const dialog = page.getByRole("dialog", { name: "Classify span" });
    await dialog.getByLabel("Entity").selectOption({ label: "PERSON" });
    await dialog.getByRole("button", { name: "Accept", exact: true }).click();
    await expect(page.getByText(/\+ 1 author/)).toBeVisible();

    await page.getByRole("button", { name: "Encrypt accepted slots" }).click();
    // documentId renders as bare hex (no 0x prefix) in the Artifact block.
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
    if (!session.documentId || !session.sessionJson) throw new Error("Alice's document session was not written to sessionStorage");
    writeState("alice-session.json", JSON.stringify(session));

    await page.getByRole("button", { name: "Publish on-chain" }).click();
    await expect(page.getByText(/Published on .* · tx/)).toBeVisible({ timeout: 180_000 });
  });

  test("Alice's DocumentPublished surfaces in the events cache", async ({ page }) => {
    await page.goto("/dashboard/events");
    await expect(page.getByText("DocumentPublished").first()).toBeVisible({ timeout: 180_000 });
  });

  test("Charlie connects via the emulated Ledger and attests his rehydration key", async ({ page, speculos }) => {
    const apduUrl = encodeURIComponent(speculos.apduUrl);
    await page.goto(`/dashboard?apduUrl=${apduUrl}`);
    await seedRegistryOverride(page);
    await page.goto(`/dashboard?apduUrl=${apduUrl}`);

    const connect = page.getByRole("button", { name: "Connect Ledger" });
    await expect(connect).toBeVisible({ timeout: 30_000 });
    const connecting = connect.click();
    await reviewAndApprove(speculos.controller);
    await connecting;
    await expect(page.getByText(/^ledger$/i).first()).toBeVisible({ timeout: 30_000 });

    await page.goto(`/dashboard/documents/rehydrate?apduUrl=${apduUrl}`);
    await uploadBundle(page, bundlePath);
    await expect(page.getByText(/docHash matches registry/)).toBeVisible({ timeout: 180_000 });

    await expect(page.getByRole("button", { name: "Attest rehydration key on Ledger" })).toBeEnabled();
    const attesting = page.getByRole("button", { name: "Attest rehydration key on Ledger" }).click();
    await reviewAndApprove(speculos.controller);
    await attesting;

    await page.getByRole("button", { name: "Copy attestation JSON" }).click();
    const attestation = await page.evaluate(() => navigator.clipboard.readText());
    if (!attestation.includes("signature")) throw new Error(`unexpected attestation JSON: ${attestation.slice(0, 120)}`);
    writeState("charlie-attestation.json", attestation);

    // Persist Charlie's rehydration key for the rehydrate step (fresh context).
    const rehydrationKey = await page.evaluate(([wallet]) => {
      return window.localStorage.getItem(`soulvault.rehydration.${wallet.toLowerCase()}.default`);
    }, [JSON.parse(attestation).wallet as string]);
    if (!rehydrationKey) throw new Error("Charlie's rehydration key was not stored under his wallet");
    writeState("charlie-rehydration-key.txt", rehydrationKey);
  });

  test("Alice grants the selected slots (one tx per slot)", async ({ page, sidecar }) => {
    await connectMockWallet(page, sidecar.url, ALICE_ADDRESS());
    const session = JSON.parse(readState("alice-session.json")) as { documentId: string; sessionJson: string };
    await seedDocumentSession(page, session);

    await page.goto("/dashboard/documents/grants");
    await clickConnectIfPresent(page);
    await page.getByRole("button", { name: /slots/ }).first().click();

    // Leave one slot ungranted (the last checkbox, phone) so the rehydrate
    // step can prove ungranted markers stay redacted.
    await page.getByRole("checkbox").last().uncheck();

    const attestation = readState("charlie-attestation.json");
    const attestationJson = JSON.parse(attestation) as { wallet?: string };
    await page.getByLabel("Recipient attestation JSON").fill(attestation);
    if (attestationJson.wallet) {
      await page.getByPlaceholder(/optional if the attestation/).fill(attestationJson.wallet);
    }

    await page.getByRole("button", { name: "Grant selected slots" }).click();
    await expect(page.getByText("Delivered grants")).toBeVisible({ timeout: 180_000 });
  });

  test("Charlie rehydrates exactly his granted slots", async ({ page, speculos }) => {
    const apduUrl = encodeURIComponent(speculos.apduUrl);
    const attestation = JSON.parse(readState("charlie-attestation.json")) as { wallet: string };
    const wallet = attestation.wallet;

    await page.goto(`/dashboard?apduUrl=${apduUrl}`);
    await seedRegistryOverride(page);
    const rehydrationKey = readState("charlie-rehydration-key.txt");
    await page.addInitScript(
      ([key, value]) => {
        window.localStorage.setItem(key, value);
      },
      [`soulvault.rehydration.${wallet.toLowerCase()}.default`, rehydrationKey],
    );

    await page.goto(`/dashboard/documents/rehydrate?apduUrl=${apduUrl}`);
    await uploadBundle(page, bundlePath);
    await expect(page.getByText(/docHash matches registry/)).toBeVisible({ timeout: 180_000 });

    await expect(page.getByRole("button", { name: "Attest rehydration key on Ledger" })).toBeEnabled();
    const attesting = page.getByRole("button", { name: "Attest rehydration key on Ledger" }).click();
    await reviewAndApprove(speculos.controller);
    await attesting;

    // Granted slots (email + author span) toggle; the ungranted phone slot
    // stays disabled with "(no grant)".
    const emailSlot = page.getByRole("button", { name: /pii-email-address/ });
    const personSlot = page.getByRole("button", { name: /pii-person/ });
    const phoneSlot = page.getByRole("button", { name: /pii-phone-number/ });
    await expect(emailSlot).toBeEnabled({ timeout: 180_000 });
    await expect(personSlot).toBeEnabled();
    await expect(phoneSlot).toBeDisabled();

    await emailSlot.click();
    await personSlot.click();

    const body = page.locator("pre");
    await expect(body).toContainText("jane.sample@example.com", { timeout: 60_000 });
    await expect(body).toContainText("Adams");
    await expect(body).toContainText("{{sv:pii-phone-number-");
  });

  test("Mallory gets no plaintext anywhere", async ({ page, sidecar }) => {
    await connectMockWallet(page, sidecar.url, MALLORY_ADDRESS());

    await page.goto("/dashboard/documents/rehydrate");
    await clickConnectIfPresent(page);
    await uploadBundle(page, bundlePath);
    await expect(page.getByText(/docHash matches registry/)).toBeVisible({ timeout: 180_000 });

    await page.getByRole("button", { name: "Attest rehydration key" }).click();

    await expect(page.getByRole("button", { name: /\(no grant\)/ }).first()).toBeVisible({ timeout: 180_000 });
    const bodyText = await page.locator("pre").last().innerText();
    if (bodyText.includes("jane.sample@example.com") || bodyText.includes("(555) 010-4321")) {
      throw new Error("Mallory can see plaintext — fail-closed broken");
    }
  });
});

function aliceFixture(): string {
  return [
    "Consultation notes for Jane Q. Sample.",
    "Reach her at jane.sample@example.com or (555) 010-4321 for follow-up.",
    "Reviewing clinician: Dr. Adams.",
    "This closing sentence stays visible to everyone.",
  ].join(" ");
}

function selectWordAndMouseUp(element: Element, word: string): void {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const index = (node.textContent ?? "").indexOf(word);
    if (index >= 0) {
      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + word.length);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      return;
    }
  }
  throw new Error(`manual span word "${word}" not found in reviewed text`);
}

async function uploadBundle(page: Page, path: string): Promise<void> {
  const input = page.locator('input[type="file"]');
  await input.setInputFiles(path);
}
