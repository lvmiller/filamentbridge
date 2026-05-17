import { describe, expect, it } from 'vitest';
import { openFilamentBridgeDatabase, seedDemoData } from './index';

describe('FilamentBridgeRepository', () => {
  it('applies manual adjustments as usage events with optimistic concurrency', () => {
    const repo = openFilamentBridgeDatabase({ path: ':memory:' });
    const { spool } = seedDemoData(repo);
    const adjusted = repo.manualAdjustment(spool.id, spool.version, 875, 'weighed on scale');
    expect(adjusted.spool.remaining_filament_weight_g).toBe(875);
    expect(adjusted.usage_event.before_weight_g).toBe(1000);
    expect(adjusted.usage_event.after_weight_g).toBe(875);
    expect(() => repo.manualAdjustment(spool.id, spool.version, 800, null)).toThrow(/version conflict/);
    repo.close();
  });

  it('keeps one active NFC tag and retires historical tags for audit', () => {
    const repo = openFilamentBridgeDatabase({ path: ':memory:' });
    repo.setInstanceId('fb_test');
    const { spool } = seedDemoData(repo);
    const first = repo.assignNfcTag({ tag_uid_hash: 'uidhash-1111111111111111', spool_id: spool.id, expected_spool_version: spool.version, instance_id: 'fb_test', public_key_id: 'key-1' });
    const second = repo.assignNfcTag({ tag_uid_hash: 'uidhash-2222222222222222', spool_id: spool.id, expected_spool_version: first.spool.version, instance_id: 'fb_test', public_key_id: 'key-1' });
    expect(second.spool.active_tag_id).toBe(second.tag.id);
    expect(repo.getTag(first.tag.id).status).toBe('retired');
    repo.close();
  });

  it('soft-deletes removable inventory while cleaning active relationships', () => {
    const repo = openFilamentBridgeDatabase({ path: ':memory:' });
    repo.setInstanceId('fb_delete');
    const { catalog_item: catalog, spool } = seedDemoData(repo);
    const assigned = repo.assignNfcTag({ tag_uid_hash: 'uidhash-delete-111111', spool_id: spool.id, expected_spool_version: spool.version, instance_id: 'fb_delete', public_key_id: 'key-1' });
    const printer = repo.createPrinter({
      name: 'P1S',
      manufacturer: 'Bambu Lab',
      model: 'P1S',
      serial_hash: '0123456789abcdef',
      host: '192.168.1.50',
      lan_access_code_secret_ref: null,
      connection_mode: 'manual',
      capability_level: 'manual_only',
      firmware_version: null,
      notes: null
    });
    const slot = repo.createPrinterSlot({
      printer_id: printer.id,
      unit_type: 'ams',
      unit_index: 0,
      slot_index: 0,
      display_name: 'AMS Slot 1',
      mapped_spool_id: assigned.spool.id,
      detected_material_type: null,
      detected_color_hex: null,
      detected_remaining_percent: null,
      state: 'loaded'
    });

    expect(() => repo.deleteCatalogItem(catalog.id, catalog.version)).toThrow(/active spools/);

    const deletedSpool = repo.deleteSpool(assigned.spool.id, assigned.spool.version);
    expect(deletedSpool.deleted_at).not.toBeNull();
    expect(repo.listSpools()).toHaveLength(0);
    expect(repo.getTag(assigned.tag.id).status).toBe('retired');
    expect(repo.getPrinterSlot(slot.id).mapped_spool_id).toBeNull();

    const deletedCatalog = repo.deleteCatalogItem(catalog.id, catalog.version);
    expect(deletedCatalog.deleted_at).not.toBeNull();
    expect(repo.listCatalogItems()).toHaveLength(0);

    const deletedPrinter = repo.deletePrinter(printer.id, printer.version);
    expect(deletedPrinter.deleted_at).not.toBeNull();
    expect(repo.listPrinters()).toHaveLength(0);
    expect(() => repo.getPrinterSlot(slot.id)).toThrow(/not found/);
    repo.close();
  });

  it('exports and restores editable local inventory data', () => {
    const repo = openFilamentBridgeDatabase({ path: ':memory:' });
    repo.setInstanceId('fb_export');
    seedDemoData(repo);
    const snapshot = repo.createExportSnapshot();
    const restored = openFilamentBridgeDatabase({ path: ':memory:' });
    restored.restoreExportSnapshot(snapshot);
    expect(restored.listCatalogItems()).toHaveLength(1);
    expect(restored.listSpools()[0]?.display_name).toBe('Demo PLA Blue');
    repo.close();
    restored.close();
  });
});
