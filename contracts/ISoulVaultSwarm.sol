// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ISoulVaultSwarm
/// @notice MVP interface for the SoulVault swarm contract.
/// @dev Agent identity is handled separately through ERC-8004. This contract
///      governs only swarm membership, epoch rotation, encrypted-state pointers,
///      messaging, and historical recovery references.
interface ISoulVaultSwarm {
    struct Member {
        bool active;
        bytes pubkey;
        uint64 joinedEpoch;
    }

    struct JoinRequest {
        address requester;
        bytes pubkey;
        string pubkeyRef;
        string metadataRef;
        uint8 status; // 0=pending, 1=approved, 2=rejected, 3=cancelled
    }

    struct MemberFileMapping {
        string storageLocator;
        bytes32 merkleRoot;
        bytes32 publishTxHash;
        bytes32 manifestHash;
        uint64 epoch;
        uint64 updatedAt;
    }

    struct FundRequest {
        address requester;
        uint256 amount;      // native token wei
        string reason;
        uint8 status;        // 0=pending, 1=approved, 2=rejected, 3=cancelled
        uint64 createdAt;
        uint64 resolvedAt;   // 0 until approve/reject/cancel
    }

    // --- Views ---
    function owner() external view returns (address);
    function paused() external view returns (bool);
    function currentEpoch() external view returns (uint64);
    function membershipVersion() external view returns (uint64);
    function memberCount() external view returns (uint256);
    function treasury() external view returns (address);
    function nextFundRequestId() external view returns (uint256);

    function getMember(address member) external view returns (Member memory);
    function isActiveMember(address member) external view returns (bool);
    function getJoinRequest(uint256 requestId) external view returns (JoinRequest memory);
    function getFundRequest(uint256 requestId) external view returns (FundRequest memory);
    function getMemberFileMapping(address member) external view returns (MemberFileMapping memory);
    function getAgentManifest(address member) external view returns (string memory manifestRef, bytes32 manifestHash);
    function getLastSenderSeq(address sender) external view returns (uint64);

    // --- Membership lifecycle ---
    function requestJoin(bytes calldata pubkey, string calldata pubkeyRef, string calldata metadataRef)
        external
        returns (uint256 requestId);

    function approveJoin(uint256 requestId) external;
    function rejectJoin(uint256 requestId, string calldata reason) external;
    function cancelJoin(uint256 requestId) external;
    function removeMember(address member) external;

    // --- Treasury binding ---
    function setTreasury(address newTreasury) external;

    // --- Fund request lifecycle ---
    /// @notice Active member submits a fund request. Treasury must be set.
    /// @dev Emits FundRequested. Request state lives on the swarm; payout happens on the treasury.
    function requestFunds(uint256 amount, string calldata reason) external returns (uint256 requestId);
    function cancelFundRequest(uint256 requestId) external;
    /// @dev Only callable by the bound treasury contract.
    function markFundRequestApproved(uint256 requestId) external;
    /// @dev Only callable by the bound treasury contract.
    function markFundRequestRejected(uint256 requestId, string calldata reason) external;

    // --- Epoch management ---
    function rotateEpoch(
        uint64 newEpoch,
        string calldata keyBundleRef,
        bytes32 keyBundleHash,
        uint64 expectedMembershipVersion
    ) external;

    // --- Historical recovery ---
    function grantHistoricalKeys(
        address member,
        string calldata bundleRef,
        bytes32 bundleHash,
        uint64 fromEpoch,
        uint64 toEpoch
    ) external;

    // --- Per-member backup publication (Option B) ---
    function updateMemberFileMapping(
        address member,
        string calldata storageLocator,
        bytes32 merkleRoot,
        bytes32 publishTxHash,
        bytes32 manifestHash,
        uint64 epoch
    ) external;

    // --- Messaging ---
    function postMessage(
        address to,
        string calldata topic,
        uint64 seq,
        uint64 epoch,
        string calldata payloadRef,
        bytes32 payloadHash,
        uint64 ttl
    ) external;

