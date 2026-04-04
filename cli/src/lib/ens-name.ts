import fs from 'fs-extra';
import { ZeroAddress, ZeroHash, hexlify, randomBytes } from 'ethers';
import { normalize, namehash } from 'viem/ens';
import { getEthRegistrarController, getEnsRegistry, createEnsSigner } from './ens.js';
import { getOrganizationProfile } from './organization.js';
import { writeConfig } from './state.js';
import { resolveOrganizationPath } from './paths.js';
import type { OrganizationProfile } from './organization.js';

const ONE_YEAR_SECONDS = 31_536_000n;
const ZERO_OWNER = '0x0000000000000000000000000000000000000000';

function parseEthRootLabel(name: string) {
  const normalized = normalize(name);
  const parts = normalized.split('.');
  if (parts.length !== 2 || parts[1] !== 'eth') {
    throw new Error(`Only root .eth organization names are supported right now. Got: ${name}`);
  }
  return { normalized, label: parts[0] };
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
    throw new Error(`Organization ${profile.slug} does not have an ENS root name configured.`);
  }

  const availability = await checkEnsNameAvailability(profile.ensName);
  if (!availability.valid) {
    throw new Error(`ENS name is not valid for registration: ${profile.ensName}`);
  }
  if (!availability.available) {
    throw new Error(`ENS name unavailable on Sepolia: ${profile.ensName} (current owner: ${availability.owner}). Choose a different organization ENS root and retry.`);
  }

  const signer = await createEnsSigner();
  const controller = await getEthRegistrarController(true);
  const minCommitmentAge = BigInt(await controller.minCommitmentAge());
  const price = await controller.rentPrice(availability.label, ONE_YEAR_SECONDS);
  const total = BigInt(price.base) + BigInt(price.premium);
  const value = (total * 110n) / 100n;
  const secret = hexlify(randomBytes(32));

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
  const commitTx = await controller.commit(commitment);
  const commitReceipt = await commitTx.wait();

  await new Promise((resolve) => setTimeout(resolve, Number((minCommitmentAge + 1n) * 1000n)));

  const registerTx = await controller.register(registration, { value });
  const registerReceipt = await registerTx.wait();

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
