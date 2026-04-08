// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {SoulVaultSwarm} from "../contracts/SoulVaultSwarm.sol";
import {SoulVaultTreasury} from "../contracts/SoulVaultTreasury.sol";
import {ISoulVaultSwarm} from "../contracts/ISoulVaultSwarm.sol";

/// @notice End-to-end integration between the real SoulVaultSwarm and the real SoulVaultTreasury.
/// @dev The swarm deployer is also the treasury deployer here (single operator scenario). The
///      interesting cases (swarm paused, rebind mid-flow, mutual-consent failure, multi-swarm)
///      are covered explicitly.
contract SoulVaultFundRequestTest is Test {
    SoulVaultSwarm internal swarm;
    SoulVaultTreasury internal treasury;

    address internal owner = address(this);
    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);

    bytes internal alicePubkey = hex"010203";
    bytes internal bobPubkey = hex"040506";

    function setUp() public {
        // Deploy the treasury first so the swarm can be born already bound to it
        // via the new constructor parameter. The existing `setTreasury` path is still
        // exercised by the multi-swarm sharing test below.
        treasury = new SoulVaultTreasury();
        swarm = new SoulVaultSwarm(address(treasury));

        // Bootstrap alice as an active member so she can requestFunds.
        vm.prank(alice);
        uint256 joinId = swarm.requestJoin(alicePubkey, "pub:alice", "meta:alice");
        swarm.approveJoin(joinId);

        // Seed the treasury with 10 ether.
        vm.deal(address(this), 100 ether);
        (bool ok, ) = address(treasury).call{value: 10 ether}("");
        require(ok, "seed failed");
    }

    // --- Happy path ---

    function testRequestApproveReleasesFunds() public {
        uint256 aliceBefore = alice.balance;

        vm.prank(alice);
        uint256 reqId = swarm.requestFunds(2 ether, "ops gas");

        treasury.approveFundRequest(address(swarm), reqId);

        assertEq(alice.balance, aliceBefore + 2 ether);
        assertEq(treasury.balance(), 8 ether);

        ISoulVaultSwarm.FundRequest memory req = swarm.getFundRequest(reqId);
        assertEq(req.status, 1 /* APPROVED */);
        assertGt(req.resolvedAt, 0);
    }

    // --- Reject path ---

    function testRequestRejectDoesNotMoveFunds() public {
        uint256 aliceBefore = alice.balance;
        uint256 treasuryBefore = treasury.balance();

        vm.prank(alice);
        uint256 reqId = swarm.requestFunds(2 ether, "ops gas");

        treasury.rejectFundRequest(address(swarm), reqId, "no budget");

        assertEq(alice.balance, aliceBefore);
        assertEq(treasury.balance(), treasuryBefore);

        ISoulVaultSwarm.FundRequest memory req = swarm.getFundRequest(reqId);
        assertEq(req.status, 2 /* REJECTED */);
    }

    // --- Cancel path ---

    function testCancelBlocksSubsequentApproval() public {
        vm.prank(alice);
        uint256 reqId = swarm.requestFunds(2 ether, "ops gas");

        vm.prank(alice);
        swarm.cancelFundRequest(reqId);

        // Treasury reads the swarm's request state first and short-circuits on its own
        // InvalidRequestState check before it ever calls into the swarm — so this is the
        // treasury's error, not the swarm's.
        vm.expectRevert(SoulVaultTreasury.InvalidRequestState.selector);
        treasury.approveFundRequest(address(swarm), reqId);
    }

    // --- Non-member cannot request ---

    function testNonMemberCannotRequest() public {
        vm.prank(bob);
        vm.expectRevert(SoulVaultSwarm.NotActiveMember.selector);
        swarm.requestFunds(1 ether, "nope");
    }

    // --- Swarm paused mid-flow ---

    function testPausedBlocksApproval() public {
        vm.prank(alice);
        uint256 reqId = swarm.requestFunds(2 ether, "ops gas");

        swarm.pause();

        vm.expectRevert(SoulVaultSwarm.PausedError.selector);
        treasury.approveFundRequest(address(swarm), reqId);

        // Treasury state unchanged, swarm state still pending
        assertEq(treasury.balance(), 10 ether);
        ISoulVaultSwarm.FundRequest memory req = swarm.getFundRequest(reqId);
        assertEq(req.status, 0 /* PENDING */);
    }

    // --- Rebind mid-flow ---

    function testRebindMidFlowOrphansOldTreasury() public {
        // Alice files a request against treasury-1.
        vm.prank(alice);
        uint256 reqId = swarm.requestFunds(1 ether, "ops gas");

        // Swarm owner rebinds to a brand-new treasury-2.
        SoulVaultTreasury treasury2 = new SoulVaultTreasury();
        vm.deal(address(this), 10 ether);
        (bool ok2, ) = address(treasury2).call{value: 5 ether}("");
        require(ok2, "treasury2 seed failed");
        swarm.setTreasury(address(treasury2));

        // Original treasury can no longer approve — mutual consent fails.
        vm.expectRevert(SoulVaultTreasury.SwarmTreasuryMismatch.selector);
        treasury.approveFundRequest(address(swarm), reqId);

        // New treasury CAN approve the pending request because the status is still PENDING
        // on the swarm and the mutual-consent check now points at treasury2.
        uint256 aliceBefore = alice.balance;
        treasury2.approveFundRequest(address(swarm), reqId);
        assertEq(alice.balance, aliceBefore + 1 ether);
    }

    // --- Insufficient balance on treasury ---

    function testInsufficientBalanceKeepsRequestPending() public {
        vm.prank(alice);
        uint256 reqId = swarm.requestFunds(100 ether, "too much");

        vm.expectRevert(SoulVaultTreasury.InsufficientBalance.selector);
        treasury.approveFundRequest(address(swarm), reqId);

        // Atomic revert — swarm-side status stays PENDING.
        ISoulVaultSwarm.FundRequest memory req = swarm.getFundRequest(reqId);
        assertEq(req.status, 0 /* PENDING */);
    }

    // --- Multi-swarm sharing one treasury ---

    function testMultipleSwarmsOneTreasury() public {
        // Deploy a second swarm. Use the legacy post-construction setTreasury path on
        // purpose here so we still exercise it (the first swarm in setUp() now uses the
        // constructor path).
        SoulVaultSwarm swarm2 = new SoulVaultSwarm(address(0));
        swarm2.setTreasury(address(treasury));

        // Bootstrap bob as a member of swarm2.
        vm.prank(bob);
        uint256 joinId = swarm2.requestJoin(bobPubkey, "pub:bob", "meta:bob");
        swarm2.approveJoin(joinId);

        // Alice requests from swarm1, bob requests from swarm2.
        vm.prank(alice);
        uint256 reqA = swarm.requestFunds(1 ether, "ops A");
        vm.prank(bob);
        uint256 reqB = swarm2.requestFunds(2 ether, "ops B");

        uint256 aliceBefore = alice.balance;
        uint256 bobBefore = bob.balance;

        treasury.approveFundRequest(address(swarm), reqA);
        treasury.approveFundRequest(address(swarm2), reqB);

        assertEq(alice.balance, aliceBefore + 1 ether);
        assertEq(bob.balance, bobBefore + 2 ether);
        assertEq(treasury.balance(), 7 ether);
    }
}
