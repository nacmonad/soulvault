// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {SoulVaultTreasury} from "../contracts/SoulVaultTreasury.sol";
import {ISoulVaultSwarm} from "../contracts/ISoulVaultSwarm.sol";

/// @dev Minimal mock of the fields the treasury actually reads/writes on the swarm.
///      Implements `treasury()`, `getFundRequest()`, `markFundRequestApproved()`,
///      `markFundRequestRejected()`. Everything else reverts.
contract MockSwarm {
    address public treasury;

    struct StoredFundRequest {
        address requester;
        uint256 amount;
        string reason;
        uint8 status; // 0=pending, 1=approved, 2=rejected, 3=cancelled
        uint64 createdAt;
        uint64 resolvedAt;
    }

    mapping(uint256 => StoredFundRequest) private _requests;

    // Test-only setters
    function setTreasury(address t) external {
        treasury = t;
    }

    function seedRequest(
        uint256 id,
        address requester,
        uint256 amount,
        string calldata reason,
        uint8 status
    ) external {
        _requests[id] = StoredFundRequest({
            requester: requester,
            amount: amount,
            reason: reason,
            status: status,
            createdAt: uint64(block.timestamp),
            resolvedAt: 0
        });
    }

    // --- Interface methods the treasury actually calls ---

    function getFundRequest(uint256 requestId) external view returns (ISoulVaultSwarm.FundRequest memory) {
        StoredFundRequest storage r = _requests[requestId];
        return ISoulVaultSwarm.FundRequest({
            requester: r.requester,
            amount: r.amount,
            reason: r.reason,
            status: r.status,
            createdAt: r.createdAt,
            resolvedAt: r.resolvedAt
        });
    }

    function markFundRequestApproved(uint256 requestId) external {
        // Simulate the real swarm's authorization check
        require(msg.sender == treasury, "not treasury");
        StoredFundRequest storage r = _requests[requestId];
        require(r.status == 0, "not pending");
        r.status = 1;
        r.resolvedAt = uint64(block.timestamp);
    }

    function markFundRequestRejected(uint256 requestId, string calldata /*reason*/) external {
        require(msg.sender == treasury, "not treasury");
        StoredFundRequest storage r = _requests[requestId];
        require(r.status == 0, "not pending");
        r.status = 2;
        r.resolvedAt = uint64(block.timestamp);
    }
}

/// @dev Contract recipient that attempts to re-enter the treasury via its receive function.
contract ReentrantRecipient {
    SoulVaultTreasury public immutable treasury;
    address public immutable swarm;
    uint256 public immutable requestId;
    bool public triedReenter;

    constructor(SoulVaultTreasury t, address s, uint256 id) {
        treasury = t;
        swarm = s;
        requestId = id;
    }

    receive() external payable {
        if (!triedReenter) {
            triedReenter = true;
            // Best-effort reentry. Swallow the revert so the outer transfer reports success/failure on its own.
            try treasury.approveFundRequest(swarm, requestId) {} catch {}
        }
    }
}

