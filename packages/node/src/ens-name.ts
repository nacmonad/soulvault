import fs from 'fs-extra';
import { Contract, ZeroAddress, ZeroHash, getAddress, hexlify, randomBytes, type Provider } from 'ethers';
import { labelhash, namehash, normalize } from 'viem/ens';
import { keccak256, toUtf8Bytes } from 'ethers';
import {
  getEthRegistrarController,
  getEnsRegistry,
  createEnsSigner,
  getEnsContracts,
  getNameWrapperContract,
  setEnsText,
  writeOrgMetadata,
} from './ens.js';
import {
  deployEnsV2OrgRegistry,
  ENSV2_USER_REGISTRY_ABI,
  getEnsV2SharedAddresses,
  REGISTRY_ROLES,
} from './ensv2-registry.js';
import { getEnsV2Provider } from './ensv2.js';
import {
  getOrganizationProfile,
  normalizeRootEthEnsName,
  updateOrganizationProfile,
} from './organization.js';
import { writeConfig } from './state.js';
import { resolveOrganizationPath } from './paths.js';
import type { OrganizationProfile } from './organization.js';

const ONE_YEAR_SECONDS = 31_536_000n;
const ZERO_OWNER = '0x0000000000000000000000000000000000000000';

function registerEnsLog(...parts: unknown[]) {
  console.error('[register-ens]', ...parts);
}

/**
 * Chain ids where the node is a local dev chain we are allowed to fast-forward.
 * 1337 is the local ens-app-v3 stack, 31337 is a bare `anvil`/hardhat node.
 */
const DEV_CHAIN_IDS = new Set<bigint>([1337n, 31337n]);

/**
 * Wait out the ENS controller's commit→register delay.
 *
 * On a real network this is a real wait — `minCommitmentAge` is enforced against
 * `block.timestamp` and there is nothing to do but sit through it.
 *
 * On a local dev chain the clock is ours, so jump it instead of burning ~60s of wall
 * time per registration. That is worth real minutes across the integration lane.
 *
 * Guarded three ways, because taking this path on a live network would be a bug that
 * only shows up in front of a hardware wallet: the chain id must be a known dev chain,
 * the provider must actually implement `evm_increaseTime`, and ANY failure falls back to
 * sleeping rather than proceeding as if time had advanced.
 */
