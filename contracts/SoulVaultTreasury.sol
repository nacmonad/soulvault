// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ISoulVaultTreasury} from "./ISoulVaultTreasury.sol";
import {ISoulVaultSwarm} from "./ISoulVaultSwarm.sol";

/// @title SoulVaultTreasury
/// @notice Org-scoped treasury contract. One per organization. Deployer is immutable owner.
/// @dev Mutual-consent authorization: the treasury trusts
///      `ISoulVaultSwarm(swarm).treasury() == address(this)` as the authoritative gate for
///      which swarms it backs. No on-chain registered-swarm set — the owner's approval
///      signature is the explicit per-request opt-in.
contract SoulVaultTreasury is ISoulVaultTreasury {
    error NotOwner();
    error SwarmTreasuryMismatch();
    error InvalidFundRequest();
    error InvalidRequestState();
    error InsufficientBalance();
    error TransferFailed();
    error ZeroAddress();
    error Reentrant();

    uint8 private constant STATUS_PENDING = 0;

    address public immutable override owner;

    uint256 private _locked = 1;

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier nonReentrant() {
        if (_locked != 1) revert Reentrant();
        _locked = 2;
        _;
        _locked = 1;
    }

    constructor() {
        owner = msg.sender;
    }

    // --- Deposits ---

    receive() external payable {
        emit FundsDeposited(msg.sender, msg.value);
    }

    function deposit() external payable override {
        emit FundsDeposited(msg.sender, msg.value);
    }

    // --- Views ---

    function balance() external view override returns (uint256) {
        return address(this).balance;
    }

    // --- Approval / rejection (owner-only) ---

    function approveFundRequest(address swarm, uint256 requestId)
        external
        override
        onlyOwner
        nonReentrant
    {
        // 1. Mutual consent — the swarm must have opted in to this treasury.
        if (ISoulVaultSwarm(swarm).treasury() != address(this)) revert SwarmTreasuryMismatch();

        // 2. Read the request from the swarm (authoritative source of truth).
        ISoulVaultSwarm.FundRequest memory req = ISoulVaultSwarm(swarm).getFundRequest(requestId);
        if (req.requester == address(0)) revert InvalidFundRequest();
        if (req.status != STATUS_PENDING) revert InvalidRequestState();
        if (address(this).balance < req.amount) revert InsufficientBalance();

        // 3. Effects: mark the swarm-side status APPROVED BEFORE moving value.
        //    Checks-effects-interactions. Any reentry hits InvalidRequestState on the
        //    swarm's status guard. The swarm call is to a trusted contract (mutual
        //    consent was verified above) and does not call back into the treasury.
        ISoulVaultSwarm(swarm).markFundRequestApproved(requestId);

        // 4. Interaction: pay the requester.
        (bool ok, ) = payable(req.requester).call{value: req.amount}("");
        if (!ok) revert TransferFailed();

        emit FundsReleased(swarm, requestId, req.requester, req.amount);
    }

    function rejectFundRequest(address swarm, uint256 requestId, string calldata reason)
        external
        override
        onlyOwner
    {
        if (ISoulVaultSwarm(swarm).treasury() != address(this)) revert SwarmTreasuryMismatch();
        ISoulVaultSwarm(swarm).markFundRequestRejected(requestId, reason);
        emit FundRequestRejectedByTreasury(swarm, requestId, reason);
    }

    // --- Withdrawals ---

    function withdraw(address payable to, uint256 amount) external override onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        if (address(this).balance < amount) revert InsufficientBalance();
        (bool ok, ) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit TreasuryWithdrawn(to, amount);
    }
}
