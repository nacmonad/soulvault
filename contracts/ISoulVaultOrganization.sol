// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ISoulVaultOrganization
/// @notice Org-scoped contract that holds native value, manages a swarm registry,
///         and pays out approved fund requests. One per organization.
/// @dev Replaces ISoulVaultTreasury. The organization is the payout side of the
///      fund-request flow AND the anchor of the Organization → Swarm → Agent hierarchy.
///      Request state lives on SoulVaultSwarm (with membership validation); the
///      organization verifies mutual consent via
///      `ISoulVaultSwarm(swarm).organization() == address(this)` before releasing funds.
interface ISoulVaultOrganization {
    // --- Views ---
    function owner() external view returns (address);
    function balance() external view returns (uint256);

    // --- Swarm registry ---
    function registerSwarm(address swarm) external;
    function removeSwarm(address swarm) external;
    function swarms() external view returns (address[] memory);
    function isSwarm(address swarm) external view returns (bool);
    function swarmCount() external view returns (uint256);

    // --- Org-level pause (Option B: checked flag) ---
    function orgPaused() external view returns (bool);
    function pauseOrg() external;
    function unpauseOrg() external;

    // --- Deposits ---
    function deposit() external payable;

    // --- Approval / rejection (owner-only) ---
    /// @notice Approve a pending fund request on `swarm` and release funds to the requester.
    /// @dev Reverts if the swarm is not registered, mutual consent check fails,
    ///      request is not pending, or balance is insufficient.
    ///      Marks the request APPROVED on the swarm BEFORE transferring value (checks-effects-interactions).
    function approveFundRequest(address swarm, uint256 requestId) external;

    /// @notice Reject a pending fund request on `swarm` without moving funds.
    function rejectFundRequest(address swarm, uint256 requestId, string calldata reason) external;

    // --- Withdrawals (owner-only) ---
    function withdraw(address payable to, uint256 amount) external;

    // --- Events ---
    event FundsDeposited(address indexed from, uint256 amount);
    event FundsReleased(address indexed swarm, uint256 indexed requestId, address indexed recipient, uint256 amount);
    event FundRequestRejectedByOrganization(address indexed swarm, uint256 indexed requestId, string reason);
    event OrganizationWithdrawn(address indexed to, uint256 amount);
    event SwarmRegistered(address indexed swarm, address indexed by);
    event SwarmRemoved(address indexed swarm, address indexed by);
    event OrgPaused(address indexed by);
    event OrgUnpaused(address indexed by);
}
