import fs from 'fs-extra';
import { ZeroAddress, ZeroHash, hexlify, randomBytes } from 'ethers';
import { namehash } from 'viem/ens';
import { keccak256, toUtf8Bytes } from 'ethers';
import {
  getEthRegistrarController,
  getEnsRegistry,
  createEnsSigner,
  getEnsContracts,
  getNameWrapperContract,
  writeOrgMetadata,
} from './ens.js';
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

/**
 * Structured error thrown when `register-ens` is called on an ENS name that is already
 * owned or otherwise unavailable. The CLI command layer catches this specifically and
 * prints an actionable recovery prompt (run `organization set-ens-name` with a new
 * name, then retry). Library callers can also catch it to implement their own
 * retry-with-different-name flows without having to parse error message text.
 */
export class EnsNameUnavailableError extends Error {
  readonly ensName: string;
  readonly currentOwner: string;
  readonly organizationSlug: string;

  constructor(args: { ensName: string; currentOwner: string; organizationSlug: string }) {
    super(
      `ENS name "${args.ensName}" is not available (current owner: ${args.currentOwner}). ` +
        `Pick a different name and re-run \`soulvault organization set-ens-name ` +
        `--organization ${args.organizationSlug} --ens-name <newName.eth>\`, then retry ` +
        `\`organization register-ens\`.`,
    );
    this.name = 'EnsNameUnavailableError';
    this.ensName = args.ensName;
    this.currentOwner = args.currentOwner;
    this.organizationSlug = args.organizationSlug;
  }
}

/**
 * Structured error thrown when the ENS label fails the controller's `valid(label)`
 * check. Distinct from "taken" — this one means the label contains disallowed chars,
 * is too short, etc. User needs a new name in a different shape, not just a different
 * name in the same shape.
 */
export class EnsNameInvalidError extends Error {
  readonly ensName: string;
  readonly organizationSlug: string;

