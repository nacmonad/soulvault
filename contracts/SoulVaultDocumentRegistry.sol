// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title SoulVaultDocumentRegistry
 * @notice Backend-free v0 transport for redacted documents
 * (docs/redaction-hydration-spec.md §§3–4).
 *
 * The chain is a key-distribution transport and integrity anchor, not a
 * document store: publication events carry the docHash + slot list (never
 * ciphertexts), and grant events carry the wrapped slot keys — the grant
 * event IS the key delivery. The redacted artifact + encrypted slots travel
 * as a JSON bundle file over ordinary channels.
 *
 * A delivered READ grant is a permanent capability: there is no revocation
 * and no expiry (spec §3).
 *
 * Wire-format compatibility: `SlotKeyGranted` fields map 1:1 onto
 * `SecpWrappedKey` (packages/protocol/src/crypto.ts) and the event surface
 * mirrored in apps/web/src/lib/onchain/abis.ts.
 */
contract SoulVaultDocumentRegistry {
    /// @notice Expected wrap algorithm for slot-key grants.
    string public constant WRAP_ALGORITHM = "secp256k1-ecdh-aes-256-gcm";

    error NotAuthor();
    error AlreadyPublished();
    error EmptyDocHash();
    error EmptySlotId();
    error EmptyWrappedKey();
    error BadAlgorithm();

    /// @notice docHash => author of record. The slot list lives in the
    /// publication event log (the resolver's canonical source).
    mapping(bytes32 => address) private _publicationAuthor;

    event DocumentPublished(bytes32 indexed docHash, address indexed author, string[] slotIds);
    event SlotKeyGranted(
        bytes32 indexed docHash,
        string slotId,
        address indexed recipient,
        string wrappedKey,
        string algorithm,
        string ephemeralPublicKey,
        string nonce
    );

    /// @notice Anchor a redacted document's integrity: docHash + slot list.
    /// The author is msg.sender; the document itself never touches the chain.
    /// The first publisher of a docHash is its author of record permanently —
    /// republishing cannot transfer grant authority to a different address.
    function publishDocument(bytes32 docHash, string[] calldata slotIds) external {
        if (docHash == bytes32(0)) revert EmptyDocHash();
        for (uint256 i = 0; i < slotIds.length; i++) {
            if (bytes(slotIds[i]).length == 0) revert EmptySlotId();
        }

        address existing = _publicationAuthor[docHash];
        if (existing != address(0)) {
            if (existing != msg.sender) revert AlreadyPublished();
        } else {
            _publicationAuthor[docHash] = msg.sender;
        }

        emit DocumentPublished(docHash, msg.sender, slotIds);
    }

    /// @notice Deliver a wrapped slot key to a recipient. Only the publishing
    /// author of the docHash may grant. There is no revoke: this capability is
    /// permanent once delivered.
    function grantSlotKey(
        bytes32 docHash,
        string calldata slotId,
        address recipient,
        string calldata wrappedKey,
        string calldata algorithm,
        string calldata ephemeralPublicKey,
        string calldata nonce
    ) external {
        if (_publicationAuthor[docHash] != msg.sender) revert NotAuthor();
        if (bytes(slotId).length == 0) revert EmptySlotId();
        if (bytes(wrappedKey).length == 0) revert EmptyWrappedKey();
        if (keccak256(bytes(algorithm)) != keccak256(bytes(WRAP_ALGORITHM))) revert BadAlgorithm();
        if (recipient == address(0)) revert NotAuthor();

        emit SlotKeyGranted(docHash, slotId, recipient, wrappedKey, algorithm, ephemeralPublicKey, nonce);
    }

    /// @notice Author of record for a published document.
    function publicationAuthor(bytes32 docHash) external view returns (address) {
        return _publicationAuthor[docHash];
    }
}
