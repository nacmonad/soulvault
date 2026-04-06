// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {SoulVaultSwarm} from "../contracts/SoulVaultSwarm.sol";
import {SoulVaultOrganization} from "../contracts/SoulVaultOrganization.sol";

/// @dev Minimal mock that satisfies the `orgPaused()` call in the swarm's `whenNotPaused` modifier.
contract MockOrganization {
    bool public orgPaused;
    function setOrgPaused(bool v) external { orgPaused = v; }
}

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

    // --- Organization binding ---

    MockOrganization internal mockOrg;

    function _deployMockOrg() internal returns (address) {
        if (address(mockOrg) == address(0)) {
            mockOrg = new MockOrganization();
        }
        return address(mockOrg);
    }

    function testSetOrganizationEmitsAndReturnsValue() public {
        address mo = _deployMockOrg();
        swarm.setOrganization(mo);
        assertEq(swarm.organization(), mo);
    }

    function testSetOrganizationIsReSettable() public {
        address mo = _deployMockOrg();
        swarm.setOrganization(mo);
        MockOrganization mo2 = new MockOrganization();
        swarm.setOrganization(address(mo2));
        assertEq(swarm.organization(), address(mo2));
    }

    function testSetOrganizationRevertsOnZeroAddress() public {
        vm.expectRevert(SoulVaultSwarm.ZeroAddress.selector);
        swarm.setOrganization(address(0));
    }

    function testOnlyOwnerCanSetOrganization() public {
        address mo = _deployMockOrg();
        vm.prank(alice);
        vm.expectRevert(SoulVaultSwarm.NotOwner.selector);
        swarm.setOrganization(mo);
    }

    // --- Fund request lifecycle ---

    function _setMockOrg() internal returns (address) {
        address mo = _deployMockOrg();
        swarm.setOrganization(mo);
        return mo;
    }

    function testRequestFundsHappyPath() public {
        _approveAliceAndRotateToEpoch1();
        _setMockOrg();

        vm.prank(alice);
        uint256 fundId = swarm.requestFunds(1 ether, "ops gas");

        assertEq(fundId, 1);
        assertEq(swarm.nextFundRequestId(), 2);
        SoulVaultSwarm.FundRequest memory req = swarm.getFundRequest(fundId);
        assertEq(req.requester, alice);
        assertEq(req.amount, 1 ether);
        assertEq(req.reason, "ops gas");
        assertEq(req.status, 0 /* PENDING */);
        assertGt(req.createdAt, 0);
        assertEq(req.resolvedAt, 0);
    }

    function testRequestFundsRevertsForNonMember() public {
        _setMockOrg();
        vm.prank(bob);
        vm.expectRevert(SoulVaultSwarm.NotActiveMember.selector);
        swarm.requestFunds(1 ether, "nope");
    }

    function testRequestFundsRevertsWhenOrganizationNotSet() public {
        _approveAliceAndRotateToEpoch1();
        vm.prank(alice);
        vm.expectRevert(SoulVaultSwarm.OrganizationNotSet.selector);
        swarm.requestFunds(1 ether, "nope");
    }

    function testRequestFundsRevertsOnZeroAmount() public {
        _approveAliceAndRotateToEpoch1();
        _setMockOrg();
        vm.prank(alice);
        vm.expectRevert(SoulVaultSwarm.ZeroAmount.selector);
        swarm.requestFunds(0, "nope");
    }

    function testCancelFundRequestRequesterOnly() public {
        _approveAliceAndRotateToEpoch1();
        _setMockOrg();

        vm.prank(alice);
        uint256 fundId = swarm.requestFunds(1 ether, "ops gas");

        vm.prank(bob);
        vm.expectRevert(SoulVaultSwarm.NotFundRequester.selector);
        swarm.cancelFundRequest(fundId);

        vm.prank(alice);
        swarm.cancelFundRequest(fundId);
        SoulVaultSwarm.FundRequest memory req = swarm.getFundRequest(fundId);
        assertEq(req.status, 3 /* CANCELLED */);
        assertGt(req.resolvedAt, 0);
    }

    function testMarkFundRequestApprovedOnlyByOrganization() public {
        _approveAliceAndRotateToEpoch1();
        address mo = _setMockOrg();

        vm.prank(alice);
        uint256 fundId = swarm.requestFunds(1 ether, "ops gas");

        vm.expectRevert(SoulVaultSwarm.NotOrganization.selector);
        swarm.markFundRequestApproved(fundId);

        vm.prank(mo);
        swarm.markFundRequestApproved(fundId);
        SoulVaultSwarm.FundRequest memory req = swarm.getFundRequest(fundId);
        assertEq(req.status, 1 /* APPROVED */);
        assertGt(req.resolvedAt, 0);
    }

    function testMarkFundRequestRejectedOnlyByOrganization() public {
        _approveAliceAndRotateToEpoch1();
        address mo = _setMockOrg();

        vm.prank(alice);
        uint256 fundId = swarm.requestFunds(1 ether, "ops gas");

        vm.prank(alice);
        vm.expectRevert(SoulVaultSwarm.NotOrganization.selector);
        swarm.markFundRequestRejected(fundId, "no");

        vm.prank(mo);
        swarm.markFundRequestRejected(fundId, "budget exhausted");
        SoulVaultSwarm.FundRequest memory req = swarm.getFundRequest(fundId);
        assertEq(req.status, 2 /* REJECTED */);
    }

    function testMarkApprovedRevertsIfNotPending() public {
        _approveAliceAndRotateToEpoch1();
        address mo = _setMockOrg();

        vm.prank(alice);
        uint256 fundId = swarm.requestFunds(1 ether, "ops gas");

        vm.prank(alice);
        swarm.cancelFundRequest(fundId);

        vm.prank(mo);
        vm.expectRevert(SoulVaultSwarm.InvalidFundRequestState.selector);
        swarm.markFundRequestApproved(fundId);
    }

    function testFundRequestIdsAreIndependentOfJoinRequestIds() public {
        vm.prank(alice);
        uint256 joinId = swarm.requestJoin(alicePubkey, "pub:alice", "meta:alice");
        swarm.approveJoin(joinId);
        assertEq(joinId, 1);

        _setMockOrg();

        vm.prank(alice);
        uint256 fundId = swarm.requestFunds(1 ether, "ops");
        assertEq(fundId, 1);
    }

    function testRequestFundsBlockedWhenPaused() public {
        _approveAliceAndRotateToEpoch1();
        _setMockOrg();
        swarm.pause();
        vm.prank(alice);
        vm.expectRevert(SoulVaultSwarm.PausedError.selector);
        swarm.requestFunds(1 ether, "ops");
    }

    // --- Org-level pause propagation ---

    function testOrgPauseBlocksSwarmOps() public {
        SoulVaultOrganization realOrg = new SoulVaultOrganization();
        SoulVaultSwarm orgSwarm = new SoulVaultSwarm();
        realOrg.registerSwarm(address(orgSwarm));
        orgSwarm.setOrganization(address(realOrg));

        vm.prank(alice);
        uint256 joinId = orgSwarm.requestJoin(alicePubkey, "pub:alice", "meta:alice");
        orgSwarm.approveJoin(joinId);

        realOrg.pauseOrg();

        vm.prank(alice);
        vm.expectRevert(SoulVaultSwarm.OrgPausedError.selector);
        orgSwarm.requestFunds(1 ether, "blocked");
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