  constructor(args: { ensName: string; organizationSlug: string }) {
    super(
      `ENS name "${args.ensName}" is not a valid label per the registrar controller ` +
        `(too short, contains disallowed characters, or otherwise malformed). Pick a ` +
        `different name and re-run \`soulvault organization set-ens-name ` +
        `--organization ${args.organizationSlug} --ens-name <newName.eth>\`, then retry ` +
        `\`organization register-ens\`.`,
    );
    this.name = 'EnsNameInvalidError';
    this.ensName = args.ensName;
    this.organizationSlug = args.organizationSlug;
  }
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
    throw new EnsNameInvalidError({
      ensName: profile.ensName,
      organizationSlug: profile.slug,
    });
  }
  if (!availability.available) {
    throw new EnsNameUnavailableError({
      ensName: profile.ensName,
      currentOwner: String(availability.owner),
      organizationSlug: profile.slug,
    });
  }

  registerEnsLog(
    'Opening signer for ENS lane (Sepolia). With Ledger: approve the session / address export if prompted; signing for commit/register comes next.',
  );
  const signer = await createEnsSigner();
  const controller = await getEthRegistrarController(true);
  const minCommitmentAge = BigInt(await controller.minCommitmentAge());
  // Flat uint256 base price (not a tuple). Bump 10% to absorb any premium the pricer
  // might tack on, since we pay with an exact-amount `value` on the register tx.
  const basePriceWei = BigInt(await controller.rentPrice(availability.label, ONE_YEAR_SECONDS));
  const value = (basePriceWei * 110n) / 100n;
  const secret = hexlify(randomBytes(32));

  registerEnsLog('Signer address:', signer.address);
  registerEnsLog('minCommitmentAge (seconds):', minCommitmentAge.toString(), '— register tx must wait this long after commit mines.');
  registerEnsLog('Registration value (wei, ~110% of quote):', value.toString());

  // Pass the public resolver address so the controller wires it up atomically with
  // registration. Without a resolver, the ENS name is registered with a zero resolver,
  // which silently breaks every `text` / `addr` read through the standard registry →
  // resolver lookup path. We don't need any initial records in `data[]` — metadata
  // writes happen in separate txs after registration via `writeOrgMetadata` and the
  // treasury / swarm create flows.
  const publicResolver = getEnsContracts().publicResolver;
  const registerArgs = [
    availability.label,
    signer.address,
    ONE_YEAR_SECONDS,
    secret,
    publicResolver,
    [], // bytes[] data — no inline resolver calls
    false, // reverseRecord
    0, // ownerControlledFuses
  ] as const;

  const commitment = await controller.makeCommitment(...registerArgs);
  registerEnsLog('Approve COMMIT transaction on your wallet (tx 1/2)…');
  const commitTx = await controller.commit(commitment);
  registerEnsLog('Commit tx submitted:', commitTx.hash);
  registerEnsLog('Waiting for commit receipt…');
  const commitReceipt = await commitTx.wait();
  registerEnsLog('Commit confirmed in block:', commitReceipt?.blockNumber?.toString() ?? '?');

  await sleepCommitmentMaturation(Number(minCommitmentAge + 1n));

  registerEnsLog('Approve REGISTER transaction on your wallet (tx 2/2, pays rent)…');
  const registerTx = await controller.register(...registerArgs, { value });
  registerEnsLog('Register tx submitted:', registerTx.hash);
  registerEnsLog('Waiting for register receipt…');
  const registerReceipt = await registerTx.wait();
  registerEnsLog('Register confirmed in block:', registerReceipt?.blockNumber?.toString() ?? '?');

  // If the controller wraps the name via NameWrapper (modern ens-contracts default),
  // the registry's `owner(namehash)` becomes the NameWrapper address, which breaks all
  // subsequent legacy registry ops like `setSubnodeRecord`. SoulVault's subdomain flow
  // (swarms as subdomains of the org) needs direct registry ownership, so we unwrap the
  // .eth 2LD immediately after registration. The wallet remains both the ERC721 holder
  // on the BaseRegistrar and the registry owner of the unwrapped node. If the controller
  // has no NameWrapper (legacy deployments), we skip this step entirely.
  let nameWrapperAddress: string | undefined;
  try {
    const maybeWrapper = String(await controller.nameWrapper());
    if (maybeWrapper && maybeWrapper !== ZeroAddress) {
      nameWrapperAddress = maybeWrapper;
    }
  } catch {
    // Legacy controller without nameWrapper() — nothing to unwrap.
  }
  if (nameWrapperAddress) {
    registerEnsLog('NameWrapper detected at', nameWrapperAddress, '— unwrapping .eth 2LD so the registry owner becomes the wallet…');
    const nameWrapper = await getNameWrapperContract(nameWrapperAddress, true);
    const labelhash = keccak256(toUtf8Bytes(availability.label));
    const unwrapTx = await nameWrapper.unwrapETH2LD(labelhash, signer.address, signer.address);
    registerEnsLog('Unwrap tx submitted:', unwrapTx.hash);
    const unwrapReceipt = await unwrapTx.wait();
    registerEnsLog('Unwrap confirmed in block:', unwrapReceipt?.blockNumber?.toString() ?? '?');
  }

  // Write the org metadata text records (class/name/description/url) per the draft
  // ENSIP on organizational metadata. This is best-effort: if it fails, the registration
  // itself is still durable and the user can re-run `register-ens` or a future
  // `organization set-metadata` command to retry. We log and continue rather than
  // throwing, since the rent has already been paid.
  let metadataResult: Awaited<ReturnType<typeof writeOrgMetadata>> | null = null;
  try {
    registerEnsLog('Writing org metadata records (class, name, description)…');
    metadataResult = await writeOrgMetadata(profile.ensName, {
      name: profile.name,
      // `description` / `url` aren't tracked in the profile today; leave them out so
      // `register-ens` doesn't clobber any out-of-band edits. A future
      // `organization set-metadata` command can write them explicitly.
    });
    registerEnsLog('Org metadata written.');
  } catch (err) {
    registerEnsLog(
      'WARNING: failed to write org metadata records:',
      (err as Error).message,
      '— registration is still durable; re-run register-ens or use organization set-metadata to retry.',
    );
  }

  const nowIso = new Date().toISOString();
  const updated: OrganizationProfile = {
    ...profile,
    ensRegistration: {
      status: 'registered',
      checkedAt: nowIso,
      txHash: registerReceipt?.hash,
      ownerAddress: signer.address,
    },
    metadata: metadataResult
      ? {
          publishedAt: nowIso,
          txHashes: metadataResult.txHashes,
          values: { name: profile.name },
        }
      : profile.metadata,
    updatedAt: nowIso,
  };

  await fs.writeJson(resolveOrganizationPath(profile.slug), updated, { spaces: 2 });
  await writeConfig({ activeOrganization: profile.slug });

  return {
    note: `Registered ${profile.ensName} on Sepolia.`,
    availability,
    commitment,
    commitTxHash: commitReceipt?.hash,
    registerTxHash: registerReceipt?.hash,
    ownerAddress: signer.address,
    amountWei: value.toString(),
    metadata: metadataResult,
    organization: updated,
  };
}
