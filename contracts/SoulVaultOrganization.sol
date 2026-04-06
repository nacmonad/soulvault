// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ISoulVaultOrganization} from "./ISoulVaultOrganization.sol";
import {ISoulVaultSwarm} from "./ISoulVaultSwarm.sol";

/// @title SoulVaultOrganization
/// @notice Org-scoped contract. One per organization. Deployer is immutable owner.
///         Manages a swarm registry, holds native funds, and processes fund-request payouts.
/// @dev Mutual-consent authorization: the organization checks both `isSwarm(swarm)` and
///      `ISoulVaultSwarm(swarm).organization() == address(this)` before acting on a swarm.
///      The org-level pause flag is readable by swarms to halt all operations across the org.
contract SoulVaultOrganization is ISoulVaultOrganization {
    error NotOwner();
    error SwarmNotRegistered();
    error SwarmOrganizationMismatch();
    error SwarmAlreadyRegistered();
    error InvalidFundRequest();
    error InvalidRequestState();
    error InsufficientBalance();
    error TransferFailed();
    error ZeroAddress();
    error Reentrant();
    error OrgIsPaused();

    uint8 private constant STATUS_PENDING = 0;

    address public immutable override owner;

    bool public override orgPaused;

    uint256 private _locked = 1;

    mapping(address => bool) private _isSwarm;
    address[] private _swarms;

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

    modifier whenOrgNotPaused() {
        if (orgPaused) revert OrgIsPaused();
        _;
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

    // --- Swarm registry ---

    function registerSwarm(address swarm) external override onlyOwner {
        if (swarm == address(0)) revert ZeroAddress();
        if (_isSwarm[swarm]) revert SwarmAlreadyRegistered();
        _isSwarm[swarm] = true;
        _swarms.push(swarm);
        emit SwarmRegistered(swarm, msg.sender);
    }

    function removeSwarm(address swarm) external override onlyOwner {
        if (!_isSwarm[swarm]) revert SwarmNotRegistered();
        _isSwarm[swarm] = false;
        uint256 len = _swarms.length;
        for (uint256 i = 0; i < len; i++) {
            if (_swarms[i] == swarm) {
                _swarms[i] = _swarms[len - 1];
                _swarms.pop();
                break;
            }
        }
        emit SwarmRemoved(swarm, msg.sender);
    }

    function swarms() external view override returns (address[] memory) {
        return _swarms;
    }

    function isSwarm(address swarm) external view override returns (bool) {
        return _isSwarm[swarm];
    }

    function swarmCount() external view override returns (uint256) {
        return _swarms.length;
    }

    // --- Org-level pause ---

    function pauseOrg() external override onlyOwner {
        orgPaused = true;
        emit OrgPaused(msg.sender);
    }

    function unpauseOrg() external override onlyOwner {
        orgPaused = false;
        emit OrgUnpaused(msg.sender);
    }

    // --- Approval / rejection (owner-only) ---

    function approveFundRequest(address swarm, uint256 requestId)
        external
        override
        onlyOwner
        whenOrgNotPaused
        nonReentrant
    {
        if (!_isSwarm[swarm]) revert SwarmNotRegistered();
        if (ISoulVaultSwarm(swarm).organization() != address(this)) revert SwarmOrganizationMismatch();

        ISoulVaultSwarm.FundRequest memory req = ISoulVaultSwarm(swarm).getFundRequest(requestId);
        if (req.requester == address(0)) revert InvalidFundRequest();
        if (req.status != STATUS_PENDING) revert InvalidRequestState();
        if (address(this).balance < req.amount) revert InsufficientBalance();

        ISoulVaultSwarm(swarm).markFundRequestApproved(requestId);

        (bool ok, ) = payable(req.requester).call{value: req.amount}("");
        if (!ok) revert TransferFailed();

        emit FundsReleased(swarm, requestId, req.requester, req.amount);
    }

    function rejectFundRequest(address swarm, uint256 requestId, string calldata reason)
        external
        override
        onlyOwner
        whenOrgNotPaused
    {
        if (!_isSwarm[swarm]) revert SwarmNotRegistered();
        if (ISoulVaultSwarm(swarm).organization() != address(this)) revert SwarmOrganizationMismatch();
        ISoulVaultSwarm(swarm).markFundRequestRejected(requestId, reason);
        emit FundRequestRejectedByOrganization(swarm, requestId, reason);
    }

    // --- Withdrawals ---

    function withdraw(address payable to, uint256 amount) external override onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        if (address(this).balance < amount) revert InsufficientBalance();
        (bool ok, ) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit OrganizationWithdrawn(to, amount);
    }
}
