import fs from 'fs-extra';
import { ZeroAddress, ZeroHash, hexlify, randomBytes } from 'ethers';
import { namehash } from 'viem/ens';
import { getEthRegistrarController, getEnsRegistry, createEnsSigner } from './ens.js';
import { getOrganizationProfile, normalizeRootEthEnsName } from './organization.js';
import { writeConfig } from './state.js';
import { resolveOrganizationPath } from './paths.js';
import type { OrganizationProfile } from './organization.js';

const ONE_YEAR_SECONDS = 31_536_000n;
const ZERO_OWNER = '0x0000000000000000000000000000000000000000';

function registerEnsLog(...parts: unknown[]) {
  console.error('[register-ens]', ...parts);
}

/** Visible heartbeat during the mandatory commit→register delay (often ~60s on Sepolia). */
async function sleepCommitmentMaturation(totalSec: number) {
  const n = Math.max(1, Math.floor(totalSec));
  registerEnsLog(
    `Waiting ${n}s for commitment maturation (ENS controller minCommitmentAge + 1s). The CLI is not stuck; do not interrupt.`,
  );
  const chunkSec = 15;
  let remaining = n;
  while (remaining > 0) {
    const step = Math.min(chunkSec, remaining);
    await new Promise((resolve) => setTimeout(resolve, step * 1000));
    remaining -= step;
    if (remaining > 0) {
      registerEnsLog(`… ~${remaining}s remaining`);
    }
  }
}

function parseEthRootLabel(name: string) {
  const normalized = normalizeRootEthEnsName(name);
  const label = normalized.split('.')[0]!;
  return { normalized, label };
}

export async function checkEnsNameAvailability(name: string) {
  const { normalized, label } = parseEthRootLabel(name);
  const registry = await getEnsRegistry();
  const controller = await getEthRegistrarController(false);
  const node = namehash(normalized);
  const [owner, available, valid] = await Promise.all([
    registry.owner(node),
    controller.available(label),
    controller.valid(label),
  ]);

  return {
    name: normalized,
    label,
    node,
    owner,
    available: Boolean(valid && available && (!owner || owner === ZERO_OWNER)),
    valid: Boolean(valid),
  };
}

export async function registerOrganizationEns(nameOrSlug: string) {
  const profile = await getOrganizationProfile(nameOrSlug);
  if (!profile) {
    throw new Error(`Organization not found: ${nameOrSlug}`);
  }
  if (!profile.ensName) {
    throw new Error(
      `Organization ${profile.slug} does not have an ENS root name configured. ` +
        `Use \`soulvault organization create --ens-name yourname.eth ...\` or ` +
        `\`soulvault organization set-ens-name --organization ${profile.slug} --ens-name yourname.eth\`. ` +
        `State lives in ~/.soulvault/organizations/${profile.slug}.json (not config.json).`,
    );
  }

  const availability = await checkEnsNameAvailability(profile.ensName);
  if (!availability.valid) {
    throw new Error(`ENS name is not valid for registration: ${profile.ensName}`);
  }
  if (!availability.available) {
    throw new Error(`ENS name unavailable on Sepolia: ${profile.ensName} (current owner: ${availability.owner}). Choose a different organization ENS root and retry.`);
  }

  registerEnsLog(
    'Opening signer for ENS lane (Sepolia). With Ledger: approve the session / address export if prompted; signing for commit/register comes next.',
  );
  const signer = await createEnsSigner();
  const controller = await getEthRegistrarController(true);
  const minCommitmentAge = BigInt(await controller.minCommitmentAge());
  const price = await controller.rentPrice(availability.label, ONE_YEAR_SECONDS);
  const total = BigInt(price.base) + BigInt(price.premium);
  const value = (total * 110n) / 100n;
  const secret = hexlify(randomBytes(32));

  registerEnsLog('Signer address:', signer.address);
  registerEnsLog('minCommitmentAge (seconds):', minCommitmentAge.toString(), '— register tx must wait this long after commit mines.');
  registerEnsLog('Registration value (wei, ~110% of quote):', value.toString());

  const registration = {
    label: availability.label,
    owner: signer.address,
    duration: ONE_YEAR_SECONDS,
    secret,
    resolver: ZeroAddress,
    data: [],
    reverseRecord: 0,
    referrer: ZeroHash,
  };

  const commitment = await controller.makeCommitment(registration);
  registerEnsLog('Approve COMMIT transaction on your wallet (tx 1/2)…');
  const commitTx = await controller.commit(commitment);
  registerEnsLog('Commit tx submitted:', commitTx.hash);
  registerEnsLog('Waiting for commit receipt…');
  const commitReceipt = await commitTx.wait();
  registerEnsLog('Commit confirmed in block:', commitReceipt?.blockNumber?.toString() ?? '?');

  await sleepCommitmentMaturation(Number(minCommitmentAge + 1n));

  registerEnsLog('Approve REGISTER transaction on your wallet (tx 2/2, pays rent)…');
  const registerTx = await controller.register(registration, { value });
  registerEnsLog('Register tx submitted:', registerTx.hash);
  registerEnsLog('Waiting for register receipt…');
  const registerReceipt = await registerTx.wait();
  registerEnsLog('Register confirmed in block:', registerReceipt?.blockNumber?.toString() ?? '?');

  const updated: OrganizationProfile = {
    ...profile,
    ensRegistration: {
      status: 'registered',
      checkedAt: new Date().toISOString(),
      txHash: registerReceipt?.hash,
      ownerAddress: signer.address,
    },
    updatedAt: new Date().toISOString(),
  };

  await fs.writeJson(resolveOrganizationPath(profile.slug), updated, { spaces: 2 });
  await writeConfig({ activeOrganization: profile.slug });

  return {
    note: `Registered ${profile.ensName} on Sepolia.` ,
    availability,
    commitment,
    commitTxHash: commitReceipt?.hash,
    registerTxHash: registerReceipt?.hash,
    ownerAddress: signer.address,
    amountWei: value.toString(),
    organization: updated,
  };
}
