import { NextResponse } from "next/server";
import { storageBackend, uploadPayload } from "@soulvault/node/storage";

/**
 * Storage seam for swarm message payloads.
 *
 * The dashboard posts sealed envelopes here and gets back an opaque
 * `payloadRef`. The backend is selected by SOULVAULT_STORAGE_BACKEND
 * (`0g` default, `file` for co-located demos/dev) in @soulvault/node/storage —
 * swapping to IPFS later only touches that module; UI and on-chain
 * `postMessage` payloadRef/payloadHash flow stay identical.
 *
 * Envelopes posted here are always ECDH-sealed client-side first — the
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
    const upload = await uploadPayload(envelope);
    return NextResponse.json({
      payloadRef: upload.payloadRef,
      storage: upload.backend,
      txHash: upload.txHash ?? null,
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "upload failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
