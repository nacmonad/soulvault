import type { SpeculosButton, SpeculosScreenEvent } from './test.js';

export type SpeculosControllerFixture = {
  screens: SpeculosScreenEvent[][];
  expectedButton: SpeculosButton;
};

export const approvalFixture: SpeculosControllerFixture = {
  screens: [
    [{ text: 'Review transaction', x: 4, y: 8 }],
    [{ text: 'Approve transaction', x: 4, y: 8 }],
  ],
  expectedButton: 'both',
};

export const rejectionFixture: SpeculosControllerFixture = {
  screens: [
    [{ text: 'Review message', x: 4, y: 8 }],
    [{ text: 'Sign message', x: 4, y: 8 }],
  ],
  expectedButton: 'left',
};
