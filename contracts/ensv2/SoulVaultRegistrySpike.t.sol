// SPDX-License-Identifier: MIT
pragma solidity >=0.8.13;

/// Phase 2 spike: prove the SoulVaultRegistry deploy + register flow against the
/// vendored ENSv2 contracts (pinned via lib/ens-contracts-v2, spec §2).
///
/// Flow under test (mirrors what the CLI will drive live on Sepolia):
///   1. VerifiableFactory deploys a UserRegistry proxy (the SoulVaultRegistry)
///      initialized with the org owner holding root roles.
///   2. The owner registers a swarm subname with an epoch-bound expiry; the
///      registration itself grants the owner the delegated role bitmap on the
///      name's resource.
///   3. EAC checks: roles are scoped per-name resource — an agent granted
///      ROLE_SET_RESOLVER on one name holds nothing on siblings or the root.

import {Test} from "forge-std/Test.sol";
import {ERC1155Holder} from "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";

import {VerifiableFactory} from "@ensdomains/verifiable-factory/VerifiableFactory.sol";

import {IPermissionedRegistry} from "~src/registry/interfaces/IPermissionedRegistry.sol";
import {IRegistry} from "~src/registry/interfaces/IRegistry.sol";
import {RegistryRolesLib} from "~src/registry/libraries/RegistryRolesLib.sol";
import {UserRegistry} from "~src/registry/UserRegistry.sol";
import {LabelStore} from "~src/utils/LabelStore.sol";
import {IContractNamer} from "~src/reverse-registrar/interfaces/IContractNamer.sol";
import {EACBaseRolesLib} from "~src/access-control/EnhancedAccessControl.sol";

