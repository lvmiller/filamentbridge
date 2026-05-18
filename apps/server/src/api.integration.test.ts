import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { openFilamentBridgeDatabase, type FilamentBridgeRepository } from '../../../packages/db/src/index';
import { createSigningKeyStore } from '../../../packages/crypto/src/index';
import type { FastifyInstance } from 'fastify';

let app: FastifyInstance;
let repo: FilamentBridgeRepository;
let tempDir: string;
let token = '';

beforeEach(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'fb-api-'));
  repo = openFilamentBridgeDatabase({ path: ':memory:' });
  const signingKeyStore = createSigningKeyStore('fb_api_test');
  repo.setInstanceId(signingKeyStore.instance_id);
  app = await createApp({ repo, signingKeyStore, keyDirectory: join(tempDir, 'keys'), backupDirectory: join(tempDir, 'backups'), databasePath: ':memory:', appSecret: 'test-secret', webDistPath: join(tempDir, 'web') });
});

afterEach(async () => {
  await app.close();
  repo.close();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('FilamentBridge API integration', () => {
  it('covers setup, inventory, NFC, sync, printer, usage review, backup, and boundaries', async () => {
    expect((await get('/api/setup/status')).configured).toBe(false);
    const setup = await post('/api/setup/owner', { email: 'owner@example.local', display_name: 'Owner', password: 'change-me-local-owner' }, false);
    token = setup.token;
    expect(setup.user.role).toBe('owner');

    const catalog = await post('/api/catalog-items', catalogPayload());
    const spool = await post('/api/spools', spoolPayload(catalog.id));
    expect(spool.remaining_filament_weight_g).toBe(1000);
    expect(spool.short_code).toMatch(/^FB-/);
    expect((await get(`/api/spools/lookup?code=${spool.short_code}`)).id).toBe(spool.id);
    const labelTemplate = await post('/api/labels/templates', { name: 'Default QR labels', medium: 'sheet', page_width_mm: 210, page_height_mm: 297, label_width_mm: 70, label_height_mm: 35, rows: 8, columns: 2, code_type: 'qr', template_text: '{{display_name}}\\n{{short_code}}', included_fields: ['short_code', 'remaining_filament_weight_g'] });
    const renderedLabels = await post('/api/labels/render', { template_id: labelTemplate.id, spool_ids: [spool.id], base_url: 'http://localhost:3000' });
    expect(renderedLabels.mime_type).toBe('image/svg+xml');
    expect(renderedLabels.svg).toContain(spool.short_code);

    const adjusted = await post('/api/usage-events/adjustment', { spool_id: spool.id, expected_version: spool.version, new_remaining_weight_g: 900, notes: 'scale' });
    expect(adjusted.spool.remaining_filament_weight_g).toBe(900);
    expect(adjusted.usage_event.estimated_material_cost_amount).toBe(2.5);
    await expect(post('/api/usage-events/adjustment', { spool_id: spool.id, expected_version: spool.version, new_remaining_weight_g: 800, notes: null })).rejects.toThrow(/409/);

    const assigned = await post('/api/nfc/assign', { spool_id: spool.id, tag_uid: 'demo-tag', expected_spool_version: adjusted.spool.version });
    const write = await post('/api/nfc/write-payload', { tag_id: assigned.tag.id, spool_id: assigned.spool.id, expected_spool_version: assigned.spool.version, force_stale_rewrite: false });
    expect(write.boundary).toContain('companion NFC tags');
    expect((await post('/api/nfc/verify', { encoded_payload: write.encoded_payload })).ok).toBe(true);
    expect((await post('/api/nfc/scan', { tag_uid: 'demo-tag', encoded_payload: write.encoded_payload })).classification).toBe('app_owned_valid');

    await new Promise((resolve) => setTimeout(resolve, 5));
    const staleSource = await get(`/api/spools/${spool.id}`);
    await post('/api/usage-events/adjustment', { spool_id: spool.id, expected_version: staleSource.version, new_remaining_weight_g: 850, notes: 'after tag write' });
    expect((await post('/api/nfc/scan', { tag_uid: 'demo-tag', encoded_payload: write.encoded_payload })).classification).toBe('app_owned_stale');
    const tagAfterStale = (await get('/api/nfc/tags'))[0];
    const retired = await post('/api/nfc/retire', { tag_id: tagAfterStale.id, expected_version: tagAfterStale.version });
    expect(retired.tag.status).toBe('retired');
    expect((await post('/api/nfc/scan', { encoded_payload: 'Zm9yZWlnbg', tag_uid: 'foreign' })).classification).toBe('foreign');

    const conflict = await post('/api/sync/events', { device_id: setup.device.id, events: [{ id: 'offline-1', entity_type: 'spool', entity_id: spool.id, event_type: 'manual_adjustment', entity_version: 1, local_created_at: new Date().toISOString(), payload: { expected_version: 1, new_remaining_weight_g: 700 } }] });
    expect(conflict.conflicts).toHaveLength(1);

    const printer = await post('/api/printers', { name: 'P1S', manufacturer: 'Bambu Lab', model: 'P1S', serial: 'printer-serial', host: '192.168.1.50', lan_access_code: '12345678', connection_mode: 'manual', firmware_version: null, notes: null });
    const testConnection = await post(`/api/printers/${printer.id}/test-connection`, {});
    expect(testConnection.ok).toBe(true);
    await post(`/api/printers/${printer.id}/sync-now`, {});
    const slots = await get(`/api/printers/${printer.id}/slots`);
    expect(slots.length).toBeGreaterThan(0);
    const currentSpool = await get(`/api/spools/${spool.id}`);
    const mapped = await patch(`/api/printer-slots/${slots[0].id}/mapping`, { mapped_spool_id: currentSpool.id, expected_version: slots[0].version });
    expect(mapped.mapped_spool_id).toBe(currentSpool.id);
    await post(`/api/printers/${printer.id}/sync-now`, {});
    const pendingUsage = (await get('/api/usage-events?review_status=pending'))[0];
    expect(pendingUsage.review_status).toBe('pending');
    const approved = await post(`/api/usage-events/${pendingUsage.id}/approve`, {});
    expect(approved.usage_event.review_status).toBe('approved');

    await expect(post(`/api/catalog-items/${catalog.id}/delete`, { expected_version: catalog.version })).rejects.toThrow(/400/);
    const spoolBeforeDelete = await get(`/api/spools/${spool.id}`);
    const removedSpool = await post(`/api/spools/${spool.id}/delete`, { expected_version: spoolBeforeDelete.version });
    expect(removedSpool.deleted_at).not.toBeNull();
    expect((await get('/api/spools')).some((item: { id: string }) => item.id === spool.id)).toBe(false);
    await expect(get(`/api/spools/${spool.id}`)).rejects.toThrow(/404/);
    expect((await get(`/api/printers/${printer.id}/slots`))[0].mapped_spool_id).toBeNull();
    const removedCatalog = await post(`/api/catalog-items/${catalog.id}/delete`, { expected_version: catalog.version });
    expect(removedCatalog.deleted_at).not.toBeNull();
    expect((await get('/api/catalog-items')).some((item: { id: string }) => item.id === catalog.id)).toBe(false);
    const printerBeforeDelete = (await get('/api/printers')).find((item: { id: string }) => item.id === printer.id);
    expect(printerBeforeDelete).toBeDefined();
    const removedPrinter = await post(`/api/printers/${printer.id}/delete`, { expected_version: printerBeforeDelete!.version });
    expect(removedPrinter.deleted_at).not.toBeNull();
    expect((await get('/api/printers')).some((item: { id: string }) => item.id === printer.id)).toBe(false);
    await expect(get(`/api/printers/${printer.id}/slots`)).rejects.toThrow(/404/);

    const backup = await post('/api/backups', {});
    expect(backup.includes_database).toBe(true);
    expect(backup.includes_signing_keys).toBe(true);
    const boundary = await get('/api/boundary');
    expect(boundary.writes_bambu_rfid).toBe(false);
    expect(boundary.boundary).toMatch(/does not clone, forge, emulate/);
  });
});

async function get(path: string): Promise<any> {
  const response = await app.inject({ method: 'GET', url: path, headers: authHeader() });
  return unwrap(response.statusCode, response.body);
}

async function post(path: string, payload: unknown, authenticated = true): Promise<any> {
  const response = await app.inject({ method: 'POST', url: path, headers: { ...(authenticated ? authHeader() : {}), 'content-type': 'application/json' }, payload: JSON.stringify(payload) });
  return unwrap(response.statusCode, response.body);
}

async function patch(path: string, payload: unknown): Promise<any> {
  const response = await app.inject({ method: 'PATCH', url: path, headers: { ...authHeader(), 'content-type': 'application/json' }, payload: JSON.stringify(payload) });
  return unwrap(response.statusCode, response.body);
}

function authHeader(): Record<string, string> {
  return token === '' ? {} : { authorization: `Bearer ${token}` };
}

function unwrap(statusCode: number, body: string): any {
  const parsed = JSON.parse(body);
  if (statusCode < 200 || statusCode >= 300) {
    throw new Error(`${statusCode}: ${parsed.error?.message ?? body}`);
  }
  return parsed.data;
}

function catalogPayload(): Record<string, unknown> {
  return { brand: 'Bambu Lab', product_line: 'PLA Basic', material_type: 'PLA', diameter_mm: 1.75, color_name: 'Blue', color_hex: '#1e88e5', nozzle_temp_min_c: 190, nozzle_temp_max_c: 230, bed_temp_min_c: 35, bed_temp_max_c: 60, drying_temp_c: 45, drying_time_minutes: 240, density_g_cm3: 1.24, bambu_studio_preset_name: 'Bambu PLA Basic', orca_slicer_preset_name: 'Bambu PLA Basic', vendor_sku: null, notes: null };
}

function spoolPayload(catalogId: string): Record<string, unknown> {
  return { catalog_item_id: catalogId, display_name: 'Blue PLA', manufacturer_name: 'Bambu Lab', material_type: 'PLA', diameter_mm: 1.75, color_hex: '#1e88e5', initial_filament_weight_g: 1000, remaining_filament_weight_g: 1000, empty_spool_weight_g: 250, purchase_date: null, opened_at: null, status: 'sealed', storage_location: 'Shelf', notes: null, purchase_price_amount: 24.99, purchase_currency: 'USD', vendor_lot: 'LOT-1' };
}
