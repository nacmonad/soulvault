export type HarnessName = 'openclaw' | 'hermes' | 'ironclaw' | string;

export function resolveBackupCommand(harness: HarnessName, explicit?: string): string {
  if (explicit) return explicit;

  switch (harness) {
    case 'openclaw':
      return 'soulvault-harness-openclaw backup';
    case 'hermes':
      return 'soulvault-harness-hermes backup';
    case 'ironclaw':
      return 'soulvault-harness-ironclaw backup';
    default:
      return `soulvault-harness-${harness} backup`;
  }
}
