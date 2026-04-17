/**
 * Deterministic funding helper shared by Speculos + hardware integration suites.
 *
 * Spec: docs/clear-signing-spec.md §9.
 *
 * Contract:
 *   - account[0] on the local JSON-RPC node is the funder (ens-app-v3 ships unlocked accounts).
 *   - MIN_OWNER_BALANCE: if the Ledger/Speculos owner has less than this, top-up.
 *   - FUND_TOPUP:        amount transferred per top-up transaction.
 *   - Also top-up `secondaryAccounts` so member-side txs (requestJoin, requestFunds) succeed.
 */

import { JsonRpcProvider, parseEther, Wallet } from 'ethers';

export const MIN_OWNER_BALANCE = parseEther('10');
export const FUND_TOPUP = parseEther('20');

export interface FundPlan {
  rpcUrl: string;
  ownerAddress: string;
  secondaryAccounts?: string[];
  /** Override thresholds for test-specific cases. */
  minBalance?: bigint;
  topUpAmount?: bigint;
  /**
   * If provided, used to sign funding txs. The caller should share this same
   * Wallet with any downstream deploys to avoid nonce collisions between
   * multiple Wallet instances that share a private key.
   */
  funderWallet?: Wallet;
}

export interface FundResult {
  funderAddress: string;
  ownerBalance: bigint;
  secondaryBalances: Record<string, bigint>;
  txHashes: string[];
}

export async function ensureFunded(plan: FundPlan): Promise<FundResult> {
  const provider = new JsonRpcProvider(plan.rpcUrl);
  const minBalance = plan.minBalance ?? MIN_OWNER_BALANCE;
  const topUpAmount = plan.topUpAmount ?? FUND_TOPUP;

  // Use a local-wallet-signed path when SOULVAULT_PRIVATE_KEY is set. This
  // keeps nonce management consistent with contract deploys that use the same
  // key, avoiding "replacement underpriced" / "nonce too low" collisions.
  const pk = process.env.SOULVAULT_PRIVATE_KEY;
  const funderWallet = plan.funderWallet ?? (pk ? new Wallet(pk, provider) : undefined);
  const funderAddr = funderWallet
    ? (await funderWallet.getAddress()).toLowerCase()
    : ((await provider.send('eth_accounts', [])) as string[])[0]?.toLowerCase();
  if (!funderAddr) {
    throw new Error(
      `No funder available on ${plan.rpcUrl}: set SOULVAULT_PRIVATE_KEY or expose eth_accounts[0].`,
    );
  }

  const txHashes: string[] = [];

  const topUp = async (to: string) => {
    const currentHex = (await provider.send('eth_getBalance', [to, 'latest'])) as string;
    const current = BigInt(currentHex);
    if (current >= minBalance) return current;
    if (to.toLowerCase() === funderAddr) {
      return current;
    }
    let txHash: string;
    if (funderWallet) {
      const latestNonce = await provider.getTransactionCount(await funderWallet.getAddress(), 'latest');
      const tx = await funderWallet.sendTransaction({ to, value: topUpAmount, nonce: latestNonce });
      txHash = tx.hash;
      await tx.wait(1);
    } else {
      txHash = (await provider.send('eth_sendTransaction', [
        { from: funderAddr, to, value: '0x' + topUpAmount.toString(16) },
      ])) as string;
      await provider.waitForTransaction(txHash, 1, 30_000);
    }
    txHashes.push(txHash);
    const afterHex = (await provider.send('eth_getBalance', [to, 'latest'])) as string;
    const after = BigInt(afterHex);
    if (after < minBalance) {
      throw new Error(
        `Funding ${to} failed: balance still ${after} < ${minBalance} after top-up. Funder=${funderAddr}, tx=${txHash}.`,
      );
    }
    return after;
  };

  const ownerBalance = await topUp(plan.ownerAddress);
  const secondaryBalances: Record<string, bigint> = {};
  for (const addr of plan.secondaryAccounts ?? []) {
    secondaryBalances[addr] = await topUp(addr);
  }

  return { funderAddress: funderAddr, ownerBalance, secondaryBalances, txHashes };
}
