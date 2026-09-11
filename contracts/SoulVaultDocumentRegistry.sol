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
 * Rehydration requests close the loop on-chain: a consumer posts
 * `requestRehydration` with their rehydration public key and the tx signature
 * (`msg.sender`) authenticates the wallet↔pubkey binding — the same way the
 * publish/grant txs authenticate the author — so the author's client can
 * wrap slot keys straight from the `RehydrationRequested` event log with no
 * out-of-band attestation exchange.
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
    error NotPublished();
    error EmptyPublicKey();
    error ArrayLengthMismatch();
    error EmptySelfieProof();

    /// @notice docHash => author of record. The slot list lives in the
    /// publication event log (the resolver's canonical source).
    mapping(bytes32 => address) private _publicationAuthor;
    /// @notice Per-document World Selfie Check policy. Default false so
    /// pre-flag publications and the Ledger demo stay ungated.
    mapping(bytes32 => bool) private _selfieRequired;

    event DocumentPublished(
        bytes32 indexed docHash,
        address indexed author,
        string[] slotIds,
        bool selfieRequired
    );
    event SlotKeyGranted(
        bytes32 indexed docHash,
        string slotId,
        address indexed recipient,
        string wrappedKey,
        string algorithm,
        string ephemeralPublicKey,
        string nonce
    );
    /// @notice A consumer asked for hydration of a published document. The
    /// rehydration public key rides in the event; `recipient` (msg.sender) is
    /// authenticated by the tx signature, so the event is the wallet-attested
    /// key binding — grants can be wrapped directly from it.
    event RehydrationRequested(
        bytes32 indexed docHash,
        address indexed recipient,
        string rehydrationPublicKey,
        string selfieProof
    );

    /// @notice Anchor a redacted document's integrity: docHash + slot list.
    /// The author is msg.sender; the document itself never touches the chain.
    /// The first publisher of a docHash is its author of record permanently —
    /// republishing cannot transfer grant authority to a different address.
    /// Two-arg form keeps `selfieRequired=false` (Ledger demo / old clients).
    function publishDocument(bytes32 docHash, string[] calldata slotIds) external {
        _publishDocument(docHash, slotIds, false);
    }

    /// @notice Same as the two-arg form, with an optional World Selfie Check
    /// policy flag. The flag does not gate this transaction — Alice never
    /// selfies to publish. It binds later `requestRehydration` / grant-from-request.
    function publishDocument(bytes32 docHash, string[] calldata slotIds, bool requireSelfie) external {
        _publishDocument(docHash, slotIds, requireSelfie);
    }

    function _publishDocument(bytes32 docHash, string[] calldata slotIds, bool requireSelfie) internal {
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
        _selfieRequired[docHash] = requireSelfie;

        emit DocumentPublished(docHash, msg.sender, slotIds, requireSelfie);
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

    /// @notice Batch form of `grantSlotKey`: one tx delivers wrapped keys for
    /// every slot in `slotIds`, emitting one `SlotKeyGranted` per slot —
    /// identical event format, so consumers need no changes. All slots share
    /// one algorithm (the wrap algorithm is fixed contract-wide anyway).
    /// Array lengths must match pairwise (slotIds/wrappedKeys/ephemeralPublicKeys/nonces).
    function grantSlotKeys(
        bytes32 docHash,
        address recipient,
        string[] calldata slotIds,
        string[] calldata wrappedKeys,
        string calldata algorithm,
        string[] calldata ephemeralPublicKeys,
        string[] calldata nonces
    ) external {
        if (_publicationAuthor[docHash] != msg.sender) revert NotAuthor();
        if (recipient == address(0)) revert NotAuthor();
        if (
            slotIds.length != wrappedKeys.length ||
            slotIds.length != ephemeralPublicKeys.length ||
            slotIds.length != nonces.length
        ) revert ArrayLengthMismatch();
        if (slotIds.length == 0) revert EmptySlotId();
        if (keccak256(bytes(algorithm)) != keccak256(bytes(WRAP_ALGORITHM))) revert BadAlgorithm();

        for (uint256 i = 0; i < slotIds.length; i++) {
            if (bytes(slotIds[i]).length == 0) revert EmptySlotId();
            if (bytes(wrappedKeys[i]).length == 0) revert EmptyWrappedKey();
            emit SlotKeyGranted(
                docHash,
                slotIds[i],
                recipient,
                wrappedKeys[i],
                algorithm,
                ephemeralPublicKeys[i],
                nonces[i]
            );
        }
    }

    /// @notice Author of record for a published document.
    function publicationAuthor(bytes32 docHash) external view returns (address) {
        return _publicationAuthor[docHash];
    }

    /// @notice World Selfie Check policy for a published document.
    function selfieRequired(bytes32 docHash) external view returns (bool) {
        return _selfieRequired[docHash];
    }

    /// @notice Request hydration of a published document. The caller's tx
    /// signature binds `msg.sender` to `rehydrationPublicKey` — the author
    /// wraps slot keys to that key and delivers them via SlotKeyGranted.
    /// Re-requesting with a fresh key is the key-loss recovery story: the old
    /// request stays in the log but grants wrapped to it simply cannot be
    /// unwrapped by the new key (fail closed).
    /// Two-arg form carries an empty selfieProof (reverts if the document
    /// was published with selfieRequired=true).
    function requestRehydration(bytes32 docHash, string calldata rehydrationPublicKey) external {
        string memory emptyProof;
        _requestRehydration(docHash, rehydrationPublicKey, emptyProof);
    }

    /// @notice Same as the two-arg form, with the IDKit result JSON when the
    /// document requires a Selfie Check. The chain stores the proof string; it
    /// does not verify the ZK. Alice's client (RP worker) is the verifier.
    function requestRehydration(
        bytes32 docHash,
        string calldata rehydrationPublicKey,
        string calldata selfieProof
    ) external {
        _requestRehydration(docHash, rehydrationPublicKey, selfieProof);
    }

    function _requestRehydration(
        bytes32 docHash,
        string memory rehydrationPublicKey,
        string memory selfieProof
    ) internal {
        if (_publicationAuthor[docHash] == address(0)) revert NotPublished();
        if (bytes(rehydrationPublicKey).length == 0) revert EmptyPublicKey();
        if (_selfieRequired[docHash] && bytes(selfieProof).length == 0) revert EmptySelfieProof();
        emit RehydrationRequested(docHash, msg.sender, rehydrationPublicKey, selfieProof);
    }
}