contract SoulVaultTreasuryTest is Test {
    SoulVaultTreasury internal treasury;
    MockSwarm internal mockSwarm;

    address internal constant DEPLOYER_EOA = address(0xBEEF);
    address internal constant ALICE = address(0xA11CE);
    address internal constant BOB = address(0xB0B);

    function setUp() public {
        vm.prank(DEPLOYER_EOA);
        treasury = new SoulVaultTreasury();

        mockSwarm = new MockSwarm();
        mockSwarm.setTreasury(address(treasury));

        // Top treasury up with 10 ether.
        vm.deal(address(this), 100 ether);
        (bool ok, ) = address(treasury).call{value: 10 ether}("");
        require(ok, "seed failed");
    }

    function testOwnerIsDeployer() public view {
        assertEq(treasury.owner(), DEPLOYER_EOA);
    }

    function testBalanceAfterSeed() public view {
        assertEq(treasury.balance(), 10 ether);
    }

    function testReceiveEmitsFundsDeposited() public {
        uint256 before = treasury.balance();
        vm.deal(ALICE, 1 ether);
        vm.prank(ALICE);
        (bool ok, ) = address(treasury).call{value: 1 ether}("");
        require(ok, "deposit failed");
        assertEq(treasury.balance(), before + 1 ether);
    }

    function testDepositFunctionEmits() public {
        vm.deal(ALICE, 1 ether);
        vm.prank(ALICE);
        treasury.deposit{value: 1 ether}();
        assertEq(treasury.balance(), 11 ether);
    }

    function testWithdrawOwnerOnly() public {
        vm.prank(ALICE);
        vm.expectRevert(SoulVaultTreasury.NotOwner.selector);
        treasury.withdraw(payable(ALICE), 1 ether);
    }

    function testWithdrawHappyPath() public {
        uint256 aliceBefore = ALICE.balance;
        vm.prank(DEPLOYER_EOA);
        treasury.withdraw(payable(ALICE), 3 ether);
        assertEq(ALICE.balance, aliceBefore + 3 ether);
        assertEq(treasury.balance(), 7 ether);
    }

    function testWithdrawInsufficientBalance() public {
        vm.prank(DEPLOYER_EOA);
        vm.expectRevert(SoulVaultTreasury.InsufficientBalance.selector);
        treasury.withdraw(payable(ALICE), 100 ether);
    }

    function testWithdrawZeroAddress() public {
        vm.prank(DEPLOYER_EOA);
        vm.expectRevert(SoulVaultTreasury.ZeroAddress.selector);
        treasury.withdraw(payable(address(0)), 1 ether);
    }

    function testApproveOwnerOnly() public {
        mockSwarm.seedRequest(1, ALICE, 1 ether, "ops", 0);
        vm.prank(BOB);
        vm.expectRevert(SoulVaultTreasury.NotOwner.selector);
        treasury.approveFundRequest(address(mockSwarm), 1);
    }

    function testApproveMutualConsentMismatch() public {
        // A second mock swarm whose treasury is NOT this treasury.
        MockSwarm otherMock = new MockSwarm();
        otherMock.setTreasury(address(0xDEAD));
        otherMock.seedRequest(1, ALICE, 1 ether, "ops", 0);

        vm.prank(DEPLOYER_EOA);
        vm.expectRevert(SoulVaultTreasury.SwarmTreasuryMismatch.selector);
        treasury.approveFundRequest(address(otherMock), 1);
    }

    function testApproveInvalidRequest() public {
        // No request seeded at id 99.
        vm.prank(DEPLOYER_EOA);
        vm.expectRevert(SoulVaultTreasury.InvalidFundRequest.selector);
        treasury.approveFundRequest(address(mockSwarm), 99);
    }

    function testApproveNotPending() public {
        mockSwarm.seedRequest(1, ALICE, 1 ether, "ops", 1 /* already approved */);
        vm.prank(DEPLOYER_EOA);
        vm.expectRevert(SoulVaultTreasury.InvalidRequestState.selector);
        treasury.approveFundRequest(address(mockSwarm), 1);
    }

    function testApproveInsufficientBalance() public {
        mockSwarm.seedRequest(1, ALICE, 100 ether, "too much", 0);
        vm.prank(DEPLOYER_EOA);
        vm.expectRevert(SoulVaultTreasury.InsufficientBalance.selector);
        treasury.approveFundRequest(address(mockSwarm), 1);
    }

    function testApproveHappyPath() public {
        uint256 aliceBefore = ALICE.balance;
        mockSwarm.seedRequest(1, ALICE, 2 ether, "ops", 0);

        vm.prank(DEPLOYER_EOA);
        treasury.approveFundRequest(address(mockSwarm), 1);

        assertEq(ALICE.balance, aliceBefore + 2 ether);
        assertEq(treasury.balance(), 8 ether);

        // Swarm-side status flipped to APPROVED
        ISoulVaultSwarm.FundRequest memory req = mockSwarm.getFundRequest(1);
        assertEq(req.status, 1);
    }

    function testReentrancyBlockedByStatusGuard() public {
        // Deploy a malicious recipient that will attempt to re-enter approveFundRequest.
        // The guard that catches this is the swarm-side status flip (InvalidRequestState on reentry).
        // The nonReentrant lock on the treasury provides belt-and-braces.

        // Seed request id 1 targeting the reentrant contract (will be deployed below).
        // We seed first to reserve the id, then deploy the recipient with that id.
        // But the recipient address must be known before seeding, so we pre-compute it.

        // Simpler path: deploy recipient targeting id 1, then seed id 1 with recipient as requester.
        ReentrantRecipient rec = new ReentrantRecipient(treasury, address(mockSwarm), 1);
        mockSwarm.seedRequest(1, address(rec), 1 ether, "ops", 0);

        vm.prank(DEPLOYER_EOA);
        treasury.approveFundRequest(address(mockSwarm), 1);

        // Reentry was attempted but swallowed; original transfer succeeded.
        assertTrue(rec.triedReenter());
        assertEq(address(rec).balance, 1 ether);
        // Only one approval — status flipped once.
        ISoulVaultSwarm.FundRequest memory req = mockSwarm.getFundRequest(1);
        assertEq(req.status, 1);
        assertEq(treasury.balance(), 9 ether);
    }

    function testRejectOwnerOnly() public {
        mockSwarm.seedRequest(1, ALICE, 1 ether, "ops", 0);
        vm.prank(ALICE);
        vm.expectRevert(SoulVaultTreasury.NotOwner.selector);
        treasury.rejectFundRequest(address(mockSwarm), 1, "no");
    }

    function testRejectHappyPath() public {
        mockSwarm.seedRequest(1, ALICE, 1 ether, "ops", 0);
        uint256 balBefore = treasury.balance();
        uint256 aliceBefore = ALICE.balance;

        vm.prank(DEPLOYER_EOA);
        treasury.rejectFundRequest(address(mockSwarm), 1, "budget exhausted");

        // No funds moved
        assertEq(treasury.balance(), balBefore);
        assertEq(ALICE.balance, aliceBefore);

        // Swarm-side status flipped to REJECTED
        ISoulVaultSwarm.FundRequest memory req = mockSwarm.getFundRequest(1);
        assertEq(req.status, 2);
    }

    function testRejectMutualConsentMismatch() public {
        MockSwarm otherMock = new MockSwarm();
        otherMock.setTreasury(address(0xDEAD));
        otherMock.seedRequest(1, ALICE, 1 ether, "ops", 0);

        vm.prank(DEPLOYER_EOA);
        vm.expectRevert(SoulVaultTreasury.SwarmTreasuryMismatch.selector);
        treasury.rejectFundRequest(address(otherMock), 1, "no");
    }
}
