// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IERC8004AgentRegistryAdapter
/// @notice SoulVault-facing adapter interface for ERC-8004 integration.
/// @dev This is NOT intended to be the canonical ERC-8004 interface text.
///      It is the minimal integration surface SoulVault expects from an
///      ERC-8004-compatible identity registry or wrapper contract.
interface IERC8004AgentRegistryAdapter {
    /// @notice Register a new agent identity.
    /// @param agentWallet Wallet associated with the agent.
    /// @param agentURI Base64 data URI carrying the public registration payload.
    /// @return agentId Newly assigned registry id.
    function registerAgent(address agentWallet, string calldata agentURI) external returns (uint256 agentId);

    /// @notice Update the public registration payload for an existing agent.
    function updateAgentURI(uint256 agentId, string calldata agentURI) external;

    /// @notice Optional metadata setter used by some ERC-8004-style registries.
    function setMetadata(uint256 agentId, string calldata key, string calldata value) external;

    /// @notice Resolve the public registration payload for an agent.
    function agentURI(uint256 agentId) external view returns (string memory);

    /// @notice Resolve the associated wallet for an agent.
    function agentWallet(uint256 agentId) external view returns (address);
}
