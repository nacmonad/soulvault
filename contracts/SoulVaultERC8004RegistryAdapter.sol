// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC8004AgentRegistryAdapter} from "./IERC8004AgentRegistryAdapter.sol";

contract SoulVaultERC8004RegistryAdapter is IERC8004AgentRegistryAdapter {
    error InvalidAgentWallet();
    error AgentNotFound();
    error Unauthorized();

    uint256 private _nextAgentId = 1;

    mapping(uint256 => address) private _agentWallets;
    mapping(uint256 => string) private _agentUris;
    mapping(uint256 => mapping(string => string)) private _metadata;
    mapping(address => uint256[]) private _walletAgentIds;

    event AgentRegistered(uint256 indexed agentId, address indexed agentWallet, string agentURI);
    event AgentURIUpdated(uint256 indexed agentId, address indexed agentWallet, string agentURI);
    event AgentMetadataSet(uint256 indexed agentId, string key, string value);

    function registerAgent(address walletAddr, string calldata agentUriValue) external returns (uint256 agentId) {
        if (walletAddr == address(0)) revert InvalidAgentWallet();
        if (msg.sender != walletAddr) revert Unauthorized();

        agentId = _nextAgentId++;
        _agentWallets[agentId] = walletAddr;
        _agentUris[agentId] = agentUriValue;
        _walletAgentIds[walletAddr].push(agentId);

        emit AgentRegistered(agentId, walletAddr, agentUriValue);
    }

    function updateAgentURI(uint256 agentId, string calldata agentUriValue) external {
        address wallet = _agentWallets[agentId];
        if (wallet == address(0)) revert AgentNotFound();
        if (msg.sender != wallet) revert Unauthorized();

        _agentUris[agentId] = agentUriValue;
        emit AgentURIUpdated(agentId, wallet, agentUriValue);
    }

    function setMetadata(uint256 agentId, string calldata key, string calldata value) external {
        address wallet = _agentWallets[agentId];
        if (wallet == address(0)) revert AgentNotFound();
        if (msg.sender != wallet) revert Unauthorized();

        _metadata[agentId][key] = value;
        emit AgentMetadataSet(agentId, key, value);
    }

    function agentURI(uint256 agentId) external view returns (string memory) {
        address wallet = _agentWallets[agentId];
        if (wallet == address(0)) revert AgentNotFound();
        return _agentUris[agentId];
    }

    function agentWallet(uint256 agentId) external view returns (address) {
        address wallet = _agentWallets[agentId];
        if (wallet == address(0)) revert AgentNotFound();
        return wallet;
    }

    function metadata(uint256 agentId, string calldata key) external view returns (string memory) {
        address wallet = _agentWallets[agentId];
        if (wallet == address(0)) revert AgentNotFound();
        return _metadata[agentId][key];
    }

    function agentIdsForWallet(address wallet) external view returns (uint256[] memory) {
        return _walletAgentIds[wallet];
    }
}
