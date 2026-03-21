# Treasury + Autonomous VPS Expansion (USDC)

## Yes, this is viable — with guardrails
A swarm contract can hold USDC treasury and authorize controlled spending.

## Recommended Model
Use a Safe (multisig) as treasury owner + a Swarm module/guard:
- Contract manages governance + intent
- Safe executes token transfers with policy checks

## Why not direct arbitrary agent spending?
- High risk of key compromise or runaway automation
- Hard to constrain per-action risk in pure autonomous mode

## Safer Flow
1. Agent proposes `ScaleOutAction` (need N new nodes, budget, provider quote hash)
2. Quorum approves proposal
3. Execution module allows only:
   - allowlisted recipients (infra vendors)
   - allowlisted function selectors
   - per-epoch spend caps
4. Event emitted for audit trail
5. New nodes must still pass join flow (cannot auto-trust)

## Spending Policies
- Daily/weekly USDC cap
- Max per node budget
- Vendor allowlist
- Cooldown between expansion actions
- Emergency pause by owner/quorum

## Hackathon Scope Advice
For 48h:
- Implement **simulated treasury policy** in docs + events
- Optional: demo testnet USDC transfer through Safe after one approval
- Defer full autonomous purchasing integration to post-MVP
