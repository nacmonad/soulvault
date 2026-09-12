"use client";

import { useEffect, useState } from "react";
import type { PublicDocumentBundle } from "@soulvault/protocol";

import {
  documentRegistryAddress,
  resolveDocumentRegistryAddress,
  type DocumentRegistrySource,
} from "@/lib/document-registry";
import { useSoulVaultWallet } from "@/components/providers/soulvault-ledger-provider";
import type { Address } from "viem";

/**
 * Resolves the DocumentRegistry address through the full discovery chain
 * (override → ENS → bundle hint). Seeds state with the sync fast path
 * (override) so render does not flash empty while ENS resolves.
 */
export function useDocumentRegistryAddress(
  bundle?: PublicDocumentBundle | null,
): { address: Address | null; source: DocumentRegistrySource } {
  const { address: viewer } = useSoulVaultWallet();
  const [result, setResult] = useState<{ address: Address | null; source: DocumentRegistrySource }>(
    () => ({ address: documentRegistryAddress(), source: null }),
  );

  useEffect(() => {
    let cancelled = false;
    resolveDocumentRegistryAddress({ bundleHint: bundle?.registry ?? null, viewer: viewer ?? undefined })
      .then((resolved) => {
        if (cancelled) return;
        setResult(resolved);
      })
      .catch(() => {
        // keep the sync fast path on unexpected failure
      });
    return () => {
      cancelled = true;
    };
  }, [bundle, viewer]);

  return result;
}
