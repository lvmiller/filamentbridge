import { describe, expect, it } from 'vitest';
import {
  applyWeightDelta,
  assertSpoolWeightInvariant,
  catalogImportSchema,
  classifyRawNfcPayload,
  colorHexToRgb,
  createSignedNfcPayload,
  createUnsignedNfcPayload,
  decodeNfcPayload,
  finalizeNfcPayload,
  materialTypeFromUnknown,
  createPrinterSchema,
  printerSchema
} from './index';

describe('shared domain invariants and NFC codec', () => {
  it('enforces weight invariants and safe deltas', () => {
    expect(() => assertSpoolWeightInvariant({ initial_filament_weight_g: 1000, remaining_filament_weight_g: 1001, empty_spool_weight_g: 250 })).toThrow(/remaining/);
    expect(applyWeightDelta(500, -125)).toBe(375);
    expect(() => applyWeightDelta(10, -11)).toThrow(/negative/);
  });

  it('validates catalog import and normalizes unknown material', () => {
    const item = {
      brand: 'Local', product_line: 'PLA', material_type: 'PLA', diameter_mm: 1.75,
      color_name: 'Blue', color_hex: '#0000ff', nozzle_temp_min_c: 190, nozzle_temp_max_c: 220,
      bed_temp_min_c: 35, bed_temp_max_c: 60, drying_temp_c: 45, drying_time_minutes: 120,
      density_g_cm3: 1.24, bambu_studio_preset_name: null, orca_slicer_preset_name: null,
      vendor_sku: null, notes: null
    };
    expect(catalogImportSchema.parse({ items: [item] }).items).toHaveLength(1);
    expect(materialTypeFromUnknown('mystery')).toBe('OTHER');
  });

  it('round-trips fixed-width companion NFC payloads', () => {
    const unsigned = createUnsignedNfcPayload({
      instance_id: 'instance', tag_id: 'tag', spool_id: 'spool', material_type: 'ASA', diameter_mm: 1.75,
      color_hex: '#ff9900', remaining_weight_g: 321, nozzle_temp_min_c: 240, nozzle_temp_max_c: 260,
      drying_temp_c: 70, drying_time_minutes: 480, written_at_epoch_seconds: 12345, public_key_id: 'key'
    });
    const payload = finalizeNfcPayload(unsigned, new Uint8Array(16).fill(7), new Uint8Array(64).fill(9));
    const decoded = decodeNfcPayload(createSignedNfcPayload({
      instance_id: 'instance', tag_id: 'tag', spool_id: 'spool', material_type: 'ASA', diameter_mm: 1.75,
      color_hex: '#ff9900', remaining_weight_g: 321, nozzle_temp_min_c: 240, nozzle_temp_max_c: 260,
      drying_temp_c: 70, drying_time_minutes: 480, written_at_epoch_seconds: 12345, public_key_id: 'key',
      payload_hash: new Uint8Array(16).fill(7), signature: new Uint8Array(64).fill(9)
    }));
    expect(payload).toHaveLength(144);
    expect(classifyRawNfcPayload(payload)).toBe('filamentbridge');
    expect(decoded.material_type).toBe('ASA');
    expect(decoded.color_hex).toBe('#ff9900');
    expect(Array.from(colorHexToRgb('#ff9900'))).toEqual([255, 153, 0]);
  });

  it('constrains Bambu MQTT device identifiers and encrypted secret storage', () => {
    expect(() => createPrinterSchema.parse({
      name: 'P1S', manufacturer: 'Bambu Lab', model: 'P1S', serial: 'SERIAL123', device_id: 'SERIAL/#',
      host: '192.168.1.50', lan_access_code: '12345678', connection_mode: 'lan', firmware_version: null, notes: null
    })).toThrow(/MQTT topic/);
    expect(createPrinterSchema.parse({
      name: 'P1S', manufacturer: 'Bambu Lab', model: 'P1S', serial: 'SERIAL123', device_id: 'SERIAL_123-ABC',
      host: '192.168.1.50', lan_access_code: '12345678', connection_mode: 'lan', firmware_version: null, notes: null
    }).device_id).toBe('SERIAL_123-ABC');
    expect(printerSchema.parse({
      id: 'printer-1', created_at: new Date().toISOString(), updated_at: new Date().toISOString(), deleted_at: null,
      version: 1, name: 'P1S', manufacturer: 'Bambu Lab', model: 'P1S', serial_hash: '0123456789abcdef',
      host: '192.168.1.50', lan_access_code_secret_ref: `secretbox:bambu-lan-v1:${'x'.repeat(800)}`,
      connection_mode: 'lan', capability_level: 'read_only', last_seen_at: null, firmware_version: null, notes: null
    }).lan_access_code_secret_ref).toContain('secretbox:bambu-lan-v1:');
  });
});
