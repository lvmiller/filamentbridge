import { readFileSync } from 'node:fs';

const requiredFiles = [
  'apps/ios/Package.swift',
  'apps/ios/Sources/FilamentBridgeIOS/FilamentBridgeApp.swift',
  'apps/ios/Sources/FilamentBridgeIOS/APIClient.swift',
  'apps/ios/Sources/FilamentBridgeIOS/NFCCodec.swift',
  'apps/ios/Sources/FilamentBridgeIOS/NFCService.swift',
  'apps/ios/Sources/FilamentBridgeIOS/OfflineQueue.swift',
  'apps/ios/Sources/FilamentBridgeIOS/Models.swift'
];

for (const file of requiredFiles) {
  readFileSync(file, 'utf8');
}

const app = readFileSync('apps/ios/Sources/FilamentBridgeIOS/FilamentBridgeApp.swift', 'utf8');
const nfc = readFileSync('apps/ios/Sources/FilamentBridgeIOS/NFCService.swift', 'utf8');
for (const label of ['Server pairing', 'Scan tag', 'Scan label', 'Assign blank tag', 'Spool summary', 'Manual weight adjustment', 'Rewrite stale tag', 'Offline queue', 'Conflict review']) {
  if (!app.includes(label)) throw new Error(`missing iOS screen: ${label}`);
}
for (const token of ['import CoreNFC', 'NFCTagReaderSession', '0xA2', 'NTAG213-compatible NFC Forum Type 2 companion tags']) {
  if (!nfc.includes(token)) throw new Error(`missing Core NFC marker: ${token}`);
}
console.log('iOS source layout validated');
