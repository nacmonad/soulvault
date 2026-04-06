// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {SoulVaultOrganization} from "../contracts/SoulVaultOrganization.sol";
import {ISoulVaultSwarm} from "../contracts/ISoulVaultSwarm.sol";

/// @dev Minimal mock of the fields the organization actually reads/writes on the swarm.
///      Implements `organization()`, `getFundRequest()`, `markFundRequestApproved()`,
///      `markFundRequestRejected()`. Everything else reverts.
contract MockSwarm {
    address public organization;

    struct StoredFundRequest {
        address requester;
        uint256 amount;
        string reason;
        uint8 status; // 0=pending, 1=approved, 2=rejected, 3=cancelled
        uint64 createdAt;
        uint64 resolvedAt;
    }

    mapping(uint256 => StoredFundRequest) private _requests;

    function setOrganization(address o) external {
        organization = o;
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

    // --- Interface methods the organization actually calls ---

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
        require(msg.sender == organization, "not organization");
        StoredFundRequest storage r = _requests[requestId];
        require(r.status == 0, "not pending");
        r.status = 1;
        r.resolvedAt = uint64(block.timestamp);
    }

    function markFundRequestRejected(uint256 requestId, string calldata /*reason*/) external {
        require(msg.sender == organization, "not organization");
        StoredFundRequest storage r = _requests[requestId];
        require(r.status == 0, "not pending");
        r.status = 2;
        r.resolvedAt = uint64(block.timestamp);
    }
}

/// @dev Contract recipient that attempts to re-enter the organization via its receive function.
contract ReentrantRecipient {
    SoulVaultOrganization public immutable org;
    address public immutable swarm;
    uint256 public immutable requestId;
    bool public triedReenter;

    constructor(SoulVaultOrganization o, address s, uint256 id) {
        org = o;
        swarm = s;
        requestId = id;
    }

    receive() external payable {
        if (!triedReenter) {
            triedReenter = true;
            try org.approveFundRequest(swarm, requestId) {} catch {}
        }
    }
}

