import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const appSource = readFileSync('apps/ios/Sources/FilamentBridgeIOS/FilamentBridgeApp.swift', 'utf8');
const nfcSource = readFileSync('apps/ios/Sources/FilamentBridgeIOS/NFCService.swift', 'utf8');

describe('iOS source layout', () => {
  it('contains the required SwiftUI screens', () => {
    for (const label of ['Server pairing', 'Scan tag', 'Scan label', 'Assign blank tag', 'Spool summary', 'Manual weight adjustment', 'Rewrite stale tag', 'Offline queue', 'Conflict review']) {
      expect(appSource).toContain(label);
    }
  });

  it('uses native Core NFC for Type 2 companion tag read/write workflows', () => {
    expect(nfcSource).toContain('import CoreNFC');
    expect(nfcSource).toContain('NFCTagReaderSession');
    expect(nfcSource).toContain('0xA2');
    expect(nfcSource).toContain('NTAG213-compatible NFC Forum Type 2 companion tags');
  });
});
