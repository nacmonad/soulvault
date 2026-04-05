import crypto from 'node:crypto';
import { Command } from 'commander';
import { keccak256 } from 'ethers';
import { postMessageToSwarm, listSwarmMessages, getSwarmContractReadonly } from '../lib/swarm-contract.js';
import { uploadJsonTo0G, downloadFrom0G } from '../lib/0g.js';
import { getAgentProfile } from '../lib/agent.js';
import { readEpochKey } from '../lib/epoch-key-store.js';
import { getActiveSwarm, getSwarmProfile } from '../lib/swarm.js';
import { getSignerPrivateKey } from '../lib/signer.js';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';

const ADDRESS_ZERO = '0x0000000000000000000000000000000000000000';

function normalizeHex(hex: string) {
  return hex.startsWith('0x') ? hex.slice(2) : hex;
}

function deriveAesKey(secret: Buffer) {
  return crypto.createHash('sha256').update(secret).digest();
}

/** Encrypt plaintext bytes with AES-256-GCM using the epoch key (group/swarm-readable). */
function encryptWithEpochKey(plaintext: Buffer, epochKeyHex: string, aadParts: Record<string, string>) {
  const key = Buffer.from(normalizeHex(epochKeyHex), 'hex');
  const nonce = crypto.randomBytes(12);
  const aad = Buffer.from(JSON.stringify(aadParts), 'utf8');
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    ciphertext: Buffer.concat([ciphertext, authTag]).toString('base64'),
    nonce: nonce.toString('hex'),
    aad: aad.toString('utf8'),
    algorithm: 'aes-256-gcm' as const,
  };
}

/** Decrypt AES-256-GCM ciphertext with the epoch key (group messages). */
function decryptWithEpochKey(ciphertextBase64: string, nonceHex: string, aadString: string, epochKeyHex: string) {
  const key = Buffer.from(normalizeHex(epochKeyHex), 'hex');
  const raw = Buffer.from(ciphertextBase64, 'base64');
  const ciphertext = raw.subarray(0, raw.length - 16);
  const authTag = raw.subarray(raw.length - 16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(nonceHex, 'hex'));
  decipher.setAuthTag(authTag);
  decipher.setAAD(Buffer.from(aadString, 'utf8'));
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/** Encrypt plaintext bytes with secp256k1-ECDH + AES-256-GCM to a recipient's public key (DM). */
function encryptForRecipientPubkey(plaintext: Buffer, recipientPubkeyHex: string) {
  const recipientPubkey = normalizeHex(recipientPubkeyHex);
  const ecdh = crypto.createECDH('secp256k1');
  ecdh.generateKeys();
  const sharedSecret = ecdh.computeSecret(Buffer.from(recipientPubkey, 'hex'));
  const aesKey = deriveAesKey(sharedSecret);
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', aesKey, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    ciphertext: Buffer.concat([ciphertext, authTag]).toString('base64'),
    ephemeralPublicKey: ecdh.getPublicKey('hex', 'uncompressed'),
    nonce: nonce.toString('hex'),
    algorithm: 'secp256k1-ecdh-aes-256-gcm' as const,
  };
}