contract SoulVaultOrganizationTest is Test {
    SoulVaultOrganization internal org;
    MockSwarm internal mockSwarm;

    address internal constant DEPLOYER_EOA = address(0xBEEF);
    address internal constant ALICE = address(0xA11CE);
    address internal constant BOB = address(0xB0B);

    function setUp() public {
        vm.prank(DEPLOYER_EOA);
        org = new SoulVaultOrganization();

        mockSwarm = new MockSwarm();
        mockSwarm.setOrganization(address(org));

        // Register the mock swarm on the org.
        vm.prank(DEPLOYER_EOA);
        org.registerSwarm(address(mockSwarm));

        // Top org up with 10 ether.
        vm.deal(address(this), 100 ether);
        (bool ok, ) = address(org).call{value: 10 ether}("");
        require(ok, "seed failed");
    }

    // --- Owner ---

    function testOwnerIsDeployer() public view {
        assertEq(org.owner(), DEPLOYER_EOA);
    }

    // --- Balance ---

    function testBalanceAfterSeed() public view {
        assertEq(org.balance(), 10 ether);
    }

    // --- Deposits ---

    function testReceiveEmitsFundsDeposited() public {
        uint256 before = org.balance();
        vm.deal(ALICE, 1 ether);
        vm.prank(ALICE);
        (bool ok, ) = address(org).call{value: 1 ether}("");
        require(ok, "deposit failed");
        assertEq(org.balance(), before + 1 ether);
    }

    function testDepositFunctionEmits() public {
        vm.deal(ALICE, 1 ether);
        vm.prank(ALICE);
        org.deposit{value: 1 ether}();
        assertEq(org.balance(), 11 ether);
    }

    // --- Withdrawals ---

    function testWithdrawOwnerOnly() public {
        vm.prank(ALICE);
        vm.expectRevert(SoulVaultOrganization.NotOwner.selector);
        org.withdraw(payable(ALICE), 1 ether);
    }

    function testWithdrawHappyPath() public {
        uint256 aliceBefore = ALICE.balance;
        vm.prank(DEPLOYER_EOA);
        org.withdraw(payable(ALICE), 3 ether);
        assertEq(ALICE.balance, aliceBefore + 3 ether);
        assertEq(org.balance(), 7 ether);
    }

    function testWithdrawInsufficientBalance() public {
        vm.prank(DEPLOYER_EOA);
        vm.expectRevert(SoulVaultOrganization.InsufficientBalance.selector);
        org.withdraw(payable(ALICE), 100 ether);
    }

    function testWithdrawZeroAddress() public {
        vm.prank(DEPLOYER_EOA);
        vm.expectRevert(SoulVaultOrganization.ZeroAddress.selector);
        org.withdraw(payable(address(0)), 1 ether);
    }

    // --- Fund request approval ---

    function testApproveOwnerOnly() public {
        mockSwarm.seedRequest(1, ALICE, 1 ether, "ops", 0);
        vm.prank(BOB);
        vm.expectRevert(SoulVaultOrganization.NotOwner.selector);
        org.approveFundRequest(address(mockSwarm), 1);
    }

    function testApproveSwarmNotRegistered() public {
        MockSwarm unregistered = new MockSwarm();
        unregistered.setOrganization(address(org));
        unregistered.seedRequest(1, ALICE, 1 ether, "ops", 0);

        vm.prank(DEPLOYER_EOA);
        vm.expectRevert(SoulVaultOrganization.SwarmNotRegistered.selector);
        org.approveFundRequest(address(unregistered), 1);
    }

    function testApproveMutualConsentMismatch() public {
        // A registered mock swarm whose organization is NOT this org.
        MockSwarm otherMock = new MockSwarm();
        otherMock.setOrganization(address(0xDEAD));
        otherMock.seedRequest(1, ALICE, 1 ether, "ops", 0);

        vm.prank(DEPLOYER_EOA);
        org.registerSwarm(address(otherMock));

        vm.prank(DEPLOYER_EOA);
        vm.expectRevert(SoulVaultOrganization.SwarmOrganizationMismatch.selector);
        org.approveFundRequest(address(otherMock), 1);
    }

    function testApproveInvalidRequest() public {
        vm.prank(DEPLOYER_EOA);
        vm.expectRevert(SoulVaultOrganization.InvalidFundRequest.selector);
        org.approveFundRequest(address(mockSwarm), 99);
    }

    function testApproveNotPending() public {
        mockSwarm.seedRequest(1, ALICE, 1 ether, "ops", 1 /* already approved */);
        vm.prank(DEPLOYER_EOA);
        vm.expectRevert(SoulVaultOrganization.InvalidRequestState.selector);
        org.approveFundRequest(address(mockSwarm), 1);
    }

    function testApproveInsufficientBalance() public {
        mockSwarm.seedRequest(1, ALICE, 100 ether, "too much", 0);
        vm.prank(DEPLOYER_EOA);
        vm.expectRevert(SoulVaultOrganization.InsufficientBalance.selector);
        org.approveFundRequest(address(mockSwarm), 1);
    }

    function testApproveHappyPath() public {
        uint256 aliceBefore = ALICE.balance;
        mockSwarm.seedRequest(1, ALICE, 2 ether, "ops", 0);

        vm.prank(DEPLOYER_EOA);
        org.approveFundRequest(address(mockSwarm), 1);

        assertEq(ALICE.balance, aliceBefore + 2 ether);
        assertEq(org.balance(), 8 ether);

        ISoulVaultSwarm.FundRequest memory req = mockSwarm.getFundRequest(1);
        assertEq(req.status, 1);
    }

    function testReentrancyBlockedByStatusGuard() public {
        ReentrantRecipient rec = new ReentrantRecipient(org, address(mockSwarm), 1);
        mockSwarm.seedRequest(1, address(rec), 1 ether, "ops", 0);

        vm.prank(DEPLOYER_EOA);
        org.approveFundRequest(address(mockSwarm), 1);

        assertTrue(rec.triedReenter());
        assertEq(address(rec).balance, 1 ether);
        ISoulVaultSwarm.FundRequest memory req = mockSwarm.getFundRequest(1);
        assertEq(req.status, 1);
        assertEq(org.balance(), 9 ether);
    }

    // --- Fund request rejection ---

    function testRejectOwnerOnly() public {
        mockSwarm.seedRequest(1, ALICE, 1 ether, "ops", 0);
        vm.prank(ALICE);
        vm.expectRevert(SoulVaultOrganization.NotOwner.selector);
        org.rejectFundRequest(address(mockSwarm), 1, "no");
    }

    function testRejectHappyPath() public {
        mockSwarm.seedRequest(1, ALICE, 1 ether, "ops", 0);
        uint256 balBefore = org.balance();
        uint256 aliceBefore = ALICE.balance;

        vm.prank(DEPLOYER_EOA);
        org.rejectFundRequest(address(mockSwarm), 1, "budget exhausted");

        assertEq(org.balance(), balBefore);
        assertEq(ALICE.balance, aliceBefore);

        ISoulVaultSwarm.FundRequest memory req = mockSwarm.getFundRequest(1);
        assertEq(req.status, 2);
    }

    function testRejectSwarmNotRegistered() public {
        MockSwarm unregistered = new MockSwarm();
        unregistered.setOrganization(address(org));
        unregistered.seedRequest(1, ALICE, 1 ether, "ops", 0);

        vm.prank(DEPLOYER_EOA);
        vm.expectRevert(SoulVaultOrganization.SwarmNotRegistered.selector);
        org.rejectFundRequest(address(unregistered), 1, "no");
    }

    function testRejectMutualConsentMismatch() public {
        MockSwarm otherMock = new MockSwarm();
        otherMock.setOrganization(address(0xDEAD));
        otherMock.seedRequest(1, ALICE, 1 ether, "ops", 0);

        vm.prank(DEPLOYER_EOA);
        org.registerSwarm(address(otherMock));

        vm.prank(DEPLOYER_EOA);
        vm.expectRevert(SoulVaultOrganization.SwarmOrganizationMismatch.selector);
        org.rejectFundRequest(address(otherMock), 1, "no");
    }

    // --- Swarm registry ---

    function testRegisterSwarmHappyPath() public {
        address newSwarm = address(0x1234);
        vm.prank(DEPLOYER_EOA);
        org.registerSwarm(newSwarm);

        assertTrue(org.isSwarm(newSwarm));
        assertEq(org.swarmCount(), 2); // mockSwarm + newSwarm
    }

    function testRegisterSwarmDuplicateReverts() public {
        vm.prank(DEPLOYER_EOA);
        vm.expectRevert(SoulVaultOrganization.SwarmAlreadyRegistered.selector);
        org.registerSwarm(address(mockSwarm));
    }

    function testRegisterSwarmZeroAddress() public {
        vm.prank(DEPLOYER_EOA);
        vm.expectRevert(SoulVaultOrganization.ZeroAddress.selector);
        org.registerSwarm(address(0));
    }

    function testRegisterSwarmOnlyOwner() public {
        vm.prank(ALICE);
        vm.expectRevert(SoulVaultOrganization.NotOwner.selector);
        org.registerSwarm(address(0x1234));
    }

    function testRemoveSwarmHappyPath() public {
        vm.prank(DEPLOYER_EOA);
        org.removeSwarm(address(mockSwarm));

        assertFalse(org.isSwarm(address(mockSwarm)));
        assertEq(org.swarmCount(), 0);
    }

    function testRemoveSwarmNotRegistered() public {
        vm.prank(DEPLOYER_EOA);
        vm.expectRevert(SoulVaultOrganization.SwarmNotRegistered.selector);
        org.removeSwarm(address(0x9999));
    }

    function testRemoveSwarmOnlyOwner() public {
        vm.prank(ALICE);
        vm.expectRevert(SoulVaultOrganization.NotOwner.selector);
        org.removeSwarm(address(mockSwarm));
    }

    function testSwarmsViewReturnsAll() public {
        address s2 = address(0x2222);
        address s3 = address(0x3333);
        vm.startPrank(DEPLOYER_EOA);
        org.registerSwarm(s2);
        org.registerSwarm(s3);
        vm.stopPrank();

        address[] memory list = org.swarms();
        assertEq(list.length, 3);
    }

    // --- Org-level pause ---

    function testOrgPauseDefaultsFalse() public view {
        assertFalse(org.orgPaused());
    }

    function testPauseOrgOnlyOwner() public {
        vm.prank(ALICE);
        vm.expectRevert(SoulVaultOrganization.NotOwner.selector);
        org.pauseOrg();
    }

    function testPauseOrgBlocksApproval() public {
        mockSwarm.seedRequest(1, ALICE, 1 ether, "ops", 0);

        vm.prank(DEPLOYER_EOA);
        org.pauseOrg();

        vm.prank(DEPLOYER_EOA);
        vm.expectRevert(SoulVaultOrganization.OrgIsPaused.selector);
        org.approveFundRequest(address(mockSwarm), 1);
    }

    function testPauseOrgBlocksRejection() public {
        mockSwarm.seedRequest(1, ALICE, 1 ether, "ops", 0);

        vm.prank(DEPLOYER_EOA);
        org.pauseOrg();

        vm.prank(DEPLOYER_EOA);
        vm.expectRevert(SoulVaultOrganization.OrgIsPaused.selector);
        org.rejectFundRequest(address(mockSwarm), 1, "no");
    }

    function testUnpauseOrgResumesOperations() public {
        mockSwarm.seedRequest(1, ALICE, 1 ether, "ops", 0);

        vm.startPrank(DEPLOYER_EOA);
        org.pauseOrg();
        org.unpauseOrg();
        vm.stopPrank();

        assertFalse(org.orgPaused());

        uint256 aliceBefore = ALICE.balance;
        vm.prank(DEPLOYER_EOA);
        org.approveFundRequest(address(mockSwarm), 1);
        assertEq(ALICE.balance, aliceBefore + 1 ether);
    }
}
