// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, Vm} from "forge-std/Test.sol";
import {SoulVaultSwarm} from "../contracts/SoulVaultSwarm.sol";
import {SoulVaultTreasury} from "../contracts/SoulVaultTreasury.sol";

/// EIP-712 signed-intent tests for Swarm + Treasury.
contract WithSigTest is Test {
    SoulVaultSwarm swarm;
    SoulVaultTreasury treasury;

    uint256 constant OWNER_PK = 0xA11CE;
    uint256 constant RELAYER_PK = 0xB0B;
    uint256 constant ATTACKER_PK = 0xDEAD;
    address owner;
    address relayer;
    address attacker;

    // EIP-712 typehashes — must match contract constants.
    bytes32 constant APPROVE_FUND_REQUEST_TYPEHASH = keccak256(
        "ApproveFundRequest(address swarm,uint256 requestId,uint256 amount,address recipient,uint64 nonce,uint64 deadline)"
    );
    bytes32 constant TREASURY_WITHDRAW_TYPEHASH = keccak256(
        "TreasuryWithdraw(address treasury,address recipient,uint256 amount,uint64 nonce,uint64 deadline)"
    );
    bytes32 constant SET_TREASURY_TYPEHASH =
        keccak256("SetTreasury(address swarm,address treasury,uint64 nonce,uint64 deadline)");
    bytes32 constant APPROVE_JOIN_TYPEHASH =
        keccak256("ApproveJoin(address swarm,uint256 requestId,address requester,uint64 nonce,uint64 deadline)");

    function setUp() public {
        owner = vm.addr(OWNER_PK);
        relayer = vm.addr(RELAYER_PK);
        attacker = vm.addr(ATTACKER_PK);
        vm.prank(owner);
        swarm = new SoulVaultSwarm(address(0));
        vm.prank(owner);
        treasury = new SoulVaultTreasury();
        vm.deal(address(treasury), 100 ether);
    }

    // ─── Helpers ─────────────────────────────────────────────────────────

    function _sign(uint256 pk, bytes32 domainSep, bytes32 structHash) internal pure returns (bytes memory) {
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSep, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _approveFundRequestDigest(
        address swarmAddr,
        uint256 requestId,
        uint256 amount,
        address recipient,
        uint64 nonce,
        uint64 deadline
    ) internal pure returns (bytes32) {
        return keccak256(abi.encode(
            APPROVE_FUND_REQUEST_TYPEHASH,
            swarmAddr, requestId, amount, recipient, nonce, deadline
        ));
    }

    // ─── Treasury: setTreasury via SwarmWithSig so Fund approval can link ─

    function _bindSwarmToTreasury() internal {
        uint64 deadline = uint64(block.timestamp + 3600);
        uint64 nonce = swarm.ownerNonce();
        bytes32 structHash = keccak256(abi.encode(
            SET_TREASURY_TYPEHASH, address(swarm), address(treasury), nonce, deadline
        ));
        bytes memory sig = _sign(OWNER_PK, swarm.DOMAIN_SEPARATOR(), structHash);
        vm.prank(relayer);
        swarm.setTreasuryWithSig(address(treasury), nonce, deadline, sig);
    }

    // ─── Treasury withdraw WithSig: happy + negatives ────────────────────

    function testWithdrawWithSig_Happy() public {
        uint64 deadline = uint64(block.timestamp + 3600);
        uint64 nonce = treasury.ownerNonce();
        uint256 amount = 1 ether;
        address payable dest = payable(vm.addr(0xCAFE));
        bytes32 structHash = keccak256(abi.encode(
            TREASURY_WITHDRAW_TYPEHASH, address(treasury), dest, amount, nonce, deadline
        ));
        bytes memory sig = _sign(OWNER_PK, treasury.DOMAIN_SEPARATOR(), structHash);

        uint256 before = dest.balance;
        vm.prank(relayer); // relayer submits; owner never calls directly
        treasury.withdrawWithSig(dest, amount, nonce, deadline, sig);
        assertEq(dest.balance, before + amount, "dest received");
        assertEq(treasury.ownerNonce(), nonce + 1, "nonce incremented");
    }

    function testWithdrawWithSig_BadSignerReverts() public {
        uint64 deadline = uint64(block.timestamp + 3600);
        uint64 nonce = treasury.ownerNonce();
        uint256 amount = 1 ether;
        address payable dest = payable(vm.addr(0xCAFE));
        bytes32 structHash = keccak256(abi.encode(
            TREASURY_WITHDRAW_TYPEHASH, address(treasury), dest, amount, nonce, deadline
        ));
        bytes memory badSig = _sign(ATTACKER_PK, treasury.DOMAIN_SEPARATOR(), structHash);

        vm.prank(relayer);
        vm.expectRevert(); // BadSigner
        treasury.withdrawWithSig(dest, amount, nonce, deadline, badSig);
    }

    function testWithdrawWithSig_ExpiredReverts() public {
        uint64 deadline = uint64(block.timestamp + 3600);
        uint64 nonce = treasury.ownerNonce();
        uint256 amount = 1 ether;
        address payable dest = payable(vm.addr(0xCAFE));
        bytes32 structHash = keccak256(abi.encode(
            TREASURY_WITHDRAW_TYPEHASH, address(treasury), dest, amount, nonce, deadline
        ));
        bytes memory sig = _sign(OWNER_PK, treasury.DOMAIN_SEPARATOR(), structHash);

        vm.warp(deadline + 1);
        vm.prank(relayer);
        vm.expectRevert(); // SigExpired
        treasury.withdrawWithSig(dest, amount, nonce, deadline, sig);
    }

    function testWithdrawWithSig_BadNonceReverts() public {
        uint64 deadline = uint64(block.timestamp + 3600);
        uint64 wrongNonce = treasury.ownerNonce() + 7;
        uint256 amount = 1 ether;
        address payable dest = payable(vm.addr(0xCAFE));
        bytes32 structHash = keccak256(abi.encode(
            TREASURY_WITHDRAW_TYPEHASH, address(treasury), dest, amount, wrongNonce, deadline
        ));
        bytes memory sig = _sign(OWNER_PK, treasury.DOMAIN_SEPARATOR(), structHash);

        vm.prank(relayer);
        vm.expectRevert(); // BadNonce
        treasury.withdrawWithSig(dest, amount, wrongNonce, deadline, sig);
    }

    function testWithdrawWithSig_ReplayReverts() public {
        uint64 deadline = uint64(block.timestamp + 3600);
        uint64 nonce = treasury.ownerNonce();
        uint256 amount = 1 ether;
        address payable dest = payable(vm.addr(0xCAFE));
        bytes32 structHash = keccak256(abi.encode(
            TREASURY_WITHDRAW_TYPEHASH, address(treasury), dest, amount, nonce, deadline
        ));
        bytes memory sig = _sign(OWNER_PK, treasury.DOMAIN_SEPARATOR(), structHash);

        vm.prank(relayer);
        treasury.withdrawWithSig(dest, amount, nonce, deadline, sig);

        // Same sig again — nonce now advanced → rejected.
        vm.prank(relayer);
        vm.expectRevert();
        treasury.withdrawWithSig(dest, amount, nonce, deadline, sig);
    }

    // ─── Swarm: setTreasuryWithSig happy + negative ──────────────────────

    function testSetTreasuryWithSig_Happy() public {
        _bindSwarmToTreasury();
        assertEq(swarm.treasury(), address(treasury));
    }

    function testSetTreasuryWithSig_DifferentSubmitter() public {
        uint64 deadline = uint64(block.timestamp + 3600);
        uint64 nonce = swarm.ownerNonce();
        bytes32 structHash = keccak256(abi.encode(
            SET_TREASURY_TYPEHASH, address(swarm), address(treasury), nonce, deadline
        ));
        bytes memory sig = _sign(OWNER_PK, swarm.DOMAIN_SEPARATOR(), structHash);

        // Attacker submits the owner-signed intent — this is FINE. The signed
        // intent is what gates the action, not msg.sender.
        vm.prank(attacker);
        swarm.setTreasuryWithSig(address(treasury), nonce, deadline, sig);
        assertEq(swarm.treasury(), address(treasury));
    }

    // ─── Swarm: approveJoinWithSig ───────────────────────────────────────

    function testApproveJoinWithSig_Happy() public {
        address alice = vm.addr(0xA11);
        vm.prank(alice);
        uint256 reqId = swarm.requestJoin(hex"02aa", "ref", "meta");

        uint64 deadline = uint64(block.timestamp + 3600);
        uint64 nonce = swarm.ownerNonce();
        bytes32 structHash = keccak256(abi.encode(
            APPROVE_JOIN_TYPEHASH, address(swarm), reqId, alice, nonce, deadline
        ));
        bytes memory sig = _sign(OWNER_PK, swarm.DOMAIN_SEPARATOR(), structHash);

        vm.prank(relayer);
        swarm.approveJoinWithSig(reqId, alice, nonce, deadline, sig);
        assertTrue(swarm.isActiveMember(alice));
    }

    // ─── End-to-end: fund request flow via WithSig ───────────────────────

    function testFundRequestFlowWithSig_EndToEnd() public {
        // Bind treasury
        _bindSwarmToTreasury();

        // Onboard alice as member
        address alice = vm.addr(0xA11);
        vm.prank(alice);
        uint256 joinId = swarm.requestJoin(hex"02bb", "ref", "meta");
        {
            uint64 deadline = uint64(block.timestamp + 3600);
            uint64 nonce = swarm.ownerNonce();
            bytes memory sig = _sign(
                OWNER_PK, swarm.DOMAIN_SEPARATOR(),
                keccak256(abi.encode(APPROVE_JOIN_TYPEHASH, address(swarm), joinId, alice, nonce, deadline))
            );
            vm.prank(relayer);
            swarm.approveJoinWithSig(joinId, alice, nonce, deadline, sig);
        }

        // Alice requests funds
        vm.prank(alice);
        uint256 fundId = swarm.requestFunds(1 ether, "coffee");

        // Owner signs approval; relayer submits
        uint64 dl = uint64(block.timestamp + 3600);
        uint64 n = treasury.ownerNonce();
        bytes32 h = _approveFundRequestDigest(address(swarm), fundId, 1 ether, alice, n, dl);
        bytes memory s = _sign(OWNER_PK, treasury.DOMAIN_SEPARATOR(), h);

        uint256 aliceBefore = alice.balance;
        vm.prank(relayer);
        treasury.approveFundRequestWithSig(address(swarm), fundId, 1 ether, alice, n, dl, s);
        assertEq(alice.balance, aliceBefore + 1 ether, "alice paid");
        assertEq(treasury.ownerNonce(), n + 1, "treasury nonce bumped");
    }
}