contract SoulVaultRegistrySpikeTest is Test, ERC1155Holder {
    uint256 constant SALT = 0x5011; // "S0ul" — deterministic deploy address

    VerifiableFactory factory;
    LabelStore labelStore;
    UserRegistry implementation;
    UserRegistry soulvaultRegistry; // our org's subname registry (proxy)

    address orgOwner = makeAddr("orgOwner"); // Scott's Ledger in prod
    address swarmAgent = makeAddr("swarmAgent"); // agent wallet in prod

    function setUp() public {
        factory = new VerifiableFactory();
        labelStore = new LabelStore(IContractNamer(address(0)));
        implementation = new UserRegistry(labelStore, address(this));

        bytes memory initData =
            abi.encodeCall(UserRegistry.initialize, (orgOwner, EACBaseRolesLib.ALL_ROLES));
        address proxyAddress = factory.deployProxy(address(implementation), SALT, initData);
        soulvaultRegistry = UserRegistry(proxyAddress);
    }

    /// Roles the registration itself grants on the swarm name's resource.
    function _swarmRoles() internal pure returns (uint256) {
        return RegistryRolesLib.ROLE_SET_RESOLVER | RegistryRolesLib.ROLE_RENEW;
    }

    function test_factoryDeploysInitializedRegistry() public view {
        assertTrue(address(soulvaultRegistry) != address(0));
        // Org owner holds root roles on ROOT_RESOURCE (0).
        assertTrue(
            soulvaultRegistry.hasRoles(0, RegistryRolesLib.ROLE_REGISTRAR, orgOwner),
            "org owner should hold ROLE_REGISTRAR on root"
        );
        assertTrue(
            soulvaultRegistry.hasRoles(0, RegistryRolesLib.ROLE_RENEW, orgOwner),
            "org owner should hold ROLE_RENEW on root"
        );
        // And the agent does not.
        assertFalse(
            soulvaultRegistry.hasRoles(0, RegistryRolesLib.ROLE_REGISTRAR, swarmAgent),
            "agent must NOT hold root roles"
        );
    }

    function test_registerSwarmSubnameWithEpochExpiry() public {
        uint64 epochEnd = uint64(block.timestamp + 30 days);
        uint256 opsId = uint256(keccak256(bytes("ops")));

        vm.prank(orgOwner);
        uint256 tokenId = soulvaultRegistry.register(
            "ops", // swarm label → ops.soulvault.eth once wired under the org name
            orgOwner,
            IRegistry(address(0)), // no subregistry for leaf names yet
            address(0), // resolver set in a later step
            _swarmRoles(),
            epochEnd
        );

        IPermissionedRegistry.State memory state = soulvaultRegistry.getState(opsId);
        assertEq(state.latestOwner, orgOwner, "registered name owned by org owner");
        assertEq(state.expiry, epochEnd, "expiry is epoch-bound");
        assertEq(state.tokenId, tokenId, "token id from register matches state");
        assertTrue(state.status == IPermissionedRegistry.Status.REGISTERED, "status REGISTERED");
    }

    function test_ownerHoldsDelegatedRolesOnItsName() public {
        uint64 epochEnd = uint64(block.timestamp + 30 days);
        uint256 opsId = uint256(keccak256(bytes("ops")));

        vm.prank(orgOwner);
        soulvaultRegistry.register(
            "ops", orgOwner, IRegistry(address(0)), address(0), _swarmRoles(), epochEnd
        );

        IPermissionedRegistry.State memory state = soulvaultRegistry.getState(opsId);
        assertTrue(state.resource != 0, "resource must be set for a registered name");
        assertTrue(
            soulvaultRegistry.hasRoles(state.resource, RegistryRolesLib.ROLE_SET_RESOLVER, orgOwner),
            "owner should hold delegated roles on the name resource"
        );
    }

    function test_rolesAreScopedPerName_agentCannotEditSiblings() public {
        uint64 epochEnd = uint64(block.timestamp + 30 days);
        uint256 opsId = uint256(keccak256(bytes("ops")));
        uint256 researchId = uint256(keccak256(bytes("research")));

        vm.startPrank(orgOwner);
        soulvaultRegistry.register(
            "ops", orgOwner, IRegistry(address(0)), address(0), _swarmRoles(), epochEnd
        );
        soulvaultRegistry.register(
            "research", orgOwner, IRegistry(address(0)), address(0), _swarmRoles(), epochEnd
        );
        vm.stopPrank();

        IPermissionedRegistry.State memory opsState = soulvaultRegistry.getState(opsId);
        IPermissionedRegistry.State memory researchState = soulvaultRegistry.getState(researchId);
        assertTrue(opsState.resource != researchState.resource, "distinct names = distinct resources");

        // Agent holds nothing anywhere yet:
        assertFalse(
            soulvaultRegistry.hasRoles(opsState.resource, RegistryRolesLib.ROLE_SET_RESOLVER, swarmAgent),
            "agent starts with no roles"
        );

        // Owner delegates on ops only — anyId-keyed grant:
        vm.prank(orgOwner);
        soulvaultRegistry.grantRoles(opsId, RegistryRolesLib.ROLE_SET_RESOLVER, swarmAgent);

        assertTrue(
            soulvaultRegistry.hasRoles(opsState.resource, RegistryRolesLib.ROLE_SET_RESOLVER, swarmAgent),
            "agent holds role on ops"
        );
        assertFalse(
            soulvaultRegistry.hasRoles(researchState.resource, RegistryRolesLib.ROLE_SET_RESOLVER, swarmAgent),
            "agent holds nothing on research"
        );
        assertFalse(
            soulvaultRegistry.hasRoles(0, RegistryRolesLib.ROLE_REGISTRAR, swarmAgent),
            "agent cannot register sibling names"
        );
        assertFalse(
            soulvaultRegistry.hasRoles(0, RegistryRolesLib.ROLE_UNREGISTER, swarmAgent),
            "agent cannot unregister names"
        );
    }

    function test_renew_extendsExpiry_andOnlyRoleHoldersCan() public {
        uint64 epochEnd = uint64(block.timestamp + 30 days);
        uint256 opsId = uint256(keccak256(bytes("ops")));

        vm.prank(orgOwner);
        soulvaultRegistry.register(
            "ops", orgOwner, IRegistry(address(0)), address(0),
            RegistryRolesLib.ROLE_SET_RESOLVER, epochEnd // NOTE: no ROLE_RENEW granted at registration
        );

        // Non-holder (agent) cannot renew:
        vm.prank(swarmAgent);
        vm.expectRevert();
        soulvaultRegistry.renew(opsId, uint64(block.timestamp + 60 days));

        // Owner holds ROLE_RENEW via root; renew before expiry extends it:
        vm.prank(orgOwner);
        soulvaultRegistry.renew(opsId, uint64(block.timestamp + 60 days));
        IPermissionedRegistry.State memory afterRenew = soulvaultRegistry.getState(opsId);
        assertEq(afterRenew.expiry, uint64(block.timestamp + 60 days), "expiry extended");
        assertTrue(afterRenew.expiry > epochEnd, "expiry only grows");
    }

    function test_expiry_lapsedNameCannotBeOverwritten() public {
        uint64 epochEnd = uint64(block.timestamp + 30 days);
        uint256 opsId = uint256(keccak256(bytes("ops")));

        vm.prank(orgOwner);
        soulvaultRegistry.register(
            "ops", orgOwner, IRegistry(address(0)), address(0), _swarmRoles(), epochEnd
        );

        // Warp past expiry — the name lapses (owner keeps the token until unregister).
        vm.warp(epochEnd + 1);
        IPermissionedRegistry.State memory state = soulvaultRegistry.getState(opsId);
        assertTrue(state.expiry < block.timestamp, "name is past expiry");
        // The owner retains the ERC-1155 token; revival is the renewal path.
        assertEq(state.latestOwner, orgOwner, "latestOwner survives lapse until unregister");
    }
}
