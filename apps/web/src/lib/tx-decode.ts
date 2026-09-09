/**
 * Human checklist for pending wallet transactions — the browser port of the
 * CLI's renderHumanChecklist posture (docs/clear-signing-spec.md §6): when CAL
 * has no descriptor for a selector (always true for SoulVault contracts, and
 * for every contract deploy), the device can only show a hash. The trusted UI
 * renders what is being approved instead; the keccak hash binds the two.
 */
import { decodeFunctionData, formatEther, type Address, type Hex } from "viem";

import { WRITE_ABI } from "@/lib/document-registry";
import { REGISTRY_ABI, RESOLVER_ABI } from "@/lib/ens-writes";
import { SWARM_ABI, TREASURY_ABI } from "@/lib/treasury-contract";

export const KNOWN_WRITE_ABI = [
  ...REGISTRY_ABI,
  ...RESOLVER_ABI,
  ...TREASURY_ABI,
  ...SWARM_ABI,
  ...WRITE_ABI,
] as const;

export type TxSummary = {
  /** One-line action name, e.g. "Deploy contract" or "ENS text record". */
  title: string;
  lines: string[];
};

const CHAIN_NAMES: Record<number, string> = {
  1: "mainnet",
  11155111: "sepolia",
  16602: "0g-galileo",
  1337: "local",
};

function ethAmount(wei: bigint): string {
  return `${formatEther(wei)} ETH`;
}

function shortHex(hex: string): string {
  return hex.length > 18 ? `${hex.slice(0, 10)}…${hex.slice(-6)}` : hex;
}

/**
 * Decode a pending transaction into operator-readable lines. Falls back to a
 * selector/size summary for anything outside the known ABI surface — the
 * summary must render for every tx, known or not.
 */
export function describeTransaction(tx: {
  to: Address | null;
  data: Hex;
  value?: bigint;
}): TxSummary {
  const lines: string[] = [];

  if (tx.to === null) {
    lines.push(`Initcode: ${(tx.data.length - 2) / 2} bytes`);
    return { title: "Deploy contract", lines };
  }

  let decoded: { functionName: string; args: readonly unknown[] } | null = null;
  try {
    decoded = decodeFunctionData({ abi: KNOWN_WRITE_ABI, data: tx.data });
  } catch {
    decoded = null;
  }

  if (!decoded) {
    lines.push(`To: ${tx.to}`);
    lines.push(`Selector: ${tx.data.slice(0, 10)}`);
    lines.push(`Data: ${(tx.data.length - 2) / 2} bytes`);
  } else {
    switch (decoded.functionName) {
      case "setSubnodeRecord": {
        const [node, label, owner, resolver] = decoded.args as [Hex, Hex, Address, Address, bigint];
        lines.push(`Node: ${shortHex(node)}`);
        lines.push(`Label hash: ${shortHex(label)}`);
        lines.push(`Owner: ${owner}`);
        lines.push(`Resolver: ${resolver}`);
        lines.push(`Registry: ${tx.to}`);
        break;
      }
      case "setAddr": {
        const [node, second, third] = decoded.args as [Hex, string, string | undefined];
        if (third !== undefined) {
          // 3-arg ENSIP-11 overload: (node, coinType, addr bytes).
          const coinType = Number(second);
          const chainId = coinType & 0x80000000 ? coinType & 0x7fffffff : null;
          const chainLabel = chainId !== null ? `${CHAIN_NAMES[chainId] ?? `chain ${chainId}`} (${chainId})` : String(coinType);
          const addr = `0x${(third).slice(-40)}`;
          lines.push(`addr[${chainLabel}] = ${addr}`);
          lines.push(`Node: ${shortHex(node)}`);
        } else {
          lines.push(`addr = ${second}`);
          lines.push(`Node: ${shortHex(node)}`);
        }
        lines.push(`Resolver: ${tx.to}`);
        break;
      }
      case "setText": {
        const [node, key, value] = decoded.args as [Hex, string, string];
        lines.push(`text["${key}"] = ${value}`);
        lines.push(`Node: ${shortHex(node)}`);
        lines.push(`Resolver: ${tx.to}`);
        break;
      }
      case "deposit": {
        lines.push(`Treasury: ${tx.to}`);
        break;
      }
      case "withdraw": {
        const [to, amount] = decoded.args as [Address, bigint];
        lines.push(`To: ${to}`);
        lines.push(`Amount: ${ethAmount(amount)}`);
        lines.push(`Treasury: ${tx.to}`);
        break;
      }
      case "approveFundRequest": {
        const [swarm, requestId] = decoded.args;
        lines.push(`Request: #${requestId}`);
        lines.push(`Swarm: ${swarm}`);
        lines.push(`Treasury: ${tx.to}`);
        break;
      }
      case "rejectFundRequest": {
        const [swarm, requestId, reason] = decoded.args;
        lines.push(`Request: #${requestId}`);
        lines.push(`Reason: "${reason}"`);
        lines.push(`Treasury: ${tx.to}`);
        break;
      }
      case "requestFunds": {
        const [amount, reason] = decoded.args as [bigint, string];
        lines.push(`Amount: ${ethAmount(amount)}`);
        lines.push(`Reason: "${reason}"`);
        lines.push(`Swarm: ${tx.to}`);
        break;
      }
      case "cancelFundRequest": {
        const [requestId] = decoded.args;
        lines.push(`Request: #${requestId}`);
        lines.push(`Swarm: ${tx.to}`);
        break;
      }
      default: {
        lines.push(`${decoded.functionName}(${decoded.args.map((a) => (typeof a === "bigint" ? a.toString() : String(a))).join(", ")})`);
        lines.push(`To: ${tx.to}`);
      }
    }
  }

  if (tx.value !== undefined && tx.value > 0n) {
    lines.push(`Value: ${ethAmount(tx.value)}`);
  }
  return { title: titleFor(decoded?.functionName, tx), lines };
}

function titleFor(functionName: string | undefined, tx: { to: Address | null; data: Hex }): string {
  switch (functionName) {
    case "setSubnodeRecord": return "Bind ENS subdomain";
    case "setAddr": return "Set ENS address";
    case "setText": return "Set ENS text record";
    case "deposit": return "Deposit to treasury";
    case "withdraw": return "Treasury withdraw";
    case "approveFundRequest": return "Approve fund request";
    case "rejectFundRequest": return "Reject fund request";
    case "requestFunds": return "Request funds";
    case "cancelFundRequest": return "Cancel fund request";
    case "publishDocument": return "Publish document";
    case "grantSlotKey": return "Grant slot key";
    default: return `Contract call (${tx.data.slice(0, 10)})`;
  }
}
