// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ISoulVaultSwarm} from "./ISoulVaultSwarm.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

contract SoulVaultSwarm is ISoulVaultSwarm, EIP712 {
    error NotOwner();
    error PausedError();
    error AlreadyActiveMember();
    error NotActiveMember();
    error InvalidPubkey();
    error InvalidRequest();
    error InvalidRequestState();
    error NotRequester();
    error MembershipChanged();
    error InvalidEpoch();
    error EmptyReference();
    error InvalidRange();
    error InvalidSequence();
    error UnauthorizedPublisher();
    error NotTreasury();
    error TreasuryNotSet();
    error InvalidFundRequest();
    error InvalidFundRequestState();
    error NotFundRequester();
    error ZeroAmount();
    error ZeroAddress();
    error SigExpired();
    error BadNonce(uint64 expected, uint64 provided);
    error BadSigner(address recovered);

    uint8 private constant STATUS_PENDING = 0;
    uint8 private constant STATUS_APPROVED = 1;
    uint8 private constant STATUS_REJECTED = 2;
    uint8 private constant STATUS_CANCELLED = 3;

    address public immutable override owner;
    bool public override paused;
    uint64 public override currentEpoch;
    uint64 public override membershipVersion;
    uint256 public override memberCount;

    address public override treasury;

    uint256 private _nextRequestId = 1;
    uint256 private _nextFundRequestId = 1;

    struct ManifestPointer {
        string manifestRef;
        bytes32 manifestHash;
    }

    mapping(address => Member) private _members;
    mapping(uint256 => JoinRequest) private _joinRequests;
    mapping(uint256 => FundRequest) private _fundRequests;
    mapping(address => MemberFileMapping) private _memberFileMappings;
    mapping(address => ManifestPointer) private _agentManifests;
    mapping(address => uint64) private _lastSenderSeq;

    /// @notice Monotonic nonce consumed by every accepted owner `*WithSig` call.
    uint64 public ownerNonce;

    // --- EIP-712 typehashes (must match cli/src/lib/typed-data.ts) ---
    bytes32 private constant APPROVE_JOIN_TYPEHASH =
        keccak256("ApproveJoin(address swarm,uint256 requestId,address requester,uint64 nonce,uint64 deadline)");
    bytes32 private constant REJECT_JOIN_TYPEHASH =
        keccak256("RejectJoin(address swarm,uint256 requestId,address requester,bytes32 reasonHash,uint64 nonce,uint64 deadline)");
    bytes32 private constant REMOVE_MEMBER_TYPEHASH =
        keccak256("RemoveMember(address swarm,address member,uint64 nonce,uint64 deadline)");
    bytes32 private constant SET_TREASURY_TYPEHASH =
        keccak256("SetTreasury(address swarm,address treasury,uint64 nonce,uint64 deadline)");
    bytes32 private constant ROTATE_EPOCH_TYPEHASH =
        keccak256("RotateEpoch(address swarm,uint64 fromEpoch,uint64 toEpoch,bytes32 bundleManifestHash,uint64 nonce,uint64 deadline)");
    bytes32 private constant BACKUP_REQUEST_TYPEHASH =
        keccak256("BackupRequest(address swarm,uint64 epoch,bytes32 trigger,uint64 nonce,uint64 deadline)");

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert PausedError();
        _;
    }

    /// @notice Deploy a SoulVaultSwarm.
    /// @param initialTreasury Address of a `SoulVaultTreasury` on the same chain, or `address(0)`
    ///        for a stealth swarm that never funds agents through the treasury flow. `address(0)`
    ///        is a fully supported value; the deployer (or the swarm owner later) may bind a
    ///        treasury after the fact via `setTreasury`.
    constructor(address initialTreasury) EIP712("SoulVaultSwarm", "1") {
        owner = msg.sender;
        if (initialTreasury != address(0)) {
            treasury = initialTreasury;
            emit TreasurySet(address(0), initialTreasury, msg.sender);
        }
    }

    /// @notice Expose EIP-712 domain separator for client sanity checks.
    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    /// @dev Verify EIP-712 signature from owner. Checks nonce + deadline + consumes nonce.
    function _checkOwnerSig(bytes32 structHash, uint64 nonce, uint64 deadline, bytes calldata sig) internal {
        if (block.timestamp > deadline) revert SigExpired();
        if (nonce != ownerNonce) revert BadNonce(ownerNonce, nonce);
        address recovered = ECDSA.recover(_hashTypedDataV4(structHash), sig);
        if (recovered != owner) revert BadSigner(recovered);
        unchecked { ownerNonce = nonce + 1; }
    }

    function getMember(address member) external view override returns (Member memory) {
        return _members[member];
    }

    function isActiveMember(address member) public view override returns (bool) {
        return _members[member].active;
    }

    function getJoinRequest(uint256 requestId) external view override returns (JoinRequest memory) {
        return _joinRequests[requestId];
    }

    function getFundRequest(uint256 requestId) external view override returns (FundRequest memory) {
        return _fundRequests[requestId];
    }

    function nextFundRequestId() external view override returns (uint256) {
        return _nextFundRequestId;
    }

    function getMemberFileMapping(address member) external view override returns (MemberFileMapping memory) {
        return _memberFileMappings[member];
    }

    function getAgentManifest(address member) external view override returns (string memory manifestRef, bytes32 manifestHash) {
        ManifestPointer storage ptr = _agentManifests[member];
        return (ptr.manifestRef, ptr.manifestHash);
    }

    function getLastSenderSeq(address sender) external view override returns (uint64) {
        return _lastSenderSeq[sender];
    }

    function requestJoin(bytes calldata pubkey, string calldata pubkeyRef, string calldata metadataRef)
        external
        override
        whenNotPaused
        returns (uint256 requestId)
    {
        if (_members[msg.sender].active) revert AlreadyActiveMember();
        if (pubkey.length == 0) revert InvalidPubkey();

        requestId = _nextRequestId++;
        _joinRequests[requestId] = JoinRequest({
            requester: msg.sender,
            pubkey: pubkey,
            pubkeyRef: pubkeyRef,
            metadataRef: metadataRef,
            status: STATUS_PENDING
        });

        emit JoinRequested(requestId, msg.sender, pubkey, pubkeyRef, metadataRef);
    }

    function approveJoin(uint256 requestId) external override onlyOwner whenNotPaused {
        _approveJoin(requestId, msg.sender);
    }

    function _approveJoin(uint256 requestId, address approver) internal {
        JoinRequest storage req = _requirePendingRequest(requestId);

        Member storage member = _members[req.requester];
        if (member.active) revert AlreadyActiveMember();

        member.active = true;
        member.pubkey = req.pubkey;
        member.joinedEpoch = currentEpoch;

        req.status = STATUS_APPROVED;
        membershipVersion += 1;
        memberCount += 1;

        emit JoinApproved(requestId, req.requester, approver, currentEpoch);
    }

    function rejectJoin(uint256 requestId, string calldata reason) external override onlyOwner whenNotPaused {
        _rejectJoin(requestId, reason, msg.sender);
    }

    function _rejectJoin(uint256 requestId, string calldata reason, address rejector) internal {
        JoinRequest storage req = _requirePendingRequest(requestId);
        req.status = STATUS_REJECTED;
        emit JoinRejected(requestId, req.requester, rejector, reason);
    }

    function cancelJoin(uint256 requestId) external override whenNotPaused {
        JoinRequest storage req = _requirePendingRequest(requestId);
        if (req.requester != msg.sender) revert NotRequester();
        req.status = STATUS_CANCELLED;
        emit JoinCancelled(requestId, msg.sender);
    }

    function removeMember(address member) external override onlyOwner whenNotPaused {
        _removeMember(member, msg.sender);
    }

    function _removeMember(address member, address remover) internal {
        Member storage m = _members[member];
        if (!m.active) revert NotActiveMember();

        m.active = false;
        membershipVersion += 1;
        memberCount -= 1;

        emit MemberRemoved(member, remover, currentEpoch);
    }

    // --- Treasury binding ---

    function setTreasury(address newTreasury) external override onlyOwner {
        _setTreasury(newTreasury, msg.sender);
    }

    function _setTreasury(address newTreasury, address setter) internal {
        if (newTreasury == address(0)) revert ZeroAddress();
        address old = treasury;
        treasury = newTreasury;
        emit TreasurySet(old, newTreasury, setter);
    }

    // --- Fund request lifecycle ---

    function requestFunds(uint256 amount, string calldata reason)
        external
        override
        whenNotPaused
        returns (uint256 requestId)
    {
        if (!_members[msg.sender].active) revert NotActiveMember();
        if (treasury == address(0)) revert TreasuryNotSet();
        if (amount == 0) revert ZeroAmount();

        requestId = _nextFundRequestId++;
        _fundRequests[requestId] = FundRequest({
            requester: msg.sender,
            amount: amount,
            reason: reason,
            status: STATUS_PENDING,
            createdAt: uint64(block.timestamp),
            resolvedAt: 0
        });

        emit FundRequested(requestId, msg.sender, amount, reason);
    }

    function cancelFundRequest(uint256 requestId) external override whenNotPaused {
        FundRequest storage req = _requirePendingFundRequest(requestId);
        if (req.requester != msg.sender) revert NotFundRequester();
        req.status = STATUS_CANCELLED;
        req.resolvedAt = uint64(block.timestamp);
        emit FundRequestCancelled(requestId, msg.sender);
    }

    function markFundRequestApproved(uint256 requestId) external override whenNotPaused {
        if (msg.sender != treasury) revert NotTreasury();
        FundRequest storage req = _requirePendingFundRequest(requestId);
        req.status = STATUS_APPROVED;
        req.resolvedAt = uint64(block.timestamp);
        emit FundRequestApproved(requestId, req.requester, msg.sender, req.amount);
    }

    function markFundRequestRejected(uint256 requestId, string calldata reason)
        external
        override
        whenNotPaused
    {
        if (msg.sender != treasury) revert NotTreasury();
        FundRequest storage req = _requirePendingFundRequest(requestId);
        req.status = STATUS_REJECTED;
        req.resolvedAt = uint64(block.timestamp);
        emit FundRequestRejected(requestId, req.requester, msg.sender, reason);
    }

    function rotateEpoch(
        uint64 newEpoch,
        string calldata keyBundleRef,
        bytes32 keyBundleHash,
        uint64 expectedMembershipVersion
    ) external override onlyOwner whenNotPaused {
        _rotateEpoch(newEpoch, keyBundleRef, keyBundleHash, expectedMembershipVersion);
    }

    function _rotateEpoch(
        uint64 newEpoch,
        string calldata keyBundleRef,
        bytes32 keyBundleHash,
        uint64 expectedMembershipVersion
    ) internal {
        if (expectedMembershipVersion != membershipVersion) revert MembershipChanged();
        if (newEpoch <= currentEpoch) revert InvalidEpoch();
        if (bytes(keyBundleRef).length == 0) revert EmptyReference();

        uint64 oldEpoch = currentEpoch;
        currentEpoch = newEpoch;

        emit EpochRotated(oldEpoch, newEpoch, keyBundleRef, keyBundleHash, membershipVersion);
    }

    function grantHistoricalKeys(
        address member,
        string calldata bundleRef,
        bytes32 bundleHash,
        uint64 fromEpoch,
        uint64 toEpoch
    ) external override onlyOwner whenNotPaused {
        if (bytes(bundleRef).length == 0) revert EmptyReference();
        if (fromEpoch > toEpoch) revert InvalidRange();

        emit HistoricalKeyBundleGranted(member, bundleRef, bundleHash, fromEpoch, toEpoch);
    }

    function updateMemberFileMapping(
        address member,
        string calldata storageLocator,
        bytes32 merkleRoot,
        bytes32 publishTxHash,
        bytes32 manifestHash,
        uint64 epoch
    ) external override whenNotPaused {
        if (msg.sender != owner && msg.sender != member) revert UnauthorizedPublisher();
        if (msg.sender != owner && !_members[msg.sender].active) revert NotActiveMember();
        if (msg.sender == owner && !_members[member].active) revert NotActiveMember();
        if (epoch > currentEpoch) revert InvalidEpoch();
        if (bytes(storageLocator).length == 0) revert EmptyReference();

        _memberFileMappings[member] = MemberFileMapping({
            storageLocator: storageLocator,
            merkleRoot: merkleRoot,
            publishTxHash: publishTxHash,
            manifestHash: manifestHash,
            epoch: epoch,
            updatedAt: uint64(block.timestamp)
        });

        emit MemberFileMappingUpdated(member, epoch, storageLocator, merkleRoot, publishTxHash, manifestHash, msg.sender);
    }

    function postMessage(
        address to,
        string calldata topic,
        uint64 seq,
        uint64 epoch,
        string calldata payloadRef,
        bytes32 payloadHash,
        uint64 ttl
    ) external override whenNotPaused {
        if (!_members[msg.sender].active) revert NotActiveMember();
        if (epoch != currentEpoch) revert InvalidEpoch();
        if (seq <= _lastSenderSeq[msg.sender]) revert InvalidSequence();
        if (bytes(payloadRef).length == 0) revert EmptyReference();

        _lastSenderSeq[msg.sender] = seq;
        emit AgentMessagePosted(
            msg.sender,
            to,
            topic,
            seq,
            epoch,
            payloadRef,
            payloadHash,
            ttl,
            uint64(block.timestamp)
        );
    }

    function requestBackup(
        uint64 epoch,
        string calldata reason,
        string calldata targetRef,
        uint64 deadline
    ) external override onlyOwner whenNotPaused {
        _requestBackup(epoch, reason, targetRef, deadline, msg.sender);
    }

    function _requestBackup(
        uint64 epoch,
        string calldata reason,
        string calldata targetRef,
        uint64 deadline,
        address caller
    ) internal {
        if (epoch != currentEpoch) revert InvalidEpoch();
        emit BackupRequested(caller, epoch, reason, targetRef, deadline, uint64(block.timestamp));
    }

    function updateAgentManifest(string calldata manifestRef, bytes32 manifestHash) external override whenNotPaused {
        if (!_members[msg.sender].active) revert NotActiveMember();
        if (bytes(manifestRef).length == 0) revert EmptyReference();

        _agentManifests[msg.sender] = ManifestPointer({manifestRef: manifestRef, manifestHash: manifestHash});
        emit AgentManifestUpdated(msg.sender, manifestRef, manifestHash, uint64(block.timestamp));
    }

    function pause() external override onlyOwner {
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external override onlyOwner {
        paused = false;
        emit Unpaused(msg.sender);
    }

    function requestRekey(string calldata trigger) external override {
        emit RekeyRequested(trigger, membershipVersion);
    }

    function _requirePendingRequest(uint256 requestId) internal view returns (JoinRequest storage req) {
        req = _joinRequests[requestId];
        if (req.requester == address(0)) revert InvalidRequest();
        if (req.status != STATUS_PENDING) revert InvalidRequestState();
    }

    function _requirePendingFundRequest(uint256 requestId) internal view returns (FundRequest storage req) {
        req = _fundRequests[requestId];
        if (req.requester == address(0)) revert InvalidFundRequest();
        if (req.status != STATUS_PENDING) revert InvalidFundRequestState();
    }

    // ─── Signed-intent path (owner signs EIP-712, any EOA submits) ─────────

    function approveJoinWithSig(
        uint256 requestId,
        address requester,
        uint64 nonce,
        uint64 deadline,
        bytes calldata sig
    ) external whenNotPaused {
        _checkOwnerSig(
            keccak256(abi.encode(APPROVE_JOIN_TYPEHASH, address(this), requestId, requester, nonce, deadline)),
            nonce, deadline, sig
        );
        // Bind signed requester to actual request to prevent stale-signature exploits.
        JoinRequest storage req = _joinRequests[requestId];
        if (req.requester != requester) revert InvalidRequest();
        _approveJoin(requestId, owner);
    }

    function rejectJoinWithSig(
        uint256 requestId,
        address requester,
        bytes32 reasonHash,
        string calldata reason,
        uint64 nonce,
        uint64 deadline,
        bytes calldata sig
    ) external whenNotPaused {
        if (keccak256(bytes(reason)) != reasonHash) revert InvalidRequest();
        _checkOwnerSig(
            keccak256(abi.encode(REJECT_JOIN_TYPEHASH, address(this), requestId, requester, reasonHash, nonce, deadline)),
            nonce, deadline, sig
        );
        JoinRequest storage req = _joinRequests[requestId];
        if (req.requester != requester) revert InvalidRequest();
        _rejectJoin(requestId, reason, owner);
    }

    function removeMemberWithSig(
        address member,
        uint64 nonce,
        uint64 deadline,
        bytes calldata sig
    ) external whenNotPaused {
        _checkOwnerSig(
            keccak256(abi.encode(REMOVE_MEMBER_TYPEHASH, address(this), member, nonce, deadline)),
            nonce, deadline, sig
        );
        _removeMember(member, owner);
    }

    function setTreasuryWithSig(
        address newTreasury,
        uint64 nonce,
        uint64 deadline,
        bytes calldata sig
    ) external {
        _checkOwnerSig(
            keccak256(abi.encode(SET_TREASURY_TYPEHASH, address(this), newTreasury, nonce, deadline)),
            nonce, deadline, sig
        );
        _setTreasury(newTreasury, owner);
    }

    function rotateEpochWithSig(
        uint64 newEpoch,
        string calldata keyBundleRef,
        bytes32 keyBundleHash,
        uint64 expectedMembershipVersion,
        uint64 fromEpoch,
        bytes32 bundleManifestHash,
        uint64 nonce,
        uint64 deadline,
        bytes calldata sig
    ) external whenNotPaused {
        // Signed intent identifies the rotation by (fromEpoch, toEpoch, bundleManifestHash).
        // Contract enforces fromEpoch == currentEpoch and bundleManifestHash == keyBundleHash
        // so the sig binds both the numeric transition and the opaque bundle content.
        if (fromEpoch != currentEpoch) revert InvalidEpoch();
        if (bundleManifestHash != keyBundleHash) revert InvalidRequest();
        _checkOwnerSig(
            keccak256(abi.encode(
                ROTATE_EPOCH_TYPEHASH, address(this), fromEpoch, newEpoch, bundleManifestHash, nonce, deadline
            )),
            nonce, deadline, sig
        );
        _rotateEpoch(newEpoch, keyBundleRef, keyBundleHash, expectedMembershipVersion);
    }

    function requestBackupWithSig(
        uint64 epoch,
        bytes32 trigger,
        string calldata reason,
        string calldata targetRef,
        uint64 deadline,
        uint64 nonce,
        uint64 sigDeadline,
        bytes calldata sig
    ) external whenNotPaused {
        _checkOwnerSig(
            keccak256(abi.encode(BACKUP_REQUEST_TYPEHASH, address(this), epoch, trigger, nonce, sigDeadline)),
            nonce, sigDeadline, sig
        );
        _requestBackup(epoch, reason, targetRef, deadline, owner);
    }
}
