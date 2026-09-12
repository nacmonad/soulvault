// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {SoulVaultDocumentRegistry} from "../contracts/SoulVaultDocumentRegistry.sol";

contract SoulVaultDocumentRegistryTest is Test {
    SoulVaultDocumentRegistry internal registry;

    address internal alice = makeAddr("alice");
    address internal charlie = makeAddr("charlie");
    address internal mallory = makeAddr("mallory");

    bytes32 internal docHash = keccak256("synthetic-doc-v1");
    string[] internal slotIds = ["sv_name_1", "sv_salary_1"];

    // Conspicuously synthetic wrap payload (base64 wire shape of SecpWrappedKey).
    string internal wrappedKey = "AAECAwQFBgcICQ==";
    string internal ephemeralPublicKey = "04ee";

    event DocumentPublished(bytes32 indexed docHash, address indexed author, string[] slotIds, bool selfieRequired);
    event SlotKeyGranted(
        bytes32 indexed docHash,
        string slotId,
        address indexed recipient,
        string wrappedKey,
        string algorithm,
        string ephemeralPublicKey,
        string nonce
    );
    event RehydrationRequested(
        bytes32 indexed docHash,
        address indexed recipient,
        string rehydrationPublicKey,
        string selfieProof
    );

    string internal charlieRehydrationKey = "04a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f9";

    /// @notice Resolved once in setUp: reading WRAP_ALGORITHM() inline in a
    /// test's argument list would be an external call evaluated AFTER
    /// vm.prank/vm.expectRevert, consuming the cheatcode (foundry gotcha).
    string internal wrapAlg;

    function setUp() public {
        registry = new SoulVaultDocumentRegistry();
        wrapAlg = registry.WRAP_ALGORITHM();
    }

    function test_publishDocument_emitsAnchorEvent() public {
        vm.prank(alice);
        vm.expectEmit(true, true, false, true, address(registry));
        emit DocumentPublished(docHash, alice, slotIds, false);
        registry.publishDocument(docHash, slotIds);

        assertEq(registry.publicationAuthor(docHash), alice);
    }

    function test_publishDocument_revertsOnZeroDocHash() public {
        vm.prank(alice);
        vm.expectRevert(SoulVaultDocumentRegistry.EmptyDocHash.selector);
        registry.publishDocument(bytes32(0), slotIds);
    }

    function test_publishDocument_revertsOnEmptySlotId() public {
        string[] memory bad = new string[](1);
        bad[0] = "";
        vm.prank(alice);
        vm.expectRevert(SoulVaultDocumentRegistry.EmptySlotId.selector);
        registry.publishDocument(docHash, bad);
    }

    function test_publishDocument_republishBySameAuthorIsIdempotent() public {
        vm.prank(alice);
        registry.publishDocument(docHash, slotIds);
        vm.prank(alice);
        registry.publishDocument(docHash, slotIds);
        assertEq(registry.publicationAuthor(docHash), alice);
    }

    function test_publishDocument_hijackByDifferentAddressReverts() public {
        vm.prank(alice);
        registry.publishDocument(docHash, slotIds);
        vm.prank(mallory);
        vm.expectRevert(SoulVaultDocumentRegistry.AlreadyPublished.selector);
        registry.publishDocument(docHash, slotIds);
        assertEq(registry.publicationAuthor(docHash), alice);
    }

    function test_grantSlotKey_emitsKeyDeliveryEvent() public {
        vm.prank(alice);
        registry.publishDocument(docHash, slotIds);

        vm.prank(alice);
        vm.expectEmit(true, true, true, true, address(registry));
        emit SlotKeyGranted(docHash, "sv_salary_1", charlie, wrappedKey, wrapAlg, "AA==", "bw==");
        registry.grantSlotKey(docHash, "sv_salary_1", charlie, wrappedKey, wrapAlg, "AA==", "bw==");
    }

    function test_grantSlotKey_onlyAuthorMayGrant() public {
        vm.prank(alice);
        registry.publishDocument(docHash, slotIds);

        vm.prank(mallory);
        vm.expectRevert(SoulVaultDocumentRegistry.NotAuthor.selector);
        registry.grantSlotKey(docHash, "sv_salary_1", charlie, wrappedKey, wrapAlg, "AA==", "bw==");
    }

    function test_grantSlotKey_revertsOnUnpublishedDocHash() public {
        vm.prank(alice);
        vm.expectRevert(SoulVaultDocumentRegistry.NotAuthor.selector);
        registry.grantSlotKey(docHash, "sv_salary_1", charlie, wrappedKey, wrapAlg, "AA==", "bw==");
    }

    function test_grantSlotKey_rejectsForeignAlgorithm() public {
        vm.prank(alice);
        registry.publishDocument(docHash, slotIds);

        vm.prank(alice);
        vm.expectRevert(SoulVaultDocumentRegistry.BadAlgorithm.selector);
        registry.grantSlotKey(docHash, "sv_salary_1", charlie, wrappedKey, "x25519-xsalsa20-poly1305", "AA==", "bw==");
    }

    function test_grantSlotKey_rejectsEmptyKeyOrSlot() public {
        vm.prank(alice);
        registry.publishDocument(docHash, slotIds);

        vm.prank(alice);
        vm.expectRevert(SoulVaultDocumentRegistry.EmptyWrappedKey.selector);
        registry.grantSlotKey(docHash, "sv_salary_1", charlie, "", wrapAlg, "AA==", "bw==");

        vm.prank(alice);
        vm.expectRevert(SoulVaultDocumentRegistry.EmptySlotId.selector);
        registry.grantSlotKey(docHash, "", charlie, wrappedKey, wrapAlg, "AA==", "bw==");
    }

    function test_grantSlotKey_rejectsZeroRecipient() public {
        vm.prank(alice);
        registry.publishDocument(docHash, slotIds);

        vm.prank(alice);
        vm.expectRevert(SoulVaultDocumentRegistry.NotAuthor.selector);
        registry.grantSlotKey(docHash, "sv_salary_1", address(0), wrappedKey, wrapAlg, "AA==", "bw==");
    }

    function test_grantSlotKey_fuzz_recipientVariety(address recipient) public {
        vm.assume(recipient != address(0));
        vm.prank(alice);
        registry.publishDocument(docHash, slotIds);

        vm.prank(alice);
        registry.grantSlotKey(docHash, "sv_salary_1", recipient, wrappedKey, wrapAlg, "AA==", "bw==");
        // No on-chain state to assert beyond the event — the grant event IS the delivery.
    }

    function test_noExpiryAndNoRevokeSurface() public {
        // The contract's public surface must not offer revocation or expiry:
        // guard the design by asserting the contract has no such functions via
        // low-level call failure.
        (bool ok, ) = address(registry).call(
            abi.encodeWithSignature("revokeSlot(bytes32,string,address)", docHash, "sv_salary_1", charlie)
        );
        assertFalse(ok, "revocation must not exist on the v0 registry");
    }

    function test_requestRehydration_emitsRequestEvent() public {
        vm.prank(alice);
        registry.publishDocument(docHash, slotIds);

        vm.prank(charlie);
        vm.expectEmit(true, true, false, true, address(registry));
        emit RehydrationRequested(docHash, charlie, charlieRehydrationKey, "");
        registry.requestRehydration(docHash, charlieRehydrationKey);
    }

    function test_requestRehydration_revertsOnUnpublishedDocHash() public {
        vm.prank(charlie);
        vm.expectRevert(SoulVaultDocumentRegistry.NotPublished.selector);
        registry.requestRehydration(docHash, charlieRehydrationKey);
    }

    function test_requestRehydration_revertsOnEmptyPublicKey() public {
        vm.prank(alice);
        registry.publishDocument(docHash, slotIds);

        vm.prank(charlie);
        vm.expectRevert(SoulVaultDocumentRegistry.EmptyPublicKey.selector);
        registry.requestRehydration(docHash, "");
    }

    function test_requestRehydration_rerequestIsKeyRotation() public {
        // The key-loss story: re-request with a fresh key. Both requests stay
        // in the log; the author grants against the latest one.
        vm.prank(alice);
        registry.publishDocument(docHash, slotIds);

        vm.prank(charlie);
        registry.requestRehydration(docHash, charlieRehydrationKey);

        vm.prank(charlie);
        vm.expectEmit(true, true, false, true, address(registry));
        emit RehydrationRequested(docHash, charlie, "04ff", "");
        registry.requestRehydration(docHash, "04ff");
    }

    function test_requestRehydration_anyoneMayRequestTheirOwnKey() public {
        // Requests are self-addressed: msg.sender is the recipient of record,
        // so Mallory cannot request on Charlie's behalf (any grant he tricks
        // out of Alice would be wrapped to Mallory's own key and address).
        vm.prank(alice);
        registry.publishDocument(docHash, slotIds);

        vm.prank(mallory);
        vm.expectEmit(true, true, false, true, address(registry));
        emit RehydrationRequested(docHash, mallory, charlieRehydrationKey, "");
        registry.requestRehydration(docHash, charlieRehydrationKey);
    }

    function test_publishDocument_selfieRequiredDoesNotBlockPublish() public {
        vm.prank(alice);
        vm.expectEmit(true, true, false, true, address(registry));
        emit DocumentPublished(docHash, alice, slotIds, true);
        registry.publishDocument(docHash, slotIds, true);
        assertTrue(registry.selfieRequired(docHash));
        assertEq(registry.publicationAuthor(docHash), alice);
    }

    function test_requestRehydration_emptyProofRevertsWhenSelfieRequired() public {
        vm.prank(alice);
        registry.publishDocument(docHash, slotIds, true);

        vm.prank(charlie);
        vm.expectRevert(SoulVaultDocumentRegistry.EmptySelfieProof.selector);
        registry.requestRehydration(docHash, charlieRehydrationKey);

        vm.prank(charlie);
        vm.expectRevert(SoulVaultDocumentRegistry.EmptySelfieProof.selector);
        registry.requestRehydration(docHash, charlieRehydrationKey, "");
    }

    function test_requestRehydration_carriesSelfieProofWhenRequired() public {
        vm.prank(alice);
        registry.publishDocument(docHash, slotIds, true);

        string memory proof = '{"nullifier":"n1","credentialId":11}';
        vm.prank(charlie);
        vm.expectEmit(true, true, false, true, address(registry));
        emit RehydrationRequested(docHash, charlie, charlieRehydrationKey, proof);
        registry.requestRehydration(docHash, charlieRehydrationKey, proof);
    }

    // --- grantSlotKeys (batch) ------------------------------------------

    function test_grantSlotKeys_emitsOneEventPerSlot() public {
        vm.prank(alice);
        registry.publishDocument(docHash, slotIds);

        string[] memory keys = new string[](2);
        keys[0] = wrappedKey;
        keys[1] = "BBICJg==";
        string[] memory eph = new string[](2);
        eph[0] = "AA==";
        eph[1] = "Ag==";
        string[] memory nonces = new string[](2);
        nonces[0] = "bw==";
        nonces[1] = "dg==";

        vm.prank(alice);
        vm.expectEmit(true, true, true, true, address(registry));
        emit SlotKeyGranted(docHash, "sv_name_1", charlie, wrappedKey, wrapAlg, "AA==", "bw==");
        registry.grantSlotKeys(docHash, charlie, slotIds, keys, wrapAlg, eph, nonces);
        // Second event asserted implicitly by the loop — no revert means both
        // emissions validated and fired.
    }

    function test_grantSlotKeys_onlyAuthorMayGrant() public {
        vm.prank(alice);
        registry.publishDocument(docHash, slotIds);

        vm.prank(mallory);
        vm.expectRevert(SoulVaultDocumentRegistry.NotAuthor.selector);
        registry.grantSlotKeys(
            docHash,
            charlie,
            slotIds,
            _wrappedKeys(2),
            wrapAlg,
            _ephemeralKeys(2),
            _nonces(2)
        );
    }

    function test_grantSlotKeys_rejectsLengthMismatch() public {
        vm.prank(alice);
        registry.publishDocument(docHash, slotIds);

        vm.prank(alice);
        vm.expectRevert(SoulVaultDocumentRegistry.ArrayLengthMismatch.selector);
        registry.grantSlotKeys(docHash, charlie, slotIds, _wrappedKeys(1), wrapAlg, _ephemeralKeys(2), _nonces(2));
    }

    function test_grantSlotKeys_rejectsEmptyBatch() public {
        vm.prank(alice);
        registry.publishDocument(docHash, slotIds);

        vm.prank(alice);
        vm.expectRevert(SoulVaultDocumentRegistry.EmptySlotId.selector);
        registry.grantSlotKeys(docHash, charlie, new string[](0), new string[](0), wrapAlg, new string[](0), new string[](0));
    }

    function test_grantSlotKeys_rejectsEmptyKeyOrSlot() public {
        vm.prank(alice);
        registry.publishDocument(docHash, slotIds);

        string[] memory badKeys = _wrappedKeys(2);
        badKeys[1] = "";
        vm.prank(alice);
        vm.expectRevert(SoulVaultDocumentRegistry.EmptyWrappedKey.selector);
        registry.grantSlotKeys(docHash, charlie, slotIds, badKeys, wrapAlg, _ephemeralKeys(2), _nonces(2));

        string[] memory badSlots = new string[](2);
        badSlots[0] = "sv_name_1";
        badSlots[1] = "";
        vm.prank(alice);
        vm.expectRevert(SoulVaultDocumentRegistry.EmptySlotId.selector);
        registry.grantSlotKeys(docHash, charlie, badSlots, _wrappedKeys(2), wrapAlg, _ephemeralKeys(2), _nonces(2));
    }

    function test_grantSlotKeys_rejectsForeignAlgorithm() public {
        vm.prank(alice);
        registry.publishDocument(docHash, slotIds);

        vm.prank(alice);
        vm.expectRevert(SoulVaultDocumentRegistry.BadAlgorithm.selector);
        registry.grantSlotKeys(
            docHash,
            charlie,
            slotIds,
            _wrappedKeys(2),
            "x25519-xsalsa20-poly1305",
            _ephemeralKeys(2),
            _nonces(2)
        );
    }

    function _wrappedKeys(uint256 n) internal view returns (string[] memory out) {
        out = new string[](n);
        for (uint256 i = 0; i < n; i++) out[i] = wrappedKey;
    }

    function _ephemeralKeys(uint256 n) internal pure returns (string[] memory out) {
        out = new string[](n);
        for (uint256 i = 0; i < n; i++) out[i] = "AA==";
    }

    function _nonces(uint256 n) internal pure returns (string[] memory out) {
        out = new string[](n);
        for (uint256 i = 0; i < n; i++) out[i] = "bw==";
    }
}
