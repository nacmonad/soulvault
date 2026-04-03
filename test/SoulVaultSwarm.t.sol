// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {SoulVaultSwarm} from "../contracts/SoulVaultSwarm.sol";

contract SoulVaultSwarmTest is Test {
    SoulVaultSwarm internal swarm;

    address internal owner = address(this);
    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);
    address internal carol = address(0xCA701);

    bytes internal alicePubkey = hex"010203";
    bytes internal bobPubkey = hex"040506";

    function setUp() public {
        swarm = new SoulVaultSwarm();
    }

    function testRequestJoinAndApproveActivatesMember() public {
        vm.prank(alice);
        uint256 requestId = swarm.requestJoin(alicePubkey, "pub:alice", "meta:alice");

        swarm.approveJoin(requestId);

        SoulVaultSwarm.Member memory member = swarm.getMember(alice);
        assertTrue(member.active);
        assertEq(member.pubkey, alicePubkey);
        assertEq(member.joinedEpoch, 0);
        assertEq(swarm.memberCount(), 1);
        assertEq(swarm.membershipVersion(), 1);
    }

    function testOnlyOwnerCanApproveJoin() public {
        vm.prank(alice);
        uint256 requestId = swarm.requestJoin(alicePubkey, "pub:alice", "meta:alice");

        vm.prank(bob);
        vm.expectRevert(SoulVaultSwarm.NotOwner.selector);
        swarm.approveJoin(requestId);
    }

    function testRotateEpochRevertsWhenMembershipVersionChanged() public {
        vm.expectRevert(SoulVaultSwarm.MembershipChanged.selector);
        swarm.rotateEpoch(1, "bundle:1", keccak256("bundle"), 999);
    }

    function testRotateEpochSucceedsWithExpectedMembershipVersion() public {
        swarm.rotateEpoch(1, "bundle:1", keccak256("bundle"), 0);
        assertEq(swarm.currentEpoch(), 1);
    }

    function testPostMessageRequiresMonotonicSequence() public {
        _approveAliceAndRotateToEpoch1();

        vm.prank(alice);
        swarm.postMessage(bob, "status", 1, 1, "payload:1", keccak256("payload1"), 3600);

        vm.prank(alice);
        vm.expectRevert(SoulVaultSwarm.InvalidSequence.selector);
        swarm.postMessage(bob, "status", 1, 1, "payload:2", keccak256("payload2"), 3600);
    }

    function testOnlyOwnerCanRequestBackup() public {
        _approveAliceAndRotateToEpoch1();

        vm.prank(alice);
        vm.expectRevert(SoulVaultSwarm.NotOwner.selector);
        swarm.requestBackup(1, "checkpoint", "target:all", uint64(block.timestamp + 1 hours));
    }

    function testOwnerCanRequestBackup() public {
        _approveAliceAndRotateToEpoch1();
        swarm.requestBackup(1, "checkpoint", "target:all", uint64(block.timestamp + 1 hours));
    }

    function testMemberCanPublishOwnFileMapping() public {
        _approveAliceAndRotateToEpoch1();

        vm.prank(alice);
        swarm.updateMemberFileMapping(
            alice,
            "0g://artifact-1",
            keccak256("merkle"),
            keccak256("tx"),
            keccak256("manifest"),
            1
        );

        SoulVaultSwarm.MemberFileMapping memory mapping_ = swarm.getMemberFileMapping(alice);

        assertEq(mapping_.storageLocator, "0g://artifact-1");
        assertEq(mapping_.merkleRoot, keccak256("merkle"));
        assertEq(mapping_.publishTxHash, keccak256("tx"));
        assertEq(mapping_.manifestHash, keccak256("manifest"));
        assertEq(mapping_.epoch, 1);
        assertGt(mapping_.updatedAt, 0);
    }

    function testOwnerCanPublishForMember() public {
        _approveAliceAndRotateToEpoch1();

        swarm.updateMemberFileMapping(
            alice,
            "0g://artifact-owner",
            keccak256("merkle-owner"),
            keccak256("tx-owner"),
            keccak256("manifest-owner"),
            1
        );

        SoulVaultSwarm.MemberFileMapping memory mapping_ = swarm.getMemberFileMapping(alice);
        assertEq(mapping_.storageLocator, "0g://artifact-owner");
    }

    function testNonOwnerCannotPublishForAnotherMember() public {
        _approveAliceAndRotateToEpoch1();
        _approveBob();

        vm.prank(bob);
        vm.expectRevert(SoulVaultSwarm.UnauthorizedPublisher.selector);
        swarm.updateMemberFileMapping(
            alice,
            "0g://artifact-bad",
            keccak256("merkle-bad"),
            keccak256("tx-bad"),
            keccak256("manifest-bad"),
            1
        );
    }

    function _approveAliceAndRotateToEpoch1() internal {
        vm.prank(alice);
        uint256 requestId = swarm.requestJoin(alicePubkey, "pub:alice", "meta:alice");
        swarm.approveJoin(requestId);
        swarm.rotateEpoch(1, "bundle:1", keccak256("bundle"), swarm.membershipVersion());
    }

    function _approveBob() internal {
        vm.prank(bob);
        uint256 requestId = swarm.requestJoin(bobPubkey, "pub:bob", "meta:bob");
        swarm.approveJoin(requestId);
    }
}
