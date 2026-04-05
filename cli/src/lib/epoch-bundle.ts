import crypto from 'node:crypto';
import { keccak256 } from 'ethers';
import { listSwarmMembers, getSwarmContract, getSwarmContractReadonly } from './swarm-contract.js';
import { getAgentProfile } from './agent.js';
import { uploadJsonTo0G, downloadFrom0G } from './0g.js';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { getSignerPrivateKey } from './signer.js';
import { generateEpochKeyHex, readEpochKey, storeEpochKey } from './epoch-key-store.js';

export type EpochBundleEntry = {
  memberName?: string;
  wrappedKey: string;
  pubkeyRef: string;
  algorithm: 'secp256k1-ecdh-aes-256-gcm';
  ephemeralPublicKey: string;
  nonce: string;
};

export type EpochBundle = {
  version: 1;
  swarm: {
    contract: string;
    chainId: number;
    epoch: number;
    membershipVersion: number;
  };
  keyWrap: {
    algorithm: 'secp256k1-ecdh-aes-256-gcm';
    note: string;
  };
  entries: Record<string, EpochBundleEntry>;
  createdAt: string;
};

function normalizeHex(hex: string) {
  return hex.startsWith('0x') ? hex.slice(2) : hex;
}

function deriveAesKey(secret: Buffer) {
  return crypto.createHash('sha256').update(secret).digest();
}

export function wrapEpochKeyForSecp256k1PublicKey(epochKeyHex: string, recipientPubkeyHex: string): EpochBundleEntry {
  const recipientPubkey = normalizeHex(recipientPubkeyHex);
  const ecdh = crypto.createECDH('secp256k1');
  ecdh.generateKeys();
  const sharedSecret = ecdh.computeSecret(Buffer.from(recipientPubkey, 'hex'));
  const aesKey = deriveAesKey(sharedSecret);
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', aesKey, nonce);
  const plaintext = Buffer.from(normalizeHex(epochKeyHex), 'hex');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    wrappedKey: Buffer.concat([ciphertext, authTag]).toString('base64'),
    pubkeyRef: '',
    algorithm: 'secp256k1-ecdh-aes-256-gcm',
    ephemeralPublicKey: ecdh.getPublicKey('hex', 'uncompressed'),
    nonce: nonce.toString('hex'),
  };
}

export async function generateEpochBundleJson(input: { swarm?: string; newEpoch?: number }) {
  const { profile, contract } = await getSwarmContractReadonly(input.swarm);
  const roster = await listSwarmMembers({ swarm: input.swarm });
  const currentEpoch = Number(await contract.currentEpoch());
  const membershipVersion = Number(await contract.membershipVersion());
  const nextEpoch = input.newEpoch ?? currentEpoch + 1;
  const existing = await readEpochKey(profile.slug, nextEpoch);
  const epochKeyHex = existing?.keyHex ?? generateEpochKeyHex();
  if (!existing) {
    await storeEpochKey({ swarm: profile.slug, epoch: nextEpoch, keyHex: epochKeyHex, source: 'generated' });
  }
  const localAgent = await getAgentProfile();

  const entries: Record<string, EpochBundleEntry> = {};
  for (const member of roster.members.filter((m) => m.active)) {
    const wrapped = wrapEpochKeyForSecp256k1PublicKey(epochKeyHex, member.pubkey);
    entries[member.wallet] = {
      ...wrapped,
      memberName: localAgent?.address?.toLowerCase() === member.wallet.toLowerCase() ? localAgent.name : undefined,
      pubkeyRef: `agent-pubkey:${member.wallet}`,
    };
  }

  const bundle: EpochBundle = {
    version: 1,
    swarm: {
      contract: profile.contractAddress!,
      chainId: profile.chainId,
      epoch: nextEpoch,
      membershipVersion,
    },
    keyWrap: {
      algorithm: 'secp256k1-ecdh-aes-256-gcm',
      note: 'wrapped K_epoch entries per active member',
    },
    entries,
    createdAt: new Date().toISOString(),
  };

  const jsonBytes = Buffer.from(JSON.stringify(bundle, null, 2), 'utf8');
  const bundleHash = keccak256(jsonBytes);
  return {
    bundle,
    bundleHash,
    membershipVersion,
    nextEpoch,
    epochKeyHex,
  };
}

