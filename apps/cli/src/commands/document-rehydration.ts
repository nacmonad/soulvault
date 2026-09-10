import { Command } from 'commander';
import fs from 'fs-extra';
import {
  fetchRehydrationRequests,
  fetchSlotKeyGrants,
  grantSlotKeysOnRegistry,
  loadLocalRehydrationKey,
  rehydrateFromChain,
  requestRehydrationOnRegistry,
} from '@soulvault/node/document-rehydration';
import { resolveRootEnsName } from '@soulvault/node/document-registry-deploy';

export function registerDocumentRehydrationCommands(document: Command) {

  document
    .command('request-rehydrate')
    .description(
      'Recipient side: ask for hydration of a published document. Sends requestRehydration(docHash, pubkey) ' +
        'from the active signer — the tx signature binds msg.sender to the rehydration public key, so the ' +
        'RehydrationRequested event is the wallet-attested key binding (no attestation file needed). The key ' +
        'persists under ~/.soulvault/keys/rehydration-<keyId>.json (0600) and is reused across restarts.',
    )
    .requiredOption('--doc-hash <hash>', '32-byte document hash (the bundle artifact.documentId)')
    .option('--registry <address>', 'DocumentRegistry address (default: ENS discovery on the protocol root name)')
    .option('--root-ens-name <name>', "Protocol root ENS name (defaults to the active organization's ensName, then soluvault.eth)")
    .option('--chain-id <id>', 'Chain the registry is announced for', '11155111')
    .option('--key-id <id>', 'Rehydration key slot (default: "default")', 'default')
    .option('--replace-key', 'Generate a FRESH rehydration key (key-loss recovery only — old grants will not unwrap)', false)
    .action(async (options) => {
      const chainId = Number(options.chainId);
      if (!Number.isInteger(chainId) || chainId <= 0) throw new Error(`Invalid --chain-id: ${options.chainId}`);
      const rootEnsName = options.rootEnsName ?? (await resolveRootEnsName());
      const result = await requestRehydrationOnRegistry({
        docHash: options.docHash,
        keyId: options.keyId,
        replaceKey: options.replaceKey,
        registry: options.registry,
        rootEnsName,
        chainId,
      });
      console.log(JSON.stringify(result, null, 2));
      console.error(
        `[document request-rehydrate] Request mined. The author can now wrap slot keys to ` +
          `${result.rehydrationPublicKey.slice(0, 18)}… — \`soulvault document grant\`.`,
      );
    });

  document
    .command('requests')
    .description(
      'Author side: list pending RehydrationRequested events (who wants hydration, and the public key to wrap to). ' +
        'Read-only — no wallet prompt.',
    )
    .option('--doc-hash <hash>', 'Filter to one document')
    .option('--recipient <address>', 'Filter to one recipient wallet')
    .option('--registry <address>', 'DocumentRegistry address (default: ENS discovery)')
    .option('--root-ens-name <name>', "Protocol root ENS name (defaults to the active organization's ensName)")
    .option('--chain-id <id>', 'Chain the registry is announced for', '11155111')
    .option('--from-block <n>', 'Scan start (default: recent window — public RPCs reject unbounded scans)')
    .option('--json', 'Emit machine-readable JSON (default: human table)', false)
    .action(async (options) => {
      const chainId = Number(options.chainId);
      const fromBlock = options.fromBlock ? Number(options.fromBlock) : undefined;
      const requests = await fetchRehydrationRequests({
        docHash: options.docHash,
        recipient: options.recipient,
        registry: options.registry,
        rootEnsName: options.rootEnsName,
        chainId,
        fromBlock,
      });
      if (options.json) {
        console.log(JSON.stringify(requests, null, 2));
        return;
      }
      if (requests.length === 0) {
        console.error('No RehydrationRequested events found.');
        return;
      }
      for (const r of requests) {
        console.log(`doc ${r.docHash.slice(0, 18)}…  recipient ${r.recipient}  block ${r.blockNumber}`);
        console.log(`  pubkey ${r.rehydrationPublicKey}`);
        console.log(`  tx ${r.txHash}`);
      }
    });

  document
    .command('grants')
    .description(
      'Read SlotKeyGranted events: the permanent capability log (spec §3 — no revoke in v0). ' +
        'Recipients use this to see what they can unwrap; authors use it to audit deliveries.',
    )
    .option('--doc-hash <hash>', 'Filter to one document')
    .option('--recipient <address>', 'Filter to one recipient wallet')
    .option('--slot-id <id>', 'Filter to one slot')
    .option('--registry <address>', 'DocumentRegistry address (default: ENS discovery)')
    .option('--root-ens-name <name>', "Protocol root ENS name (defaults to the active organization's ensName)")
    .option('--chain-id <id>', 'Chain the registry is announced for', '11155111')
    .option('--from-block <n>', 'Scan start (default: recent window)')
    .option('--json', 'Emit machine-readable JSON', false)
    .action(async (options) => {
      const chainId = Number(options.chainId);
      const fromBlock = options.fromBlock ? Number(options.fromBlock) : undefined;
      const grants = await fetchSlotKeyGrants({
        docHash: options.docHash,
        recipient: options.recipient,
        slotId: options.slotId,
        registry: options.registry,
        rootEnsName: options.rootEnsName,
        chainId,
        fromBlock,
      });
      if (options.json) {
        console.log(JSON.stringify(grants, null, 2));
        return;
      }
      if (grants.length === 0) {
        console.error('No SlotKeyGranted events found.');
        return;
      }
      for (const g of grants) {
        console.log(`slot ${g.slotId}  → ${g.recipient}  block ${g.blockNumber}  tx ${g.txHash}`);
      }
    });

  document
    .command('grant')
    .description(
      'Author side: wrap slot keys to the recipient\'s rehydration public key and deliver via grantSlotKey. ' +
        'Reads the recipient\'s latest RehydrationRequested event for the pubkey (onchain request path). ' +
        'Requires the in-session slot keys: pass --session (dashboard sessionStorage export) or --slot-key ' +
        'slotId=hex pairs. One tx per slot — signing costs dominate, keep lists short.',
    )
    .requiredOption('--doc-hash <hash>', '32-byte document hash')
    .requiredOption('--recipient <address>', 'Recipient wallet (the requester)')
    .option('--slot-id <id...>', 'Slot ids to grant (repeatable)')
    .option('--slot-key <pair...>', 'Slot key as slotId=hex (repeatable; use when keys are not in a session file)')
    .option('--session <path>', 'JSON file with {"slotKeys": [{"slotId","key"}…]} — the redact session export')
    .option('--recipient-public-key <hex>', 'Recipient rehydration public key (default: read from their RehydrationRequested event)')
    .option('--registry <address>', 'DocumentRegistry address (default: ENS discovery)')
    .option('--root-ens-name <name>', "Protocol root ENS name (defaults to the active organization's ensName)")
    .option('--chain-id <id>', 'Chain the registry is announced for', '11155111')
    .action(async (options) => {
      const chainId = Number(options.chainId);
      if (!Number.isInteger(chainId) || chainId <= 0) throw new Error(`Invalid --chain-id: ${options.chainId}`);

      const slotKeys: { slotId: string; key: string }[] = [];
      for (const pair of options.slotKey ?? []) {
        const eq = pair.indexOf('=');
        if (eq <= 0) throw new Error(`--slot-key expects slotId=hex, got "${pair}"`);
        slotKeys.push({ slotId: pair.slice(0, eq), key: pair.slice(eq + 1) });
      }
      if (options.session) {
        const session = await fs.readJson(options.session);
        const fromSession = session.slotKeys ?? session;
        if (!Array.isArray(fromSession)) throw new Error('--session file has no slotKeys array');
        for (const entry of fromSession) {
          if (typeof entry?.slotId === 'string' && typeof entry?.key === 'string') slotKeys.push({ slotId: entry.slotId, key: entry.key });
        }
      }
      if (slotKeys.length === 0) throw new Error('No slot keys provided — pass --slot-key pairs or --session <file>');
      const slotIds: string[] = options.slotId?.length ? options.slotId : slotKeys.map((k) => k.slotId);

      const result = await grantSlotKeysOnRegistry({
        docHash: options.docHash,
        slotIds,
        recipient: options.recipient,
        recipientPublicKey: options.recipientPublicKey,
        slotKeys,
        registry: options.registry,
        rootEnsName: options.rootEnsName,
        chainId,
      });
      console.log(JSON.stringify(result, null, 2));
      console.error(
        `[document grant] Delivered ${result.grants.length} slot key(s) to ${result.recipient}. ` +
          `Permanent capability (no revoke in v0) — recipients rehydrate with \`soulvault document rehydrate --bundle <file>\`.`,
      );
    });

  document
    .command('rehydrate')
    .description(
      'Recipient side: rehydrate a public document bundle from onchain grants. Pulls SlotKeyGranted events ' +
        'for the active signer, unwraps with the local rehydration key, and substitutes granted slots — ' +
        'ungranted slots keep their {{sv:…}} markers (partial rehydration by design).',
    )
    .requiredOption('--bundle <path>', 'Public document bundle JSON file (the *.soulvault-*.json artifact)')
    .option('--doc-hash <hash>', 'Filter grants to one document (default: any)')
    .option('--recipient <address>', 'Recipient wallet (default: active signer address)')
    .option('--registry <address>', 'DocumentRegistry address (default: ENS discovery)')
    .option('--root-ens-name <name>', "Protocol root ENS name (defaults to the active organization's ensName)")
    .option('--chain-id <id>', 'Chain the registry is announced for', '11155111')
    .option('--key-id <id>', 'Rehydration key slot (default: "default")', 'default')
    .option('--from-block <n>', 'Scan start for grant events (default: recent window)')
    .option('--json', 'Emit the full rehydration result as JSON', false)
    .action(async (options) => {
      const chainId = Number(options.chainId);
      const bundlePath = options.bundle;
      if (!(await fs.pathExists(bundlePath))) throw new Error(`Bundle file not found: ${bundlePath}`);
      const raw = await fs.readFile(bundlePath, 'utf8');
      const key = await loadLocalRehydrationKey(options.keyId);
      console.error(`[document rehydrate] Rehydration key ${key.keyId} fingerprint ${key.fingerprint.slice(0, 16)}…`);

      const result = await rehydrateFromChain({
        bundle: raw,
        docHash: options.docHash,
        recipient: options.recipient,
        keyId: options.keyId,
        registry: options.registry,
        rootEnsName: options.rootEnsName,
        chainId,
        fromBlock: options.fromBlock ? Number(options.fromBlock) : undefined,
      });
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.error(`[document rehydrate] Grants applied: ${result.grantedSlotIds.join(', ')}`);
        console.log(result.document);
      }
    });

  document
    .command('rehydration-key')
    .description('Print the local rehydration public key + fingerprint (safe to share — this is what authors wrap to).')
    .option('--key-id <id>', 'Rehydration key slot (default: "default")', 'default')
    .option('--replace-key', 'Generate a fresh key (key-loss recovery)', false)
    .option('--json', 'Emit machine-readable JSON', false)
    .action(async (options) => {
      const key = await loadLocalRehydrationKey(options.keyId, options.replaceKey);
      if (options.json) {
        console.log(JSON.stringify({ keyId: key.keyId, publicKey: key.publicKey, fingerprint: key.fingerprint }, null, 2));
      } else {
        console.log(`keyId       ${key.keyId}`);
        console.log(`publicKey   ${key.publicKey}`);
        console.log(`fingerprint ${key.fingerprint}`);
      }
    });
}
