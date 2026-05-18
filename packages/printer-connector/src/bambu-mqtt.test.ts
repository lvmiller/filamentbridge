import { describe, expect, it } from 'vitest';
import {
  BambuLanMqttConnector,
  BambuMqttConnectionServer,
  createBambuPushAllRequest,
  deepMergeBambuReport,
  extractBambuObservedSlots,
  normalizeBambuColor,
  normalizeBambuMaterial,
  parseBambuReportPayload,
  type BambuMqttClientLike
} from './index';

describe('Bambu LAN MQTT report parsing', () => {
  it('parses JSON reports and drops RFID-adjacent fields', () => {
    const parsed = parseBambuReportPayload(JSON.stringify({
      print: {
        ams: {
          ams: [{ id: '0', tray: [{ id: '0', tray_type: 'PLA', tray_color: '112233FF', tag_uid: 'not-persisted', tray_uuid: 'not-persisted' }] }],
          ams_rfid_status: 3
        },
        online: { rfid: true }
      }
    }));

    expect(parsed).toEqual({
      print: {
        ams: {
          ams: [{ id: '0', tray: [{ id: '0', tray_type: 'PLA', tray_color: '112233FF' }] }]
        },
        online: {}
      }
    });
  });

  it('deep merges partial reports without restoring RFID-adjacent fields', () => {
    const merged = deepMergeBambuReport(
      { print: { ams: { ams: [{ id: '0', tray: [{ id: '0', tray_type: 'PLA' }] }] } } },
      { print: { ams: { version: 1, tag_uid: 'ignored' }, tray_now: 1 } }
    );

    expect(merged).toEqual({
      print: {
        ams: { ams: [{ id: '0', tray: [{ id: '0', tray_type: 'PLA' }] }], version: 1 },
        tray_now: 1
      }
    });
  });
});

describe('Bambu LAN MQTT slot extraction', () => {
  it('extracts AMS and external observed slots with normalized material and colors', () => {
    const slots = extractBambuObservedSlots({
      print: {
        tray_now: 2,
        ams: {
          ams: [{
            id: '0',
            tray: [
              { id: '0', tray_type: 'PLA', tray_color: 'AABBCCFF' },
              { id: '1' },
              { id: '2', tray_type: 'support w', cols: ['01020380'] }
            ]
          }]
        },
        vt_tray: { id: '254', tray_type: 'mystery', tray_color: '#445566' }
      }
    });

    expect(slots).toEqual([
      {
        unit_type: 'ams',
        unit_index: 0,
        slot_index: 0,
        display_name: 'AMS 1 Slot 1',
        state: 'loaded',
        detected_material_type: 'PLA',
        detected_color_hex: '#AABBCC',
        detected_remaining_percent: null
      },
      {
        unit_type: 'ams',
        unit_index: 0,
        slot_index: 1,
        display_name: 'AMS 1 Slot 2',
        state: 'empty',
        detected_material_type: null,
        detected_color_hex: null,
        detected_remaining_percent: null
      },
      {
        unit_type: 'ams',
        unit_index: 0,
        slot_index: 2,
        display_name: 'AMS 1 Slot 3',
        state: 'feeding',
        detected_material_type: 'SUPPORT',
        detected_color_hex: '#010203',
        detected_remaining_percent: null
      },
      {
        unit_type: 'external',
        unit_index: 0,
        slot_index: 0,
        display_name: 'External spool path',
        state: 'loaded',
        detected_material_type: 'OTHER',
        detected_color_hex: '#445566',
        detected_remaining_percent: null
      }
    ]);
  });

  it('marks the external path feeding when tray_now is 254', () => {
    expect(extractBambuObservedSlots({ print: { tray_now: 254, vt_tray: { tray_type: 'PETG' } } })[0]?.state).toBe('feeding');
  });

  it('normalizes known values and rejects malformed colors', () => {
    expect(normalizeBambuMaterial('support pla')).toBe('SUPPORT');
    expect(normalizeBambuMaterial('nylon')).toBe('PA');
    expect(normalizeBambuMaterial('unknown blend')).toBe('OTHER');
    expect(normalizeBambuColor('ABCDEF12')).toBe('#ABCDEF');
    expect(normalizeBambuColor('not-a-color')).toBeNull();
  });
});