export async function rotateEpochWithBundle(input: { swarm?: string; newEpoch?: number }) {
  const { profile, contract } = await getSwarmContract(input.swarm);
  const generated = await generateEpochBundleJson(input);
  const upload = await uploadJsonTo0G(generated.bundle) as { rootHash?: string; txHash?: string; rootHashes?: string[]; txHashes?: string[] };
  const keyBundleRef = upload.rootHash ?? upload.rootHashes?.[0];
  const publishTxHash = upload.txHash ?? upload.txHashes?.[0];
  if (!keyBundleRef) throw new Error('0G upload did not return a root hash for the epoch bundle');

  const tx = await contract.rotateEpoch(generated.nextEpoch, keyBundleRef, generated.bundleHash, generated.membershipVersion);
  const receipt = await tx.wait();

  return {
    swarm: profile.slug,
    contractAddress: profile.contractAddress,
    newEpoch: generated.nextEpoch,
    membershipVersion: generated.membershipVersion,
    keyBundleRef,
    keyBundleHash: generated.bundleHash,
    publishTxHash,
    rotateTxHash: receipt?.hash,
    entryCount: Object.keys(generated.bundle.entries).length,
    keyFingerprint: crypto.createHash('sha256').update(Buffer.from(generated.epochKeyHex.replace(/^0x/, ''), 'hex')).digest('hex'),
    bundle: generated.bundle,
  };
}

export async function getLatestEpochBundle(input: { swarm?: string }) {
  const { profile, contract } = await getSwarmContractReadonly(input.swarm);
  const logs = await contract.queryFilter(contract.filters.EpochRotated(), 0, 'latest');
  const latest = logs.at(-1);
  if (!latest) {
    return {
      swarm: profile.slug,
      contractAddress: profile.contractAddress,
      note: 'No EpochRotated event found yet.',
    };
  }

  const parsed = contract.interface.parseLog(latest);
  const keyBundleRef = String(parsed?.args?.keyBundleRef ?? '');
  const tempPath = path.join(os.tmpdir(), `soulvault-epoch-bundle-${Date.now()}.json`);
  await downloadFrom0G(keyBundleRef, tempPath);
  const bundle = await fs.readJson(tempPath);

  return {
    swarm: profile.slug,
    contractAddress: profile.contractAddress,
    oldEpoch: parsed?.args?.oldEpoch?.toString(),
    newEpoch: parsed?.args?.newEpoch?.toString(),
    keyBundleRef,
    keyBundleHash: String(parsed?.args?.keyBundleHash ?? ''),
    membershipVersion: parsed?.args?.membershipVersion?.toString(),
    bundle,
  };
}

export async function decryptBundleForCurrentMember(input: { swarm?: string; printKey?: boolean }) {
  const agent = await getAgentProfile();
  if (!agent) throw new Error('No local agent profile found. Run `soulvault agent create` first.');

  const latest = await getLatestEpochBundle({ swarm: input.swarm });
  if (!('bundle' in latest) || !latest.bundle) {
    throw new Error('No epoch bundle available for this swarm yet.');
  }

  const entry = latest.bundle.entries[agent.address];
  if (!entry) {
    throw new Error(`No epoch bundle entry found for current member ${agent.address}`);
  }

  const privateKey = (await getSignerPrivateKey()).replace(/^0x/, '');
  const ecdh = crypto.createECDH('secp256k1');
  ecdh.setPrivateKey(Buffer.from(privateKey, 'hex'));
  const sharedSecret = ecdh.computeSecret(Buffer.from(normalizeHex(entry.ephemeralPublicKey), 'hex'));
  const aesKey = deriveAesKey(sharedSecret);

  const wrapped = Buffer.from(entry.wrappedKey, 'base64');
  const ciphertext = wrapped.subarray(0, wrapped.length - 16);
  const authTag = wrapped.subarray(wrapped.length - 16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', aesKey, Buffer.from(entry.nonce, 'hex'));
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  const unwrappedKeyHex = plaintext.toString('hex');
  const keyFingerprint = keccak256(`0x${unwrappedKeyHex}`);
  let expected = await readEpochKey(latest.swarm, Number(latest.newEpoch));

  if (!expected) {
    // No local key — import the unwrapped key from the bundle (new machine / fresh state)
    expected = await storeEpochKey({
      swarm: latest.swarm,
      epoch: Number(latest.newEpoch),
      keyHex: `0x${unwrappedKeyHex}`,
      source: 'imported',
    });
  }

  const expectedKeyHex = normalizeHex(expected.keyHex);
  const matchesExpected = unwrappedKeyHex === expectedKeyHex;

  return {
    swarm: latest.swarm,
    contractAddress: latest.contractAddress,
    epoch: latest.newEpoch,
    memberAddress: agent.address,
    memberName: agent.name,
    algorithm: entry.algorithm,
    entryFound: true,
    matchesExpected,
    keyFingerprint,
    expectedKeyFingerprint: keccak256(`0x${expectedKeyHex}`),
    keyBundleRef: latest.keyBundleRef,
    localKeySource: expected.source,
    importedFromBundle: expected.source === 'imported',
    unwrappedKeyHex: input.printKey ? `0x${unwrappedKeyHex}` : undefined,
  };
}
