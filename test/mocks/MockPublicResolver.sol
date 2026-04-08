// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @dev Minimal resolver that stores text records without access control.
/// Sufficient for integration-test readback assertions.
contract MockPublicResolver {
    mapping(bytes32 => mapping(string => string)) private _texts;

    function setText(bytes32 node, string calldata key, string calldata value) external {
        _texts[node][key] = value;
    }

    function text(bytes32 node, string calldata key) external view returns (string memory) {
        return _texts[node][key];
    }

    function setAddr(bytes32, address) external {}
    function setName(bytes32, string calldata) external {}
}
