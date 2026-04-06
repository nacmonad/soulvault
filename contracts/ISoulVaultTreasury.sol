// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ISoulVaultTreasury
/// @notice Org-scoped treasury that holds native value and pays out approved fund requests.
/// @dev The treasury is the payout side of the fund-request flow. Request state lives on
///      SoulVaultSwarm (with membership validation); the treasury verifies mutual consent
///      via `ISoulVaultSwarm(swarm).treasury() == address(this)` before releasing funds.
interface ISoulVaultTreasury {
    // --- Views ---
    function owner() external view returns (address);
    function balance() external view returns (uint256);

    // --- Deposits ---
    function deposit() external payable;

    // --- Approval / rejection (owner-only) ---
    /// @notice Approve a pending fund request on `swarm` and release funds to the requester.
    /// @dev Reverts if mutual consent check fails, request is not pending, or balance is insufficient.
    ///      Marks the request APPROVED on the swarm BEFORE transferring value (checks-effects-interactions).
    function approveFundRequest(address swarm, uint256 requestId) external;

    /// @notice Reject a pending fund request on `swarm` without moving funds.
    function rejectFundRequest(address swarm, uint256 requestId, string calldata reason) external;

    // --- Withdrawals (owner-only) ---
    function withdraw(address payable to, uint256 amount) external;

    // --- Events ---
    event FundsDeposited(address indexed from, uint256 amount);
    event FundsReleased(address indexed swarm, uint256 indexed requestId, address indexed recipient, uint256 amount);
    event FundRequestRejectedByTreasury(address indexed swarm, uint256 indexed requestId, string reason);
    event TreasuryWithdrawn(address indexed to, uint256 amount);
}