/** Decrypt secp256k1-ECDH + AES-256-GCM ciphertext using the local private key (DM). */
function decryptWithPrivateKey(ciphertextBase64: string, ephemeralPubkeyHex: string, nonceHex: string, privateKeyHex: string) {
  const ecdh = crypto.createECDH('secp256k1');
  ecdh.setPrivateKey(Buffer.from(normalizeHex(privateKeyHex), 'hex'));
  const sharedSecret = ecdh.computeSecret(Buffer.from(normalizeHex(ephemeralPubkeyHex), 'hex'));
  const aesKey = deriveAesKey(sharedSecret);
  const raw = Buffer.from(ciphertextBase64, 'base64');
  const ciphertext = raw.subarray(0, raw.length - 16);
  const authTag = raw.subarray(raw.length - 16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', aesKey, Buffer.from(nonceHex, 'hex'));
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

export function registerMessageCommands(program: Command) {
  const msg = program.command('msg').description('Post and read swarm messages via the SoulVault contract')
    .addHelpText('after', `\nMessage modes:\n  --mode public    Plaintext broadcast (to=address(0))\n  --mode group     Encrypted with K_epoch, swarm-readable (to=address(0))\n  --mode dm        Encrypted to recipient pubkey (to=<address>)\n\nExamples:\n  soulvault msg post --topic status --body "checkpoint ok" --mode public\n  soulvault msg post --topic coordination --body '{"task":"reindex"}' --mode group\n  soulvault msg post --topic handoff --body "task details" --mode dm --to 0x...\n  soulvault msg list --swarm ops\n  soulvault msg show --payload-ref 0xabc...`);

  msg
    .command('post')
    .requiredOption('--topic <topic>', 'Message topic (e.g., status, coordination, heartbeat)')
    .requiredOption('--body <text>', 'Message body (plain text or JSON string)')
    .option('--mode <mode>', 'Message mode: public, group, or dm (default: public)', 'public')
    .option('--to <address>', 'Recipient address (required for dm mode)')
    .option('--swarm <nameOrEns>', 'Target swarm')
    .option('--ttl <seconds>', 'Time-to-live in seconds (default: 3600)')
    .action(async (options) => {
      const agent = await getAgentProfile();
      if (!agent) throw new Error('No local agent profile found. Run `soulvault agent create` first.');

      const mode: 'public' | 'group' | 'dm' = options.mode;
      if (mode === 'dm' && !options.to) {
        throw new Error('--to <address> is required for dm mode');
      }

      const toAddress = mode === 'dm' ? options.to : ADDRESS_ZERO;
      const bodyBytes = Buffer.from(options.body, 'utf8');

      let envelope: Record<string, unknown>;

      if (mode === 'public') {
        // Public: plaintext envelope
        envelope = {
          version: 1,
          encryption: 'none',
          contentType: 'text/plain',
          from: agent.address,
          to: toAddress,
          topic: options.topic,
          body: options.body,
          createdAt: new Date().toISOString(),
        };
      } else if (mode === 'group') {
        // Group: encrypted with K_epoch
        const swarmProfile = options.swarm ? await getSwarmProfile(options.swarm) : await getActiveSwarm();
        if (!swarmProfile) throw new Error('No swarm profile found.');
        const { contract } = await getSwarmContractReadonly(options.swarm);
        const currentEpoch = Number(await contract.currentEpoch());
        const epochKey = await readEpochKey(swarmProfile.slug, currentEpoch);
        if (!epochKey) throw new Error(`No local epoch key for swarm ${swarmProfile.slug} epoch ${currentEpoch}. Run \`soulvault epoch decrypt-bundle-member\` to unwrap it first.`);

        const encrypted = encryptWithEpochKey(bodyBytes, epochKey.keyHex, {
          from: agent.address,
          to: toAddress,
          topic: options.topic,
        });

        envelope = {
          version: 1,
          encryption: 'aes-256-gcm',
          contentType: 'text/plain',
          from: agent.address,
          to: toAddress,
          topic: options.topic,
          epoch: currentEpoch,
          ciphertext: encrypted.ciphertext,
          nonce: encrypted.nonce,
          aad: encrypted.aad,
          algorithm: encrypted.algorithm,
          createdAt: new Date().toISOString(),
        };
      } else if (mode === 'dm') {
        // DM: encrypted to recipient's secp256k1 pubkey
        const { contract } = await getSwarmContractReadonly(options.swarm);
        const recipientMember = await contract.getMember(options.to);
        if (!recipientMember.active) throw new Error(`Recipient ${options.to} is not an active swarm member.`);
        const recipientPubkey = recipientMember.pubkey;
        if (!recipientPubkey || recipientPubkey === '0x') throw new Error(`Recipient ${options.to} has no pubkey on the swarm contract.`);

        const encrypted = encryptForRecipientPubkey(bodyBytes, recipientPubkey);

        envelope = {
          version: 1,
          encryption: 'secp256k1-ecdh-aes-256-gcm',
          contentType: 'text/plain',
          from: agent.address,
          to: toAddress,
          topic: options.topic,
          ciphertext: encrypted.ciphertext,
          ephemeralPublicKey: encrypted.ephemeralPublicKey,
          nonce: encrypted.nonce,
          algorithm: encrypted.algorithm,
          createdAt: new Date().toISOString(),
        };
      } else {
        throw new Error(`Unknown mode: ${mode}. Use public, group, or dm.`);
      }

      // Upload envelope to 0G Storage
      const envelopeBytes = Buffer.from(JSON.stringify(envelope, null, 2), 'utf8');
      const payloadHash = keccak256(envelopeBytes);

      console.error(`[msg post] uploading ${mode} message envelope to 0G...`);
      const upload = await uploadJsonTo0G(envelope) as { rootHash?: string; txHash?: string; rootHashes?: string[]; txHashes?: string[] };
      const payloadRef = upload.rootHash ?? upload.rootHashes?.[0];
      if (!payloadRef) throw new Error('0G upload did not return a root hash for the message envelope');
      console.error(`[msg post] uploaded to 0G: ${payloadRef}`);

      // Post message onchain
      const result = await postMessageToSwarm({
        swarm: options.swarm,
        to: toAddress,
        topic: options.topic,
        payloadRef,
        payloadHash,
        ttl: options.ttl ? Number(options.ttl) : undefined,
      });

      console.log(JSON.stringify({
        ...result,
        mode,
        upload: { rootHash: payloadRef, txHash: upload.txHash ?? upload.txHashes?.[0] },
      }, null, 2));
    });

  msg
    .command('list')
    .option('--swarm <nameOrEns>', 'Target swarm')
    .option('--from-block <n>', 'Start block')
    .option('--to-block <n>', 'End block')
    .action(async (options) => {
      const result = await listSwarmMessages({
        swarm: options.swarm,
        fromBlock: options.fromBlock ? Number(options.fromBlock) : undefined,
        toBlock: options.toBlock ? Number(options.toBlock) : undefined,
      });
      console.log(JSON.stringify(result, null, 2));
    });

  msg
    .command('show')
    .requiredOption('--payload-ref <ref>', '0G root hash of the message payload')
    .option('--swarm <nameOrEns>', 'Target swarm (for group decryption)')
    .option('--decrypt', 'Attempt to decrypt the message body', false)
    .action(async (options) => {
      const tempPath = path.join(os.tmpdir(), `soulvault-msg-${Date.now()}.json`);
      await downloadFrom0G(options.payloadRef, tempPath);
      const envelope = await fs.readJson(tempPath);

      let decryptedBody: string | undefined;
      if (options.decrypt && envelope.encryption && envelope.encryption !== 'none') {
        if (envelope.encryption === 'aes-256-gcm' || envelope.algorithm === 'aes-256-gcm') {
          // Group message — decrypt with K_epoch
          const swarmProfile = options.swarm ? await getSwarmProfile(options.swarm) : await getActiveSwarm();
          if (!swarmProfile) throw new Error('No swarm profile found for group decryption. Pass --swarm.');
          const epoch = envelope.epoch ?? 0;
          const epochKey = await readEpochKey(swarmProfile.slug, epoch);
          if (!epochKey) throw new Error(`No local epoch key for swarm ${swarmProfile.slug} epoch ${epoch}.`);
          const plaintext = decryptWithEpochKey(envelope.ciphertext, envelope.nonce, envelope.aad, epochKey.keyHex);
          decryptedBody = plaintext.toString('utf8');
        } else if (envelope.encryption === 'secp256k1-ecdh-aes-256-gcm' || envelope.algorithm === 'secp256k1-ecdh-aes-256-gcm') {
          // DM — decrypt with local private key
          const privateKey = await getSignerPrivateKey();
          const plaintext = decryptWithPrivateKey(envelope.ciphertext, envelope.ephemeralPublicKey, envelope.nonce, privateKey);
          decryptedBody = plaintext.toString('utf8');
        }
      }

      console.log(JSON.stringify({
        payloadRef: options.payloadRef,
        envelope,
        ...(decryptedBody !== undefined ? { decryptedBody } : {}),
      }, null, 2));
    });
}
