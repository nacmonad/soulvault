// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ISoulVaultSwarm} from "./ISoulVaultSwarm.sol";

contract SoulVaultSwarm is ISoulVaultSwarm {
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
    constructor(address initialTreasury) {
        owner = msg.sender;
        if (initialTreasury != address(0)) {
            treasury = initialTreasury;
            emit TreasurySet(address(0), initialTreasury, msg.sender);
        }
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
        JoinRequest storage req = _requirePendingRequest(requestId);

        Member storage member = _members[req.requester];
        if (member.active) revert AlreadyActiveMember();

        member.active = true;
        member.pubkey = req.pubkey;
        member.joinedEpoch = currentEpoch;

        req.status = STATUS_APPROVED;
        membershipVersion += 1;
        memberCount += 1;

        emit JoinApproved(requestId, req.requester, msg.sender, currentEpoch);
    }

    function rejectJoin(uint256 requestId, string calldata reason) external override onlyOwner whenNotPaused {
        JoinRequest storage req = _requirePendingRequest(requestId);
        req.status = STATUS_REJECTED;
        emit JoinRejected(requestId, req.requester, msg.sender, reason);
    }

    function cancelJoin(uint256 requestId) external override whenNotPaused {
        JoinRequest storage req = _requirePendingRequest(requestId);
        if (req.requester != msg.sender) revert NotRequester();
        req.status = STATUS_CANCELLED;
        emit JoinCancelled(requestId, msg.sender);
    }

    function removeMember(address member) external override onlyOwner whenNotPaused {
        Member storage m = _members[member];
        if (!m.active) revert NotActiveMember();

        m.active = false;
        membershipVersion += 1;
        memberCount -= 1;

        emit MemberRemoved(member, msg.sender, currentEpoch);
    }

    // --- Treasury binding ---

    function setTreasury(address newTreasury) external override onlyOwner {
        if (newTreasury == address(0)) revert ZeroAddress();
        address old = treasury;
        treasury = newTreasury;
        emit TreasurySet(old, newTreasury, msg.sender);
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
        if (epoch != currentEpoch) revert InvalidEpoch();
        emit BackupRequested(msg.sender, epoch, reason, targetRef, deadline, uint64(block.timestamp));
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
}
