import { REHYDRATE_REQUEST_ACTION, rehydrateSelfieSignal } from "@soulvault/node/world-identity";

export { REHYDRATE_REQUEST_ACTION, rehydrateSelfieSignal };

export type WorldWidgetConfig = {
  appId: string;
  rpId: string;
  rpUrl: string;
  action: string;
  environment: "staging" | "production";
};

export function getBrowserWorldWidgetConfig(): WorldWidgetConfig | null {
  const appId = process.env.NEXT_PUBLIC_WORLD_APP_ID?.trim() ?? "";
  const rpId = process.env.NEXT_PUBLIC_WORLD_RP_ID?.trim() ?? "";
  const rpUrl = (process.env.NEXT_PUBLIC_WORLD_RP_URL?.trim() ?? "").replace(/\/$/, "");
  if (!appId || !rpId || !rpUrl) return null;
  const environment =
    process.env.NEXT_PUBLIC_WORLD_ENVIRONMENT === "production" ? "production" : "staging";
  return { appId, rpId, rpUrl, action: REHYDRATE_REQUEST_ACTION, environment };
}

export type RpContext = {
  rp_id: string;
  nonce: string;
  created_at: number;
  expires_at: number;
  signature: string;
};

export async function fetchRpSignature(rpUrl: string, action = REHYDRATE_REQUEST_ACTION): Promise<RpContext> {
  const response = await fetch(`${rpUrl}/rp-signature?action=${encodeURIComponent(action)}`);
  const json = (await response.json()) as RpContext & { error?: string };
  if (!response.ok) {
    throw new Error(json.error ?? `RP signature failed (${response.status})`);
  }
  return json;
}

export type VerifyResult = { approved: true; nullifier: string } | { approved: false; reason: string };

export async function verifySelfieProof(input: {
  rpUrl: string;
  proof: unknown;
  expectedSignal: string;
  consumedNullifiers?: readonly string[];
}): Promise<VerifyResult> {
  const response = await fetch(`${input.rpUrl}/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      proof: input.proof,
      expectedSignal: input.expectedSignal,
      consumedNullifiers: input.consumedNullifiers ?? [],
    }),
  });
  const json = (await response.json()) as VerifyResult & { error?: string };
  if (json.approved === true) return json;
  return { approved: false, reason: json.reason ?? json.error ?? "verification-failed" };
}

export function parseSelfieProofJson(text: string): unknown {
  return JSON.parse(text) as unknown;
}
