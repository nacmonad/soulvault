/**
 * Plain-text transaction checklist for the Ledger signing path — the CLI half
 * of the browser's `tx-decode.ts` posture (apps/web/src/lib/tx-decode.ts).
 *
 * When production CAL has no descriptor for a selector (always true for
 * SoulVault contracts, and for every contract deploy), the device can only
 * render a blind-sign hash. The trusted terminal renders what is being
 * approved instead; the keccak hash of the unsigned tx binds the two — the
 * device displays exactly that hash, so the operator can confirm the checklist
 * corresponds to what the device is actually signing.
 *
 * Spec: docs/clear-signing-spec.md §6; mirrors docs/clear-signing-limitations.md
 */
import { Interface, formatEther, keccak256, getBytes, type TransactionRequest } from 'ethers';

import { SOULVAULT_SWARM_ABI, SOULVAULT_TREASURY_ABI } from './swarm-contract.js';

/** Decoded human summary of a pending Ledger transaction. */
export interface TxChecklist {
  /** One-line action name, e.g. "Deploy contract" or "Treasury withdraw". */
  action: string;
  /** Operator-readable detail lines (addresses, amounts, request ids...). */
  lines: string[];
  /** Transaction value in ETH (always rendered, even 0). */
  value: string;
}

// Selector-surface for decoding calldata. Read-only functions are harmless to
// include; the checklist only renders, it never gates.
const KNOWN_CHECKLIST_ABI = [...SOULVAULT_SWARM_ABI, ...SOULVAULT_TREASURY_ABI].filter(
  (fragment) => fragment.startsWith('function') && !fragment.includes(' view '),
);

const CHECKLIST_IFACE = new Interface(KNOWN_CHECKLIST_ABI);

const TITLE_BY_SELECTOR: Record<string, string> = {
  deposit: 'Deposit to treasury',
  withdraw: 'Treasury withdraw',
  approveFundRequest: 'Approve fund request',
  rejectFundRequest: 'Reject fund request',
  requestFunds: 'Request funds',
  cancelFundRequest: 'Cancel fund request',
  setTreasury: 'Bind swarm treasury',
  requestJoin: 'Request swarm membership',
  approveJoin: 'Approve member join',
  rejectJoin: 'Reject member join',
  rotateEpoch: 'Rotate epoch',
  requestBackup: 'Request backup',
  postMessage: 'Post swarm message',
};

function shortHex(hex: string): string {
  return hex.length > 18 ? `${hex.slice(0, 10)}…${hex.slice(-6)}` : hex;
}

/**
 * Decode a pending transaction into the plain-text checklist. Falls back to a
 * selector/size summary for anything outside the known ABI surface — the
 * checklist must render for every tx, known or not.
 */
export function buildTxChecklist(tx: {
  to?: null | string;
  value?: bigint | number | string;
  data?: string;
}): TxChecklist {
  const lines: string[] = [];
  const data = tx.data ? tx.data.toString() : '0x';
  const value = BigInt(tx.value ?? 0n);

  if (!tx.to) {
    return {
      action: 'Deploy contract',
      lines: [`Initcode: ${(data.length - 2) / 2} bytes`],
      value: `${formatEther(value)} ETH`,
    };
  }

  let action = 'Contract call';
  let decoded = null as null | { fragment: { name: string }; args: readonly unknown[] };
  try {
    decoded = CHECKLIST_IFACE.parseTransaction({ data });
  } catch {
    decoded = null;
  }

  if (!decoded) {
    lines.push(`To: ${tx.to}`);
    lines.push(`Selector: ${data.slice(0, 10)}`);
    lines.push(`Data: ${(data.length - 2) / 2} bytes`);
  } else {
    action = TITLE_BY_SELECTOR[decoded.fragment.name] ?? decoded.fragment.name;
    const args = decoded.args;
    switch (decoded.fragment.name) {
      case 'withdraw': {
        lines.push(`To: ${args[0]}`);
        lines.push(`Amount: ${formatEther(args[1] as bigint)} ETH`);
        break;
      }
      case 'deposit':
        lines.push(`Treasury: ${tx.to}`);
        break;
      case 'requestFunds': {
        lines.push(`Amount: ${formatEther(args[0] as bigint)} ETH`);
        lines.push(`Reason: "${args[1]}"`);
        break;
      }
      case 'cancelFundRequest':
        lines.push(`Request: #${args[0]}`);
        break;
      case 'approveFundRequest':
      case 'rejectFundRequest': {
        lines.push(`Request: #${args[1]}`);
        lines.push(`Swarm: ${args[0]}`);
        if (decoded.fragment.name === 'rejectFundRequest') lines.push(`Reason: "${args[2]}"`);
        break;
      }
      case 'setTreasury':
        lines.push(`New treasury: ${args[0]}`);
        break;
      case 'requestJoin': {
        lines.push(`Pubkey: ${shortHex(args[0]?.toString() ?? '')}`);
        lines.push(`Pubkey ref: ${args[1]}`);
        break;
      }
      case 'approveJoin':
        lines.push(`Request: #${args[0]}`);
        break;
      case 'rejectJoin': {
        lines.push(`Request: #${args[0]}`);
        lines.push(`Reason: "${args[1]}"`);
        break;
      }
      case 'rotateEpoch':
        lines.push(`New epoch: ${args[0]}`);
        lines.push(`Key bundle: ${args[1]}`);
        break;
      case 'requestBackup':
        lines.push(`Epoch: ${args[0]}`);
        lines.push(`Reason: "${args[1]}"`);
        break;
      case 'postMessage':
        lines.push(`To: ${args[0]}`);
        lines.push(`Topic: ${args[1]}`);
        lines.push(`Payload ref: ${args[4]}`);
        break;
      default:
        lines.push(
          `${decoded.fragment.name}(${args.map((a) => (typeof a === 'bigint' ? a.toString() : String(a))).join(', ')})`,
        );
        lines.push(`To: ${tx.to}`);
    }
  }

  return { action, lines, value: `${formatEther(value)} ETH` };
}

/** Keccak of the unsigned RLP — the hash the device displays when blind-signing. */
export function unsignedTxHash(serializedUnsignedTx: string): string {
  return keccak256(getBytes(serializedUnsignedTx));
}

/**
 * Render the checklist block the operator sees while the device prompt is up.
 * `hash` is the keccak of the unsigned RLP; the device shows the same hash when
 * no CAL descriptor exists, which binds the checklist to what is being signed.
 */
export function renderTxChecklist(checklist: TxChecklist, hash: string): string {
  return [
    `── Transaction checklist (no CAL descriptor — device blind-signs) ──`,
    `  Action: ${checklist.action}`,
    ...checklist.lines.map((l) => `  ${l}`),
    `  Value: ${checklist.value}`,
    `  Verify the hash on your Ledger matches: ${hash}`,
  ].join('\n');
}
