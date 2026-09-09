import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/__integration__/world-selfie-check.integration.test.ts'],
    environment: 'node',
  },
})
