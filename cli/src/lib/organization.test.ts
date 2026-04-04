import { describe, expect, it } from 'vitest';
import { normalizeRootEthEnsName } from './organization.js';

describe('normalizeRootEthEnsName', () => {
  it('normalizes a root .eth label', () => {
    expect(normalizeRootEthEnsName('  myproject.eth  ')).toBe('myproject.eth');
  });

  it('rejects subdomains', () => {
    expect(() => normalizeRootEthEnsName('ops.myproject.eth')).toThrow(/Only root/);
  });

  it('rejects non-.eth roots', () => {
    expect(() => normalizeRootEthEnsName('foo.com')).toThrow();
  });
});
