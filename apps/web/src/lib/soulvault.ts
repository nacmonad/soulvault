/**
 * Workspace wiring smoke module: proves @soulvault/protocol resolves and
 * typechecks inside the Next.js app (it participates in `next build`'s
 * project-wide typecheck). Replace with real usage as UI features land.
 *
 * Note: @soulvault/node is server-only (fs, Ledger HID) — import it from API
 * routes / server components only, never from client components.
 */
export { sha256Hex, wrapKeyForSecp256k1PublicKey, unwrapKeyWithSecp256k1PrivateKey } from "@soulvault/protocol";
