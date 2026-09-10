This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## DMK challenges and gotchas

The dashboard signs through the Ledger Device Management Kit
(`@ledgerhq/device-management-kit` + `device-signer-kit-ethereum` +
`@ledgerhq/context-module`). Things we learned the hard way:

### The action observable only emits on state-class changes

`signer.signTransaction(...)` (and `signTypedData`, `getAddress`, …) return an
RxJS observable of `DeviceActionState`. During the Ethereum app's
clear-signing walk — the run of "Confirm parameter" / "Verify parameter"
screens — the action's `Pending` state carries an unchanged
`intermediateValue` (`requiredUserInteraction: SignTransaction`, same `step`),
and **DMK only re-emits when the step or the interaction *type* changes**
(`OPEN_APP → BUILD_CONTEXTS → PROVIDE_CONTEXTS → SIGN_TRANSACTION …`).

Consequences:

- **Button presses are invisible to the observable.** A 30-40 screen
  parameter walk produces *zero* emissions while the user is actively
  pressing. Any "no activity for X seconds" timeout armed on the action
  observable will fire mid-walk and cancel a healthy signing session — the
  walk is indistinguishable from a dead device. Our wrapper
  (`src/components/providers/soulvault-ledger-provider.tsx`,
  `runDeviceAction`) switches to an extended ceiling (10 min) while the
  latest state reports `requiredUserInteraction !== None`, and keeps the
  short 120s window for a genuinely quiet device.
- **Timeouts during a long walk are a wrapper bug, not device behavior.** If
  a confirmation times out mid-walk, check for an inactivity timer that is
  never re-armed — not a device problem.
- There is no public per-button-press / device-event stream in DMK 1.9 to
  hook; the walk happens inside one XState actor. Phase tracking via
  `intermediateValue.requiredUserInteraction` is the available signal.

### Related constraints (same stack)

- No CAL descriptors exist for user-deployed SoulVault contracts, so the
  device blind-signs (hash + raw parameter walk). See
  `docs/dashboard-ui/020-deployer-factory-cal.md` for the factory/CAL plan.
- The Ledger channel signs legacy type-0 txs and reconstructs the full
  EIP-155 `v` byte — see `src/lib/ledger-tx.ts` for the details.
- Receipt waits must out-wait congested public mempools
  (`RECEIPT_TIMEOUT_MS`), or late-mining txs report false failures.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
