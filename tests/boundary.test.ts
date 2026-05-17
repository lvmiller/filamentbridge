import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { OFFICIAL_RFID_BOUNDARY } from '../packages/shared/src/index';

describe('official Bambu RFID boundary', () => {
  it('states that FilamentBridge uses separate app-owned companion tags', () => {
    expect(OFFICIAL_RFID_BOUNDARY).toContain('companion NFC tags');
    expect(OFFICIAL_RFID_BOUNDARY).toContain('does not clone, forge, emulate, modify, or bypass official Bambu RFID');
  });

  it('does not expose APIs that claim to write Bambu-format RFID tags', () => {
    const server = readFileSync('apps/server/src/app.ts', 'utf8');
    expect(server).toContain('/api/boundary');
    expect(server).not.toMatch(/write[-_/]?bambu[-_/]?rfid/i);
    expect(server).not.toMatch(/official authenticity/i);
  });
});