async function awaitCommitmentMaturation(
  provider: Provider | null | undefined,
  totalSec: number,
) {
  const n = Math.max(1, Math.floor(totalSec));

  try {
    const chainId = provider ? (await provider.getNetwork()).chainId : undefined;
    if (chainId !== undefined && DEV_CHAIN_IDS.has(chainId) && 'send' in provider!) {
      const send = (provider as { send: (m: string, p: unknown[]) => Promise<unknown> }).send.bind(
        provider,
      );
      await send('evm_increaseTime', [n]);
      await send('evm_mine', []);
      registerEnsLog(
        `Dev chain ${chainId}: advanced chain time by ${n}s instead of waiting. ` +
          'This path is never taken on a live network.',
      );
      return;
    }
  } catch (err) {
    registerEnsLog(
      'Could not fast-forward dev chain time, falling back to a real wait:',
      err instanceof Error ? err.message : String(err),
    );
  }

  await sleepCommitmentMaturation(n);
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
  const price = await controller.rentPrice(availability.label, ONE_YEAR_SECONDS);
  const value = ((BigInt(price.base) + BigInt(price.premium)) * 110n) / 100n;
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
  const registration = {
    label: availability.label,
    owner: signer.address,
    duration: ONE_YEAR_SECONDS,
    secret,
    resolver: publicResolver,
    data: [] as string[],
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

  await awaitCommitmentMaturation(signer.provider, Number(minCommitmentAge + 1n));

  registerEnsLog('Approve REGISTER transaction on your wallet (tx 2/2, pays rent)…');
  const registerTx = await controller.register(registration, { value });
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

// ---------------------------------------------------------------------------
// ENSv2 registration (Phase 2, spec §4): org subname registration on the org's
// SoulVaultRegistry instead of the v1 ETHRegistrar commit/reveal flow.
// ---------------------------------------------------------------------------

const ENSV2_REGISTRY_TEXT_KEY = 'soulvault.ensv2Registry';
const ENSV2_DEFAULT_EPOCH_SECONDS = 30 * 24 * 60 * 60; // 30d epoch cadence

export type RegisterOrganizationEnsV2Result = {
  protocol: 'v2';
  note: string;
  ensName: string;
  registryAddress: string;
  ownerAddress: string;
  expiry: string;
  roleBitmap: string;
  deployTxHash?: string;
  registerTxHash?: string;
  mirrorTxHash?: string;
  metadataTxHashes: Record<string, string | undefined>;
  organization: OrganizationProfile;
};

function parseEnsV2OrgLabel(name: string): { normalized: string; label: string } {
  const normalized = normalize(name.trim());
  if (!normalized.endsWith('.eth')) {
    throw new Error(`ENSv2 org name must end in .eth (got ${normalized})`);
  }
  const label = normalized.slice(0, -4);
  if (!label || label.includes('.')) {
    throw new Error(`ENSv2 org name must be a single label under .eth (got ${normalized})`);
  }
  return { normalized, label };
}

/**
 * Register the org name on ENSv2: deploy (or reuse) the org's SoulVaultRegistry,
 * register the label with epoch-bound expiry, then mirror the registry pointer +
 * metadata text records. One signer path, no commit/reveal wait, no unwrap.
 *
 * Registry reuse: if the profile already records `ensv2Registry`, it is trusted
 * only when the owner still holds ROLE_REGISTRAR on the root resource (same trust
 * rule as `organization deploy-registry`); otherwise a fresh registry is deployed.
 */
export async function registerOrganizationEnsV2(nameOrSlug: string, input?: {
  epochSeconds?: number;
  salt?: bigint;
}) {
  const profile = await getOrganizationProfile(nameOrSlug);
  if (!profile) throw new Error(`Organization not found: ${nameOrSlug}`);
  if (!profile.ensName) {
    throw new Error(
      `Organization ${profile.slug} does not have an ENS root name configured. ` +
        `Use \`soulvault organization set-ens-name --organization ${profile.slug} --ens-name yourname.eth\` first.`,
    );
  }

  const { normalized, label } = parseEnsV2OrgLabel(profile.ensName);
  const epochSeconds = input?.epochSeconds ?? ENSV2_DEFAULT_EPOCH_SECONDS;
  const signer = await createEnsSigner();
  const expiry = BigInt(Math.floor(Date.now() / 1000) + epochSeconds);

  // Step 1 — resolve or deploy the org registry.
  let registryAddress: string | null = null;
  let deployTxHash: string | undefined;
  if (profile.ensv2Registry?.address) {
    const candidate = getAddress(profile.ensv2Registry.address);
    const provider = await getEnsV2Provider();
    const registry = new Contract(candidate, ENSV2_USER_REGISTRY_ABI, provider);
    const rootHasRegistrar: boolean = await registry.hasRoles(
      0n,
      REGISTRY_ROLES.ROLE_REGISTRAR,
      profile.ensv2Registry.owner,
    );
    if (rootHasRegistrar) {
      registryAddress = candidate;
      registerEnsLog('Reusing recorded org registry', candidate);
    } else {
      registerEnsLog(
        `Recorded registry ${candidate} no longer grants its owner ROLE_REGISTRAR on root — deploying a fresh one.`,
      );
    }
  }
  if (!registryAddress) {
    registerEnsLog('Deploying org SoulVaultRegistry via VerifiableFactory (step 1/3)…');
    const deployed = await deployEnsV2OrgRegistry(input?.salt ? { salt: input.salt } : {});
    registryAddress = deployed.registryAddress;
    deployTxHash = deployed.txHash;
    registerEnsLog('Registry deployed:', registryAddress);
  }

  // Step 2 — register the org label with epoch-bound expiry.
  const registry = new Contract(registryAddress, ENSV2_USER_REGISTRY_ABI, signer);
  const anyId = BigInt(labelhash(label));
  const [status] = await registry.getState(anyId);
  if (Number(status) === 2) {
    throw new Error(
      `Label "${label}" is already registered in ${registryAddress}. ` +
        `Renew it (\`swarm renew\` path) or pick a different org name.`,
    );
  }
  const ORG_NAME_ROLES = REGISTRY_ROLES.ROLE_SET_RESOLVER | REGISTRY_ROLES.ROLE_RENEW;
  registerEnsLog('Registering', `${label}.eth`, 'in the org registry (step 2/3)…');
  const registerTx = await registry.register(label, signer.address, ZeroAddress, ZeroAddress, ORG_NAME_ROLES, expiry);
  const registerReceipt = await registerTx.wait();
  registerEnsLog('Register confirmed:', registerReceipt?.hash);
  const [statusRet, expiryRet] = await registry.getState(anyId);

  // Step 3 — mirror registry pointer + metadata on the org name's resolver (best-effort;
  // needs a resolver on the org name — same skip-if-no-resolver rule as the web wizard).
  const record = JSON.stringify({
    version: 2,
    registry: registryAddress,
    owner: signer.address,
    deployedAt: new Date().toISOString(),
  });
  const metadataTxHashes: Record<string, string | undefined> = {};
  let mirrorTxHash: string | undefined;
  try {
    registerEnsLog('Mirroring registry pointer + metadata records (step 3/3)…');
    const mirror = await setEnsText(normalized, ENSV2_REGISTRY_TEXT_KEY, record);
    mirrorTxHash = mirror.txHash;
    const metadata = await writeOrgMetadata(normalized, { name: profile.name });
    Object.assign(metadataTxHashes, metadata.txHashes);
  } catch (err) {
    registerEnsLog(
      'WARNING: resolver mirror/metadata failed:',
      (err as Error).message,
      '— registration is still durable; re-run register-ens --ens-v2 or organization set-metadata to retry.',
    );
  }

  const nowIso = new Date().toISOString();
  const updated = await updateOrganizationProfile(profile.slug, {
    ensRegistration: {
      status: 'registered',
      checkedAt: nowIso,
      txHash: deployTxHash ?? registerReceipt?.hash,
      ownerAddress: signer.address,
    },
    ensv2Registry: {
      address: registryAddress,
      owner: signer.address,
      deploymentTxHash: deployTxHash,
      deployedAt: profile.ensv2Registry?.deployedAt ?? nowIso,
    },
    metadata: Object.keys(metadataTxHashes).length
      ? { publishedAt: nowIso, txHashes: metadataTxHashes, values: { name: profile.name } }
      : profile.metadata,
    updatedAt: nowIso,
  });
  await writeConfig({ activeOrganization: profile.slug });

  return {
    protocol: 'v2' as const,
    note: `Registered ${normalized} on ENSv2 (epoch expiry ${expiryRet.toString()}).`,
    ensName: normalized,
    registryAddress,
    ownerAddress: signer.address,
    expiry: expiryRet.toString(),
    roleBitmap: ORG_NAME_ROLES.toString(),
    deployTxHash,
    registerTxHash: registerReceipt?.hash,
    mirrorTxHash,
    metadataTxHashes,
    organization: updated,
  } satisfies RegisterOrganizationEnsV2Result & { organization: OrganizationProfile };
}
