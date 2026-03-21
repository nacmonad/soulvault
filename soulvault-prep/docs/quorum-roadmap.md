# Quorum Roadmap (How it eventually works)

## MVP (Owner-Gated)
- Owner approves all joins
- Owner updates backup pointers
- Fastest/lowest-risk path for hackathon demo

## Phase 2 (Hybrid Governance)
- Define role set:
  - Owner
  - Agent members
  - Optional operator role
- Join approvals require:
  - owner OR
  - M-of-N active agents + owner confirmation

## Phase 3 (Full Quorum Joins)
- Join request creates proposal object onchain
- Eligible voters (active agents + optional owner) cast votes
- Contract auto-executes approval when threshold met

## Suggested Onchain Structures
- `JoinProposal { requester, pubKey, metadataCid, yesVotes, deadline, executed }`
- `mapping(proposalId => mapping(voter => bool)) hasVoted`
- `quorumNumerator`, `quorumDenominator`, `minVoters`

## Recommended Constraints
- Proposal TTL/expiry
- Anti-spam join request stake or cooldown
- Emergency owner veto/pause
- Membership cap (optional)

## Offchain Crypto Add-On (Admission Tickets)
Instead of placing large payload logic onchain:
- Existing agents sign EIP-712 admission ticket
- Requester submits ticket bundle
- Contract verifies signatures and threshold

This keeps gas and complexity lower while preserving quorum semantics.
