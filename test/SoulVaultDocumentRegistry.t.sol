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
    event RehydrationRequested(bytes32 indexed docHash, address indexed recipient, string rehydrationPublicKey);

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
        emit DocumentPublished(docHash, alice, slotIds);
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
        emit RehydrationRequested(docHash, charlie, charlieRehydrationKey);
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
        emit RehydrationRequested(docHash, charlie, "04ff");
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
        emit RehydrationRequested(docHash, mallory, charlieRehydrationKey);
        registry.requestRehydration(docHash, charlieRehydrationKey);
    }
}
