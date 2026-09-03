/**
 * Workspace wiring smoke module: proves @soulvault/protocol resolves and
 * typechecks inside the Next.js app (it participates in `next build`'s
 * project-wide typecheck). Replace with real usage as UI features land.
 *
 * The web app is statically exported for GitHub Pages and is backend-free:
 * only @soulvault/protocol (isomorphic) may be imported here.
 * @soulvault/node is server-only (fs, Ledger HID, funded signer) and must never
 * enter the web bundle — contract reads/txs go through viem + the user's wallet.
 */
export { sha256Hex, wrapKeyForSecp256k1PublicKey, unwrapKeyWithSecp256k1PrivateKey } from "@soulvault/protocol";
