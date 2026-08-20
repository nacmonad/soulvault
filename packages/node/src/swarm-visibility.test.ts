import { describe, expect, it } from 'vitest';
import { planSwarmEns } from './swarm.js';

const ORG = 'acme.eth';

describe('planSwarmEns', () => {
  describe('private', () => {
    it('publishes nothing, even under an org with a registered ENS name', () => {
      expect(
        planSwarmEns({ swarmName: 'Ops Crew', organizationEnsName: ORG, visibility: 'private' }),
      ).toEqual({
        visibility: 'private',
        ensName: undefined,
        bindSubdomain: false,
        listInOrg: false,
      });
    });

    it('is the default when there is no parent org to publish under', () => {
      const plan = planSwarmEns({ swarmName: 'Ops Crew' });
      expect(plan.visibility).toBe('private');
      expect(plan.bindSubdomain).toBe(false);
      expect(plan.listInOrg).toBe(false);
    });

    it('rejects an explicit ENS name as contradictory', () => {
      expect(() =>
        planSwarmEns({
          swarmName: 'Ops Crew',
          organizationEnsName: ORG,
          explicitEnsName: `ops.${ORG}`,
          visibility: 'private',
        }),
      ).toThrow(/contradict/);
    });
  });

  describe('semi-private', () => {
    it('binds the subdomain but stays off the org discovery list', () => {
      expect(
        planSwarmEns({
          swarmName: 'Ops Crew',
          organizationEnsName: ORG,
          visibility: 'semi-private',
        }),
      ).toEqual({
        visibility: 'semi-private',
        ensName: `ops-crew.${ORG}`,
        bindSubdomain: true,
        listInOrg: false,
      });
    });
  });

  describe('public', () => {
    it('binds the subdomain and lists the swarm on the org', () => {
      expect(
        planSwarmEns({ swarmName: 'Ops Crew', organizationEnsName: ORG, visibility: 'public' }),
      ).toEqual({
        visibility: 'public',
        ensName: `ops-crew.${ORG}`,
        bindSubdomain: true,
        listInOrg: true,
      });
    });

    it('is the default when a parent org is present', () => {
      expect(planSwarmEns({ swarmName: 'Ops Crew', organizationEnsName: ORG }).visibility).toBe(
        'public',
      );
    });

    it('honours an explicit ENS name over the slugified swarm name', () => {
      expect(
        planSwarmEns({
          swarmName: 'Ops Crew',
          organizationEnsName: ORG,
          explicitEnsName: `backend.${ORG}`,
        }).ensName,
      ).toBe(`backend.${ORG}`);
    });
  });

  describe('rejected combinations', () => {
    it.each(['public', 'semi-private'] as const)(
      'refuses %s without a parent org ENS name',
      (visibility) => {
        expect(() => planSwarmEns({ swarmName: 'Ops Crew', visibility })).toThrow(
          /needs a parent organization/,
        );
      },
    );

    it('refuses an ENS name under a different org', () => {
      expect(() =>
        planSwarmEns({
          swarmName: 'Ops Crew',
          organizationEnsName: ORG,
          explicitEnsName: 'ops.other.eth',
        }),
      ).toThrow(/not a direct subdomain/);
    });

    // The binder would create a subnode labelled "a.b" while writing resolver
    // records to namehash('a.b.acme.eth') — a different node entirely.
    it('refuses a grandchild, which would bind under the wrong node', () => {
      expect(() =>
        planSwarmEns({
          swarmName: 'Ops Crew',
          organizationEnsName: ORG,
          explicitEnsName: `a.b.${ORG}`,
        }),
      ).toThrow(/not a direct subdomain/);
    });

    it('refuses the org name itself', () => {
      expect(() =>
        planSwarmEns({ swarmName: 'Ops Crew', organizationEnsName: ORG, explicitEnsName: ORG }),
      ).toThrow(/not a direct subdomain/);
    });
  });
});
