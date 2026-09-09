"use client";

import { useState } from "react";
import { type Address } from "viem";

import { explorerAddressUrl, shortAddress } from "@/lib/format";

/**
 * Shortened address that copies the full value on click, with an explorer
 * link when the chain has one. Used anywhere a contract address is listed
 * (treasuries, swarms) so it can be funded / shared from the dashboard.
 */
export function CopyableAddress({
  address,
  chainId,
  className,
}: {
  address: Address | string;
  chainId?: number | null;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const explorer = explorerAddressUrl(address, chainId ?? undefined);
  return (
    <span className={`inline-flex items-center gap-1.5 ${className ?? ""}`}>
      <button
        type="button"
        title="Copy address"
        className="font-mono text-sm hover:underline"
        onClick={() => {
          void navigator.clipboard.writeText(address);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }}
      >
        {shortAddress(address)}
      </button>
      {explorer ? (
        <a
          href={explorer}
          target="_blank"
          rel="noreferrer"
          title="View on explorer"
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          ↗
        </a>
      ) : null}
      {copied ? <span className="text-xs text-muted-foreground">copied</span> : null}
    </span>
  );
}