describe('Bambu LAN MQTT safe request generation', () => {
  it('generates only the observational pushall request and no RFID/control command names', () => {
    const request = createBambuPushAllRequest('seq-1');
    expect(request).toEqual({ pushing: { sequence_id: 'seq-1', command: 'pushall', version: 1, push_target: 1 } });

    const serialized = JSON.stringify(request).toLowerCase();
    expect(serialized).not.toContain('rfid');
    expect(serialized).not.toContain('gcode');
    expect(serialized).not.toContain('print');
    expect(serialized).not.toContain('pause');
    expect(serialized).not.toContain('resume');
    expect(serialized).not.toContain('stop');
  });
});

describe('BambuLanMqttConnector', () => {
  it('fails LAN printers without credentials instead of falling back to a mock success', async () => {
    let factoryCalled = false;
    const connector = new BambuLanMqttConnector({
      resolveCredentials: () => ({ lan_access_code: null, device_id: null }),
      mqtt_factory: () => {
        factoryCalled = true;
        throw new Error('should not connect');
      }
    });

    const result = await connector.testConnection({
      id: 'printer-1',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      deleted_at: null,
      version: 1,
      name: 'P1S',
      manufacturer: 'Bambu Lab',
      model: 'P1S',
      serial_hash: '0123456789abcdef',
      host: '192.168.1.50',
      lan_access_code_secret_ref: null,
      connection_mode: 'lan',
      capability_level: 'manual_only',
      last_seen_at: null,
      firmware_version: null,
      notes: null
    });

    expect(result.ok).toBe(false);
    expect(result.observed_slots).toEqual([]);
    expect(factoryCalled).toBe(false);
  });

  it('subscribes to the exact report topic and publishes at most one safe request', async () => {
    const subscriptions: string[] = [];
    const publications: Array<{ topic: string; payload: string }> = [];
    const reportTopic = 'device/DEV123/report';
    const connector = new BambuLanMqttConnector({
      resolveCredentials: () => ({ lan_access_code: '12345678', device_id: 'DEV123' }),
      snapshot_timeout_ms: 20,
      mqtt_factory: (_url, _options) => {
        const handlers: Record<string, (...args: never[]) => void> = {};
        setTimeout(() => handlers.connect?.(), 0);
        const client: BambuMqttClientLike = {
          on(event: 'connect' | 'message' | 'error', listener: (() => void) | ((topic: string, payload: Uint8Array | Buffer | string) => void) | ((error: Error) => void)) {
            handlers[event] = listener as (...args: never[]) => void;
            return client;
          },
          subscribe(topic: string, callback: (error?: Error | null) => void) {
            subscriptions.push(topic);
            callback(null);
          },
          publish(topic: string, payload: string, callback?: (error?: Error | null) => void) {
            publications.push({ topic, payload });
            handlers.message?.(reportTopic as never, Buffer.from(JSON.stringify({ print: { ams: { ams: [{ id: '0', tray: [{ id: '0', tray_type: 'PLA', tray_color: 'FFFFFF00' }] }] } } })) as never);
            callback?.(null);
          },
          end(_force?: boolean, callback?: () => void) {
            callback?.();
          }
        };
        return client;
      }
    });

    const result = await connector.syncNow({
      id: 'printer-1',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      deleted_at: null,
      version: 1,
      name: 'P1S',
      manufacturer: 'Bambu Lab',
      model: 'P1S',
      serial_hash: '0123456789abcdef',
      host: '192.168.1.50',
      lan_access_code_secret_ref: null,
      connection_mode: 'lan',
      capability_level: 'manual_only',
      last_seen_at: null,
      firmware_version: null,
      notes: null
    }, []);

    expect(result.observed_slots).toHaveLength(1);
    expect(subscriptions).toEqual([reportTopic]);
    expect(subscriptions[0]).not.toContain('#');
    expect(subscriptions[0]).not.toContain('+');
    expect(publications).toHaveLength(1);
    expect(publications[0]?.topic).toBe('device/DEV123/request');
    expect(JSON.parse(publications[0]?.payload ?? '{}')).toMatchObject({ pushing: { command: 'pushall' } });
  });
});

