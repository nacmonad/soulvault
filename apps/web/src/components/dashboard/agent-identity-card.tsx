'use client';

/**
 * Decoded ERC-8004 identity card — shared by the agents directory and the
 * swarm member rows. Renders whatever the registration agentURI carries
 * (SoulVault shape: packages/node/src/identity.ts) and degrades gracefully:
 * http(s) URIs show as a plain link, missing fields stay hidden.
 */
import { isAddressEqual, type Address } from 'viem';

import { parseAgentUri } from '@/lib/onchain/reducers';
import { shortAddress } from '@/lib/format';
import { CopyableAddress } from '@/components/dashboard/copyable-address';

const AVATAR_SIZE_PX = 40;

export function AgentIdentityCard({
  agentId,
  wallet,
  uri,
  compareWallet,
  swarmName,
}: {
  agentId: bigint;
  wallet: Address;
  uri: string | null;
  /** When set, a memberAddress disagreement renders as a warning. */
  compareWallet?: Address | null;
  /** Resolved ENS name of the swarm the URI's swarmContract points at, when
   * the consumer knows it (org discovery). Unknown contracts stay blank. */
  swarmName?: string | null;
}) {
  const payload = parseAgentUri(uri);
  const name = typeof payload?.name === 'string' && payload.name ? payload.name : null;
  const harness = payload?.soulvault?.harness ?? payload?.harness ?? null;
  const memberAddress = payload?.soulvault?.memberAddress;
  const attributedSwarm = payload?.soulvault?.swarmContract;
  const ensName = typeof payload?.soulvault?.ensName === 'string' && payload.soulvault.ensName ? payload.soulvault.ensName : null;
  const attributionMismatch =
    compareWallet !== undefined &&
    compareWallet !== null &&
    typeof memberAddress === 'string' &&
    /^0x[0-9a-fA-F]{40}$/.test(memberAddress) &&
    !isAddressEqual(memberAddress as Address, compareWallet);

  return (
    <div className="flex flex-wrap items-start gap-3">
      {payload?.image ? <AgentAvatar src={payload.image} name={name} /> : null}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          {name ? <span className="text-sm font-medium">{name}</span> : null}
          <span className="font-mono text-xs text-muted-foreground">#{agentId.toString()}</span>
          {/* Copyable — paste into the EAC delegation panel / CLI --to flags. */}
          <CopyableAddress address={wallet} />
          {harness ? <span className="chip text-xs">{harness}</span> : null}
        </div>
        {/* Canonical title: the agent's own ENS name when the registration
         * carries it, else the public wallet address is already visible above. */}
        {ensName ? (
          <p className="mt-0.5 break-all font-mono text-xs text-foreground">{ensName}</p>
        ) : null}
        {attributedSwarm ? (
          // The URI's own claim — what external ERC-8004 readers resolve.
          <p className="mt-1 text-xs text-muted-foreground">
            swarm: {swarmName ?? shortAddress(attributedSwarm as Address)}{' '}
            <span className="font-mono">{shortAddress(attributedSwarm as Address)}</span>
          </p>
        ) : (
          <p className="mt-1 text-xs text-muted-foreground">no swarm attribution in registration</p>
        )}
        {payload?.description ? (
          <p className="mt-1 text-xs text-muted-foreground">{payload.description}</p>
        ) : null}
        {!payload && uri ? (
          // http(s) or otherwise non-decodable URI — still link it.
          <a
            className="mt-1 block break-all text-xs underline decoration-dotted"
            href={uri}
            target="_blank"
            rel="noreferrer"
          >
            {uri.length > 120 ? `${uri.slice(0, 120)}…` : uri}
          </a>
        ) : null}
        {payload?.services && payload.services.length > 0 ? (
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
            {payload.services.map((service, i) =>
              service?.url ? (
                <a
                  key={i}
                  className="text-xs underline decoration-dotted"
                  href={service.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {service.type ?? 'service'} ↗
                </a>
              ) : null,
            )}
          </div>
        ) : null}
        {payload?.supportedTrust && payload.supportedTrust.length > 0 ? (
          <p className="mt-1 text-xs text-muted-foreground">
            trust: {payload.supportedTrust.join(', ')}
          </p>
        ) : null}
        {attributionMismatch ? (
          <p className="mt-1 text-xs text-amber-600">
            registered memberAddress {shortAddress(memberAddress as Address)} — wallet mismatch
          </p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Avatar from the registration payload's `image` field. Data URIs render
 * inline; http(s) URLs too (next/image would need remote allowlisting for
 * arbitrary agent hosts — a plain img is the honest option here). Broken
 * images hide themselves.
 */
function AgentAvatar({ src, name }: { src: string; name: string | null }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={name ?? 'agent avatar'}
      width={AVATAR_SIZE_PX}
      height={AVATAR_SIZE_PX}
      className="mt-0.5 rounded-full border border-border object-cover"
      onError={(event) => {
        (event.currentTarget as HTMLImageElement).style.display = 'none';
      }}
    />
  );
}
