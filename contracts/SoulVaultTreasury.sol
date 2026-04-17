// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ISoulVaultTreasury} from "./ISoulVaultTreasury.sol";
import {ISoulVaultSwarm} from "./ISoulVaultSwarm.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @title SoulVaultTreasury
/// @notice Org-scoped treasury contract. One per organization. Deployer is immutable owner.
/// @dev Two authorization paths:
///      1. `msg.sender == owner` (EOA direct, backwards compatible)
///      2. EIP-712 signature by `owner` submitted by anyone (`*WithSig` variants).
///         This is the "Ledger signs an intent, any EOA submits it" model documented in
///         `docs/clear-signing-spec.md`. Replay protection = monotonic `nonces[owner]` + deadline.
contract SoulVaultTreasury is ISoulVaultTreasury, EIP712 {
    error NotOwner();
    error SwarmTreasuryMismatch();
    error InvalidFundRequest();
    error InvalidRequestState();
    error InsufficientBalance();
    error TransferFailed();
    error ZeroAddress();
    error Reentrant();
    error SigExpired();
    error BadNonce(uint64 expected, uint64 provided);
    error BadSigner(address recovered);

    uint8 private constant STATUS_PENDING = 0;

    /// @dev Typehashes must exactly match the struct strings in `cli/src/lib/typed-data.ts`.
    bytes32 private constant APPROVE_FUND_REQUEST_TYPEHASH = keccak256(
        "ApproveFundRequest(address swarm,uint256 requestId,uint256 amount,address recipient,uint64 nonce,uint64 deadline)"
    );
    bytes32 private constant REJECT_FUND_REQUEST_TYPEHASH = keccak256(
        "RejectFundRequest(address swarm,uint256 requestId,bytes32 reasonHash,uint64 nonce,uint64 deadline)"
    );
    bytes32 private constant TREASURY_WITHDRAW_TYPEHASH = keccak256(
        "TreasuryWithdraw(address treasury,address recipient,uint256 amount,uint64 nonce,uint64 deadline)"
    );

    address public immutable override owner;

    /// @notice Monotonic nonce, incremented by each accepted `*WithSig` call.
    uint64 public ownerNonce;

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

    constructor() EIP712("SoulVaultTreasury", "1") {
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

    /// @notice Expose the EIP-712 domain separator so clients can sanity-check it matches.
    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    // --- EOA-direct path (owner calls) ---

    function approveFundRequest(address swarm, uint256 requestId)
        external
        override
        onlyOwner
        nonReentrant
    {
        _approveFundRequest(swarm, requestId);
    }

    function rejectFundRequest(address swarm, uint256 requestId, string calldata reason)
        external
        override
        onlyOwner
    {
        _rejectFundRequest(swarm, requestId, reason);
    }

    function withdraw(address payable to, uint256 amount) external override onlyOwner nonReentrant {
        _withdraw(to, amount);
    }

    // --- Signed-intent path (owner signs, any EOA submits) ---

    /// @notice Approve a fund request via an EIP-712 signature from the owner.
    /// @param amount Expected amount (must equal request.amount).
    /// @param recipient Expected recipient (must equal request.requester).
    /// @param nonce Must equal current `ownerNonce`.
    /// @param deadline Unix seconds; must be >= block.timestamp.
    /// @param sig 65-byte secp256k1 signature from `owner`.
    function approveFundRequestWithSig(
        address swarm,
        uint256 requestId,
        uint256 amount,
        address recipient,
        uint64 nonce,
        uint64 deadline,
        bytes calldata sig
    ) external nonReentrant {
        _checkSig(
            keccak256(abi.encode(
                APPROVE_FUND_REQUEST_TYPEHASH,
                swarm, requestId, amount, recipient, nonce, deadline
            )),
            nonce,
            deadline,
            sig
        );
        // Bind signed amount/recipient to actual request to prevent stale sigs
        // approving after request param changes.
        ISoulVaultSwarm.FundRequest memory req = ISoulVaultSwarm(swarm).getFundRequest(requestId);
        if (req.amount != amount) revert InvalidFundRequest();
        if (req.requester != recipient) revert InvalidFundRequest();
        _approveFundRequest(swarm, requestId);
    }

    function rejectFundRequestWithSig(
        address swarm,
        uint256 requestId,
        string calldata reason,
        uint64 nonce,
        uint64 deadline,
        bytes calldata sig
    ) external {
        _checkSig(
            keccak256(abi.encode(
                REJECT_FUND_REQUEST_TYPEHASH,
                swarm, requestId, keccak256(bytes(reason)), nonce, deadline
            )),
            nonce,
            deadline,
            sig
        );
        _rejectFundRequest(swarm, requestId, reason);
    }

    function withdrawWithSig(
        address payable to,
        uint256 amount,
        uint64 nonce,
        uint64 deadline,
        bytes calldata sig
    ) external nonReentrant {
        _checkSig(
            keccak256(abi.encode(
                TREASURY_WITHDRAW_TYPEHASH,
                address(this), to, amount, nonce, deadline
            )),
            nonce,
            deadline,
            sig
        );
        _withdraw(to, amount);
    }

    // --- Internal core logic ---

    function _approveFundRequest(address swarm, uint256 requestId) internal {
        if (ISoulVaultSwarm(swarm).treasury() != address(this)) revert SwarmTreasuryMismatch();
        ISoulVaultSwarm.FundRequest memory req = ISoulVaultSwarm(swarm).getFundRequest(requestId);
        if (req.requester == address(0)) revert InvalidFundRequest();
        if (req.status != STATUS_PENDING) revert InvalidRequestState();
        if (address(this).balance < req.amount) revert InsufficientBalance();
        ISoulVaultSwarm(swarm).markFundRequestApproved(requestId);
        (bool ok, ) = payable(req.requester).call{value: req.amount}("");
        if (!ok) revert TransferFailed();
        emit FundsReleased(swarm, requestId, req.requester, req.amount);
    }

    function _rejectFundRequest(address swarm, uint256 requestId, string calldata reason) internal {
        if (ISoulVaultSwarm(swarm).treasury() != address(this)) revert SwarmTreasuryMismatch();
        ISoulVaultSwarm(swarm).markFundRequestRejected(requestId, reason);
        emit FundRequestRejectedByTreasury(swarm, requestId, reason);
    }

    function _withdraw(address payable to, uint256 amount) internal {
        if (to == address(0)) revert ZeroAddress();
        if (address(this).balance < amount) revert InsufficientBalance();
        (bool ok, ) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit TreasuryWithdrawn(to, amount);
    }

    /// @dev Verify EIP-712 signature, check nonce + deadline, then consume nonce.
    function _checkSig(bytes32 structHash, uint64 nonce, uint64 deadline, bytes calldata sig) internal {
        if (block.timestamp > deadline) revert SigExpired();
        if (nonce != ownerNonce) revert BadNonce(ownerNonce, nonce);
        bytes32 digest = _hashTypedDataV4(structHash);
        address recovered = ECDSA.recover(digest, sig);
        if (recovered != owner) revert BadSigner(recovered);
        unchecked { ownerNonce = nonce + 1; }
    }
}
