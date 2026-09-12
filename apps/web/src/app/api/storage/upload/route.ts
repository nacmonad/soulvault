import { NextResponse } from "next/server";

/**
 * Storage seam for swarm message payloads.
 *
 * The dashboard posts sealed envelopes here and gets back an opaque
 * `payloadRef`. Today the backend persists to 0G Storage; swapping to IPFS
 * (or any locator-addressed store) later only changes this route — UI and
 * on-chain `postMessage` payloadRef/payloadHash flow stay identical.
 *
 * NOTE: this route runs server-side where SOULVAULT_* env + the node signer
 * live. Envelopes posted here are always ECDH-sealed client-side first — the
 * server never sees plaintext key material.
 */
export async function POST(request: Request) {
  let envelope: unknown;
  try {
    envelope = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (!envelope || typeof envelope !== "object") {
    return NextResponse.json({ error: "envelope object required" }, { status: 400 });
  }

  try {
    const { uploadJsonTo0G } = await import("@soulvault/node/0g");
    const upload = (await uploadJsonTo0G(envelope)) as {
      rootHash?: string;
      rootHashes?: string[];
      txHash?: string;
      txHashes?: string[];
    };
    const payloadRef = upload.rootHash ?? upload.rootHashes?.[0];
    if (!payloadRef) {
      return NextResponse.json({ error: "upload returned no root hash" }, { status: 502 });
    }
    return NextResponse.json({
      payloadRef,
      storage: "0g",
      txHash: upload.txHash ?? upload.txHashes?.[0] ?? null,
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "upload failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
