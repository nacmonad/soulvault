// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @dev Minimal ENS registry for integration tests. Supports owner/resolver
/// lookups and subnode registration — nothing else.
contract MockENSRegistry {
    mapping(bytes32 => address) private _owners;
    mapping(bytes32 => address) private _resolvers;

    constructor() {
        _owners[bytes32(0)] = msg.sender;
    }

    function owner(bytes32 node) external view returns (address) {
        return _owners[node];
    }

    function resolver(bytes32 node) external view returns (address) {
        return _resolvers[node];
    }

    function setResolver(bytes32 node, address resolver_) external {
        require(_owners[node] == msg.sender, "not owner");
        _resolvers[node] = resolver_;
    }

    function setSubnodeRecord(
        bytes32 node,
        bytes32 label,
        address newOwner,
        address resolver_,
        uint64 /* ttl */
    ) external {
        require(_owners[node] == msg.sender, "not owner");
        bytes32 subnode = keccak256(abi.encodePacked(node, label));
        _owners[subnode] = newOwner;
        _resolvers[subnode] = resolver_;
    }
}