describe('BambuMqttConnectionServer', () => {
  it('coalesces concurrent connector snapshots and serves a short cache', async () => {
    let now = 1_700_000_000_000;
    let factoryCalls = 0;
    const reportTopic = 'device/DEV123/report';
    const server = new BambuMqttConnectionServer({
      snapshot_timeout_ms: 20,
      cache_ttl_ms: 1000,
      now: () => now,
      mqtt_factory: () => {
        factoryCalls += 1;
        const handlers: Record<string, (...args: never[]) => void> = {};
        setTimeout(() => handlers.connect?.(), 0);
        const client: BambuMqttClientLike = {
          on(event: 'connect' | 'message' | 'error', listener: (() => void) | ((topic: string, payload: Uint8Array | Buffer | string) => void) | ((error: Error) => void)) {
            handlers[event] = listener as (...args: never[]) => void;
            return client;
          },
          subscribe(_topic: string, callback: (error?: Error | null) => void) {
            callback(null);
          },
          publish(_topic: string, _payload: string, callback?: (error?: Error | null) => void) {
            handlers.message?.(reportTopic as never, Buffer.from(JSON.stringify({ print: { ams: { ams: [{ id: '0', tray: [{ id: '0', tray_type: 'PLA', tray_color: 'FFFFFF00' }] }] } } })) as never);
            callback?.(null);
          },
          end(_force?: boolean, callback?: () => void) {
            callback?.();
          }
        };
        return client;
      }
    });
    const connector = new BambuLanMqttConnector({
      resolveCredentials: () => ({ lan_access_code: '12345678', device_id: 'DEV123' }),
      snapshot_source: server
    });
    await connector.start?.();

    const printer = lanPrinter();
    const [first, second] = await Promise.all([
      connector.syncNow(printer, []),
      connector.syncNow(printer, [])
    ]);
    expect(first.observed_slots).toHaveLength(1);
    expect(second.observed_slots).toHaveLength(1);
    expect(factoryCalls).toBe(1);

    first.observed_slots[0]!.display_name = 'mutated';
    const cached = await connector.syncNow(printer, []);
    expect(cached.observed_slots[0]?.display_name).toBe('AMS 1 Slot 1');
    expect(factoryCalls).toBe(1);

    now += 1001;
    await connector.syncNow(printer, []);
    expect(factoryCalls).toBe(2);
    await connector.stop?.();
  });

  it('stops active MQTT clients and reports aborted snapshots', async () => {
    let endCalls = 0;
    const server = new BambuMqttConnectionServer({
      snapshot_timeout_ms: 1000,
      mqtt_factory: () => {
        const client: BambuMqttClientLike = {
          on() {
            return client;
          },
          subscribe() {},
          publish() {},
          end(_force?: boolean, callback?: () => void) {
            endCalls += 1;
            callback?.();
          }
        };
        return client;
      }
    });

    const snapshotRequest = server.readSnapshot(lanPrinter(), { lan_access_code: '12345678', device_id: 'DEV123' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    server.stop();
    const snapshot = await snapshotRequest;

    expect(snapshot.error).toMatch(/aborted/);
    expect(endCalls).toBeGreaterThan(0);
  });
});

function lanPrinter() {
  return {
    id: 'printer-1',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    deleted_at: null,
    version: 1,
    name: 'P1S',
    manufacturer: 'Bambu Lab' as const,
    model: 'P1S',
    serial_hash: '0123456789abcdef',
    host: '192.168.1.50',
    lan_access_code_secret_ref: null,
    connection_mode: 'lan' as const,
    capability_level: 'manual_only' as const,
    last_seen_at: null,
    firmware_version: null,
    notes: null
  };
}
