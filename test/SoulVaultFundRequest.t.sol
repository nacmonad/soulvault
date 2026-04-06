// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {SoulVaultSwarm} from "../contracts/SoulVaultSwarm.sol";
import {SoulVaultOrganization} from "../contracts/SoulVaultOrganization.sol";
import {ISoulVaultSwarm} from "../contracts/ISoulVaultSwarm.sol";

/// @notice End-to-end integration between the real SoulVaultSwarm and the real SoulVaultOrganization.
/// @dev The swarm deployer is also the organization deployer here (single operator scenario). The
///      interesting cases (swarm paused, org paused, rebind mid-flow, mutual-consent failure,
///      multi-swarm) are covered explicitly.
contract SoulVaultFundRequestTest is Test {
    SoulVaultSwarm internal swarm;
    SoulVaultOrganization internal org;

    address internal deployer = address(this);
    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);

    bytes internal alicePubkey = hex"010203";
    bytes internal bobPubkey = hex"040506";

    function setUp() public {
        swarm = new SoulVaultSwarm();
        org = new SoulVaultOrganization();

        // Register the swarm on the organization.
        org.registerSwarm(address(swarm));

        // Wire the swarm to the organization (owner = this test contract).
        swarm.setOrganization(address(org));

        // Bootstrap alice as an active member so she can requestFunds.
        vm.prank(alice);
        uint256 joinId = swarm.requestJoin(alicePubkey, "pub:alice", "meta:alice");
        swarm.approveJoin(joinId);

        // Seed the organization with 10 ether.
        vm.deal(address(this), 100 ether);
        (bool ok, ) = address(org).call{value: 10 ether}("");
        require(ok, "seed failed");
    }

    // --- Happy path ---

    function testRequestApproveReleasesFunds() public {
        uint256 aliceBefore = alice.balance;

        vm.prank(alice);
        uint256 reqId = swarm.requestFunds(2 ether, "ops gas");

        org.approveFundRequest(address(swarm), reqId);

        assertEq(alice.balance, aliceBefore + 2 ether);
        assertEq(org.balance(), 8 ether);

        ISoulVaultSwarm.FundRequest memory req = swarm.getFundRequest(reqId);
        assertEq(req.status, 1 /* APPROVED */);
        assertGt(req.resolvedAt, 0);
    }

    // --- Reject path ---

    function testRequestRejectDoesNotMoveFunds() public {
        uint256 aliceBefore = alice.balance;
        uint256 orgBefore = org.balance();

        vm.prank(alice);
        uint256 reqId = swarm.requestFunds(2 ether, "ops gas");

        org.rejectFundRequest(address(swarm), reqId, "no budget");

        assertEq(alice.balance, aliceBefore);
        assertEq(org.balance(), orgBefore);

        ISoulVaultSwarm.FundRequest memory req = swarm.getFundRequest(reqId);
        assertEq(req.status, 2 /* REJECTED */);
    }

    // --- Cancel path ---

    function testCancelBlocksSubsequentApproval() public {
        vm.prank(alice);
        uint256 reqId = swarm.requestFunds(2 ether, "ops gas");

        vm.prank(alice);
        swarm.cancelFundRequest(reqId);

        vm.expectRevert(SoulVaultOrganization.InvalidRequestState.selector);
        org.approveFundRequest(address(swarm), reqId);
    }

    // --- Non-member cannot request ---

    function testNonMemberCannotRequest() public {
        vm.prank(bob);
        vm.expectRevert(SoulVaultSwarm.NotActiveMember.selector);
        swarm.requestFunds(1 ether, "nope");
    }

    // --- Swarm paused mid-flow ---

    function testSwarmPausedBlocksApproval() public {
        vm.prank(alice);
        uint256 reqId = swarm.requestFunds(2 ether, "ops gas");

        swarm.pause();

        vm.expectRevert(SoulVaultSwarm.PausedError.selector);
        org.approveFundRequest(address(swarm), reqId);

        assertEq(org.balance(), 10 ether);
        ISoulVaultSwarm.FundRequest memory req = swarm.getFundRequest(reqId);
        assertEq(req.status, 0 /* PENDING */);
    }

    // --- Org-level pause blocks approval ---

    function testOrgPausedBlocksApproval() public {
        vm.prank(alice);
        uint256 reqId = swarm.requestFunds(2 ether, "ops gas");

        org.pauseOrg();

        vm.expectRevert(SoulVaultOrganization.OrgIsPaused.selector);
        org.approveFundRequest(address(swarm), reqId);

        assertEq(org.balance(), 10 ether);
        ISoulVaultSwarm.FundRequest memory req = swarm.getFundRequest(reqId);
        assertEq(req.status, 0 /* PENDING */);
    }

    // --- Org-level pause propagates to swarm operations ---

    function testOrgPauseBlocksSwarmRequestFunds() public {
        org.pauseOrg();

        vm.prank(alice);
        vm.expectRevert(SoulVaultSwarm.OrgPausedError.selector);
        swarm.requestFunds(1 ether, "blocked");
    }

    function testOrgPauseBlocksSwarmJoin() public {
        org.pauseOrg();

        vm.prank(bob);
        vm.expectRevert(SoulVaultSwarm.OrgPausedError.selector);
        swarm.requestJoin(bobPubkey, "pub:bob", "meta:bob");
    }

    function testOrgUnpauseResumesSwarmOps() public {
        org.pauseOrg();
        org.unpauseOrg();

        vm.prank(alice);
        uint256 reqId = swarm.requestFunds(1 ether, "resumed");
        assertGt(reqId, 0);
    }

    // --- Rebind mid-flow ---

    function testRebindMidFlowOrphansOldOrg() public {
        vm.prank(alice);
        uint256 reqId = swarm.requestFunds(1 ether, "ops gas");

        SoulVaultOrganization org2 = new SoulVaultOrganization();
        org2.registerSwarm(address(swarm));
        vm.deal(address(this), 10 ether);
        (bool ok2, ) = address(org2).call{value: 5 ether}("");
        require(ok2, "org2 seed failed");
        swarm.setOrganization(address(org2));

        // Original org can no longer approve — swarm not pointing at it.
        vm.expectRevert(SoulVaultOrganization.SwarmOrganizationMismatch.selector);
        org.approveFundRequest(address(swarm), reqId);

        // New org CAN approve the pending request.
        uint256 aliceBefore = alice.balance;
        org2.approveFundRequest(address(swarm), reqId);
        assertEq(alice.balance, aliceBefore + 1 ether);
    }

    // --- Insufficient balance ---

    function testInsufficientBalanceKeepsRequestPending() public {
        vm.prank(alice);
        uint256 reqId = swarm.requestFunds(100 ether, "too much");

        vm.expectRevert(SoulVaultOrganization.InsufficientBalance.selector);
        org.approveFundRequest(address(swarm), reqId);

        ISoulVaultSwarm.FundRequest memory req = swarm.getFundRequest(reqId);
        assertEq(req.status, 0 /* PENDING */);
    }

    // --- Multi-swarm sharing one organization ---

    function testMultipleSwarmsOneOrganization() public {
        SoulVaultSwarm swarm2 = new SoulVaultSwarm();
        org.registerSwarm(address(swarm2));
        swarm2.setOrganization(address(org));

        vm.prank(bob);
        uint256 joinId = swarm2.requestJoin(bobPubkey, "pub:bob", "meta:bob");
        swarm2.approveJoin(joinId);

        vm.prank(alice);
        uint256 reqA = swarm.requestFunds(1 ether, "ops A");
        vm.prank(bob);
        uint256 reqB = swarm2.requestFunds(2 ether, "ops B");

        uint256 aliceBefore = alice.balance;
        uint256 bobBefore = bob.balance;

        org.approveFundRequest(address(swarm), reqA);
        org.approveFundRequest(address(swarm2), reqB);

        assertEq(alice.balance, aliceBefore + 1 ether);
        assertEq(bob.balance, bobBefore + 2 ether);
        assertEq(org.balance(), 7 ether);
    }
}