    // --- Coordinated backup triggers ---
    function requestBackup(
        uint64 epoch,
        string calldata reason,
        string calldata targetRef,
        uint64 deadline
    ) external;

    // --- Agent manifest pointers ---
    function updateAgentManifest(string calldata manifestRef, bytes32 manifestHash) external;

    // --- Operational controls ---
    function pause() external;
    function unpause() external;
    function requestRekey(string calldata trigger) external;

    // --- Signed-intent path (owner signs EIP-712, any EOA submits) ---
    function ownerNonce() external view returns (uint64);

    function approveJoinWithSig(
        uint256 requestId,
        address requester,
        uint64 nonce,
        uint64 deadline,
        bytes calldata sig
    ) external;

    function rejectJoinWithSig(
        uint256 requestId,
        address requester,
        bytes32 reasonHash,
        string calldata reason,
        uint64 nonce,
        uint64 deadline,
        bytes calldata sig
    ) external;

    function removeMemberWithSig(
        address member,
        uint64 nonce,
        uint64 deadline,
        bytes calldata sig
    ) external;

    function setTreasuryWithSig(
        address newTreasury,
        uint64 nonce,
        uint64 deadline,
        bytes calldata sig
    ) external;

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
    ) external;

    function requestBackupWithSig(
        uint64 epoch,
        bytes32 trigger,
        string calldata reason,
        string calldata targetRef,
        uint64 deadline,
        uint64 nonce,
        uint64 sigDeadline,
        bytes calldata sig
    ) external;

    // --- Events ---
    event JoinRequested(
        uint256 indexed requestId,
        address indexed requester,
        bytes pubkey,
        string pubkeyRef,
        string metadataRef
    );

    event JoinApproved(
        uint256 indexed requestId,
        address indexed requester,
        address indexed approver,
        uint64 epoch
    );

    event JoinRejected(uint256 indexed requestId, address indexed requester, address indexed rejector, string reason);
    event JoinCancelled(uint256 indexed requestId, address indexed requester);

    event MemberRemoved(address indexed member, address indexed by, uint64 epoch);

    event EpochRotated(
        uint64 indexed oldEpoch,
        uint64 indexed newEpoch,
        string keyBundleRef,
        bytes32 keyBundleHash,
        uint64 membershipVersion
    );

    event MemberFileMappingUpdated(
        address indexed member,
        uint64 indexed epoch,
        string storageLocator,
        bytes32 merkleRoot,
        bytes32 publishTxHash,
        bytes32 manifestHash,
        address indexed by
    );

    event AgentMessagePosted(
        address indexed from,
        address indexed to,
        string topic,
        uint64 seq,
        uint64 epoch,
        string payloadRef,
        bytes32 payloadHash,
        uint64 ttl,
        uint64 timestamp
    );

    event AgentManifestUpdated(address indexed agent, string manifestRef, bytes32 manifestHash, uint64 timestamp);

    event BackupRequested(
        address indexed requestedBy,
        uint64 indexed epoch,
        string reason,
        string targetRef,
        uint64 deadline,
        uint64 timestamp
    );

    event HistoricalKeyBundleGranted(
        address indexed member,
        string bundleRef,
        bytes32 bundleHash,
        uint64 fromEpoch,
        uint64 toEpoch
    );

    event RekeyRequested(string trigger, uint64 membershipVersion);
    event Paused(address indexed by);
    event Unpaused(address indexed by);

    // --- Treasury / fund request events ---
    event TreasurySet(address indexed oldTreasury, address indexed newTreasury, address indexed by);

    event FundRequested(
        uint256 indexed requestId,
        address indexed requester,
        uint256 amount,
        string reason
    );

    event FundRequestApproved(
        uint256 indexed requestId,
        address indexed requester,
        address indexed treasury,
        uint256 amount
    );

    event FundRequestRejected(
        uint256 indexed requestId,
        address indexed requester,
        address indexed treasury,
        string reason
    );

    event FundRequestCancelled(uint256 indexed requestId, address indexed requester);
}
