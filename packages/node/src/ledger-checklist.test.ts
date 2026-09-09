import { describe, expect, it } from 'vitest';
import { Interface, parseEther } from 'ethers';

import { buildTxChecklist, renderTxChecklist, unsignedTxHash, type TxChecklist } from '../src/ledger-checklist.js';
import { SOULVAULT_SWARM_ABI, SOULVAULT_TREASURY_ABI } from '../src/swarm-contract.js';

const IFACE = new Interface([...SOULVAULT_SWARM_ABI, ...SOULVAULT_TREASURY_ABI]);
const TREASURY = '0x9999999999999999999999999999999999999999';
const SWARM = '0x8888888888888888888888888888888888888888';

describe('buildTxChecklist', () => {
  it('renders contract creation with initcode size', () => {
    const checklist = buildTxChecklist({ to: null, data: '0x' + '60'.repeat(4000) });
    expect(checklist.action).toBe('Deploy contract');
    expect(checklist.lines[0]).toContain('4000 bytes');
  });

  it('decodes treasury withdraw with ETH amount', () => {
    const data = IFACE.encodeFunctionData('withdraw', [SWARM, parseEther('1.5')]);
    const checklist = buildTxChecklist({ to: TREASURY, data });
    expect(checklist.action).toBe('Treasury withdraw');
    expect(checklist.lines.some((l) => l.includes(SWARM) && l.startsWith('To:'))).toBe(true);
    expect(checklist.lines.some((l) => l.includes('1.5 ETH'))).toBe(true);
  });

  it('decodes requestFunds with amount and reason', () => {
    const data = IFACE.encodeFunctionData('requestFunds', [parseEther('0.25'), 'compute budget']);
    const checklist = buildTxChecklist({ to: SWARM, data });
    expect(checklist.action).toBe('Request funds');
    expect(checklist.lines.some((l) => l.includes('0.25 ETH'))).toBe(true);
    expect(checklist.lines.some((l) => l.includes('compute budget'))).toBe(true);
  });

  it('decodes approveFundRequest with swarm and request id', () => {
    const data = IFACE.encodeFunctionData('approveFundRequest', [SWARM, 42n]);
    const checklist = buildTxChecklist({ to: TREASURY, data });
    expect(checklist.action).toBe('Approve fund request');
    expect(checklist.lines.some((l) => l.includes('#42'))).toBe(true);
    expect(checklist.lines.some((l) => l.includes(SWARM))).toBe(true);
  });

  it('falls back to a selector summary for unknown calldata — never throws', () => {
    const checklist = buildTxChecklist({ to: TREASURY, data: '0xdeadbeef' + 'ab'.repeat(16) });
    expect(checklist.action).toBe('Contract call');
    expect(checklist.lines.some((l) => l.startsWith('Selector: 0xdeadbeef'))).toBe(true);
  });

  it('renders value on payable deposits', () => {
    const data = IFACE.encodeFunctionData('deposit');
    const checklist = buildTxChecklist({ to: TREASURY, data, value: parseEther('2') });
    expect(checklist.action).toBe('Deposit to treasury');
    expect(checklist.value).toBe('2.0 ETH');
  });
});

describe('renderTxChecklist + unsignedTxHash', () => {
  it('binds the checklist to the device-displayed hash', () => {
    // keccak of an empty RLP payload is only a smoke value; the property under
    // test is that renderTxChecklist surfaces whatever unsignedTxHash returns.
    const hash = unsignedTxHash('0x');
    expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
    const checklist: TxChecklist = { action: 'Deposit to treasury', lines: [`Treasury: ${TREASURY}`], value: '2.0 ETH' };
    const rendered = renderTxChecklist(checklist, hash);
    expect(rendered).toContain('Transaction checklist');
    expect(rendered).toContain(hash);
    expect(rendered).toContain('Treasury: ' + TREASURY);
  });
});
