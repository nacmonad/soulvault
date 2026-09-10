import { Command } from 'commander';
import fs from 'fs-extra';
import {
  announceDocumentRegistryOnEns,
  deployDocumentRegistryContract,
  resolveRootEnsName,
} from '@soulvault/node/document-registry-deploy';
import {
  DEFAULT_DOCUMENT_REGISTRY_CHAIN_ID,
  publishDocumentOnRegistry,
  publishTargetFromBundle,
} from '@soulvault/node/document-registry';

export function registerDocumentCommands(program: Command) {
  const document = program
    .command('document')
    .description('Document registry operations (redact/grant/rehydrate lane)');

  document
    .command('deploy-registry')
    .description(
      'Deploy the SoulVaultDocumentRegistry singleton on the identity lane (Sepolia) and ' +
        'announce it on the protocol root ENS name: ENSIP-11 addr(root, coinType(chainId)) ' +
        'plus a soulvault.documentRegistry text record carrying the deploy block. The signer ' +
        'must own the root ENS name.',
    )
    .option(
      '--root-ens-name <name>',
      "Protocol root ENS name that announces the registry (defaults to the active organization's ensName, then soluvault.eth)",
    )
    .option('--chain-id <id>', 'Chain the registry is announced for (ENSIP-11 coinType derived)', '11155111')
    .option('--skip-ens', 'Deploy only; skip the ENS announce step', false)
    .action(async (options) => {
      const chainId = Number(options.chainId);
      if (!Number.isInteger(chainId) || chainId <= 0) {
        throw new Error(`Invalid --chain-id: ${options.chainId}`);
      }

      const rootEnsName = options.rootEnsName ?? (await resolveRootEnsName());
      console.error(`[document deploy-registry] Root ENS name: ${rootEnsName}`);

      const deployment = await deployDocumentRegistryContract();
      console.log(
        JSON.stringify(
          {
            registry: deployment.address,
            owner: deployment.ownerAddress,
            txHash: deployment.txHash,
            blockNumber: deployment.blockNumber,
          },
          null,
          2,
        ),
      );

      if (options.skipEns) {
        console.error('[document deploy-registry] --skip-ens set: ENS announce skipped.');
      } else {
        const announce = await announceDocumentRegistryOnEns({
          rootEnsName,
          chainId,
          address: deployment.address,
          deployedAtBlock: deployment.blockNumber,
        });
        console.error(
          `[document deploy-registry] ENS announce: addr(coinType ${announce.coinType}) tx=${announce.addrTxHash} ` +
            `text tx=${announce.textTxHash}`,
        );
      }

      // Dashboard fallback when ENS discovery is unavailable (build-time env).
      const snippet = JSON.stringify(
        [
          {
            kind: 'document',
            address: deployment.address,
            fromBlock: String(deployment.blockNumber ?? 0),
            label: 'document-registry',
          },
        ],
        null,
        2,
      );
      console.error(
        `[document deploy-registry] Optional env fallback for the dashboard:\n` +
          `NEXT_PUBLIC_SOULVAULT_DEPLOYMENTS='${snippet.replace(/'/g, `'\\''`)}'`,
      );
      console.error(
        `[document deploy-registry] Dashboard panels and external consumers track ` +
          `DocumentPublished/SlotKeyGranted via this registry's events.`,
      );
    });

  document
    .command('publish')
    .description(
      'Anchor a redacted document on the DocumentRegistry: publishDocument(docHash, slotIds) ' +
        'emits DocumentPublished — the integrity anchor and grant-authority anchor. The ' +
        'document itself never touches the chain. Recovery path for the dashboard redact ' +
        'page (same registry resolution: ENSIP-11 addr on the protocol root name).',
    )
    .option('--doc-hash <hash>', '32-byte document hash (the bundle artifact.documentId)')
    .option('--slot-id <id...>', 'Slot ids to publish (repeatable)')
    .option(
      '--bundle <path>',
      'Public document bundle JSON file — derives --doc-hash and --slot-id from artifact (overrides individual flags)',
    )
    .option('--registry <address>', 'DocumentRegistry address (default: ENS discovery on the protocol root name)')
    .option('--root-ens-name <name>', "Protocol root ENS name (defaults to the active organization's ensName, then soluvault.eth)")
    .option('--chain-id <id>', 'Chain the registry is announced for (ENSIP-11 coinType derived)', String(DEFAULT_DOCUMENT_REGISTRY_CHAIN_ID))
    .action(async (options) => {
      const chainId = Number(options.chainId);
      if (!Number.isInteger(chainId) || chainId <= 0) {
        throw new Error(`Invalid --chain-id: ${options.chainId}`);
      }

      let docHash = options.docHash;
      let slotIds: string[] = options.slotId ?? [];
      if (options.bundle) {
        const bundle = await fs.readJson(options.bundle);
        const target = publishTargetFromBundle(bundle);
        docHash = target.docHash;
        slotIds = target.slotIds;
        console.error(
          `[document publish] Bundle ${options.bundle}: ${slotIds.length} slots, docHash ${docHash.slice(0, 18)}…`,
        );
      }

      const result = await publishDocumentOnRegistry({
        docHash,
        slotIds,
        registry: options.registry,
        rootEnsName: options.rootEnsName,
        chainId,
      });
      console.log(JSON.stringify(result, null, 2));
      console.error(
        `[document publish] Anchored on ${result.registry} — consumers listen for ` +
          `DocumentPublished(docHash, author, slotIds) to discover this document.`,
      );
    });

  document
    .command('announce-registry')
    .description(
      'Announce an ALREADY-DEPLOYED SoulVaultDocumentRegistry on the protocol root ENS name ' +
        '(ENSIP-11 addr + soulvault.documentRegistry text record). Recovery path for the ' +
        'dashboard wizard when the deploy tx landed but a later step failed - no second ' +
        'deploy, no wasted gas. The signer must own the root ENS name.',
    )
    .requiredOption('--address <address>', 'Deployed SoulVaultDocumentRegistry address')
    .option('--root-ens-name <name>', "Protocol root ENS name (defaults to the active organization's ensName, then soluvault.eth)")
    .option('--chain-id <id>', 'Chain the registry is announced for (ENSIP-11 coinType derived)', '11155111')
    .option('--deployed-at-tx <hash>', 'Deploy tx hash - its receipt supplies the scan-start block')
    .option('--deployed-at-block <block>', 'Deploy block number (alternative to --deployed-at-tx)')
    .action(async (options) => {
      const chainId = Number(options.chainId);
      if (!Number.isInteger(chainId) || chainId <= 0) {
        throw new Error(`Invalid --chain-id: ${options.chainId}`);
      }
      const deployedAtBlock = options.deployedAtBlock ? Number(options.deployedAtBlock) : undefined;
      if (deployedAtBlock !== undefined && (!Number.isInteger(deployedAtBlock) || deployedAtBlock < 0)) {
        throw new Error(`Invalid --deployed-at-block: ${options.deployedAtBlock}`);
      }

      const rootEnsName = options.rootEnsName ?? (await resolveRootEnsName());
      console.error(`[document announce-registry] Root ENS name: ${rootEnsName}`);
      const announce = await announceDocumentRegistryOnEns({
        rootEnsName,
        chainId,
        address: options.address,
        deployedAtBlock,
        deployedAtTxHash: options.deployedAtTx,
      });
      console.log(
        JSON.stringify(
          {
            rootEnsName,
            coinType: announce.coinType,
            registryAddress: announce.registryAddress,
            addrTxHash: announce.addrTxHash,
            textTxHash: announce.textTxHash,
            textRecord: announce.textRecord,
          },
          null,
          2,
        ),
      );
      console.error(
        `[document announce-registry] Dashboard discovery now resolves the registry via ` +
          `addr(${rootEnsName}, coinType ${announce.coinType}).`,
      );
    });
}
