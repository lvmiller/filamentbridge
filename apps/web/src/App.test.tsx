/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';

type EntityFixture = Record<string, unknown> & { version: number };

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe('FilamentBridge web UI', () => {
  it('renders first-run setup and the companion-tag boundary', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: { configured: false, instance_id: 'fb_test', boundary: 'boundary' } }), { headers: { 'content-type': 'application/json' } })));
    render(<App />);
    expect(await screen.findByRole('heading', { name: /first-run setup/i })).toBeInTheDocument();
    expect(screen.getByText(/companion NFC tags/i)).toBeInTheDocument();
  });

  it('renders all primary screens for an authenticated owner', async () => {
    window.localStorage.setItem('fb_token', 'token');
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const data = fixtureFor(url);
      return new Response(JSON.stringify({ data }), { headers: { 'content-type': 'application/json' } });
    }));
    render(<App />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Dashboard' })).toBeInTheDocument());
    for (const label of ['Inventory', 'Catalog', 'Spool detail', 'Printer setup', 'Usage review', 'NFC audit', 'Backup/export', 'Security/devices']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
    expect(screen.getByText(/does not clone, forge, emulate/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Printer setup' }));
    expect(screen.getByLabelText(/MQTT device ID/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/LAN access code/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Test MQTT connection' })).toBeInTheDocument();
  });

  it('lets users remove spools, catalog items, and printers from the UI', async () => {
    window.localStorage.setItem('fb_token', 'token');
    vi.stubGlobal('confirm', vi.fn(() => true));
    const now = new Date().toISOString();
    let catalog = [catalogFixture(now)];
    let spools = [spoolFixture(now)];
    let printers = [printerFixture(now)];
    const posts: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (method === 'POST' && url.endsWith('/api/spools/s1/delete')) {
        posts.push(url);
        const removed = spools[0]!;
        spools = [];
        return json({ ...removed, deleted_at: now, version: removed.version + 1, status: 'retired' });
      }
      if (method === 'POST' && url.endsWith('/api/catalog-items/c1/delete')) {
        posts.push(url);
        const removed = catalog[0]!;
        catalog = [];
        return json({ ...removed, deleted_at: now, version: removed.version + 1 });
      }
      if (method === 'POST' && url.endsWith('/api/printers/p1/delete')) {
        posts.push(url);
        const removed = printers[0]!;
        printers = [];
        return json({ ...removed, deleted_at: now, version: removed.version + 1 });
      }
      if (url.endsWith('/api/setup/status')) return json({ configured: true, instance_id: 'fb_test', boundary: 'boundary' });
      if (url.endsWith('/api/auth/me')) return json(fixtureFor(url));
      if (url.endsWith('/api/catalog-items')) return json(catalog);
      if (url.endsWith('/api/spools')) return json(spools);
      if (url.endsWith('/api/nfc/tags')) return json([]);
      if (url.endsWith('/api/printers')) return json(printers);
      if (url.endsWith('/api/printers/p1/slots')) return json([]);
      if (url.endsWith('/api/usage-events')) return json([]);
      if (url.endsWith('/api/devices')) return json([]);
      return json([]);
    }));

    render(<App />);
    await screen.findByRole('button', { name: 'Inventory' });

    fireEvent.click(screen.getByRole('button', { name: 'Inventory' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Remove spool' }));
    await waitFor(() => expect(posts).toContain('/api/spools/s1/delete'));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Remove spool' })).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Catalog' }));
    const removeCatalog = await screen.findByRole('button', { name: 'Remove' });
    expect(removeCatalog).toBeEnabled();
    fireEvent.click(removeCatalog);
    await waitFor(() => expect(posts).toContain('/api/catalog-items/c1/delete'));

    fireEvent.click(screen.getByRole('button', { name: 'Printer setup' }));
    expect(await screen.findByText(/does not run an MQTT broker in Docker/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove printer' }));
    await waitFor(() => expect(posts).toContain('/api/printers/p1/delete'));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Remove printer' })).not.toBeInTheDocument());
  });
});

function fixtureFor(url: string): unknown {
  if (url.endsWith('/api/setup/status')) return { configured: true, instance_id: 'fb_test', boundary: 'boundary' };
  if (url.endsWith('/api/auth/me')) return { user: { id: 'u1', email: 'owner@example.local', display_name: 'Owner', role: 'owner', last_login_at: null, status: 'active', created_at: new Date().toISOString(), updated_at: new Date().toISOString() }, device: { id: 'd1', user_id: 'u1', device_type: 'web', name: 'Browser', paired_at: new Date().toISOString(), last_seen_at: null, trusted: true, revoked_at: null } };
  if (url.endsWith('/api/catalog-items')) return [];
  if (url.endsWith('/api/spools')) return [];
  if (url.endsWith('/api/nfc/tags')) return [];
  if (url.endsWith('/api/printers')) return [{ id: 'p1', name: 'P1S', manufacturer: 'Bambu Lab', model: 'P1S', serial_hash: '0123456789abcdef', host: '192.168.1.50', lan_access_code_secret_ref: null, connection_mode: 'lan', capability_level: 'read_only', last_seen_at: null, firmware_version: null, notes: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), deleted_at: null, version: 1 }];
  if (url.endsWith('/api/printers/p1/slots')) return [];
  if (url.endsWith('/api/usage-events')) return [];
  if (url.endsWith('/api/devices')) return [];
  return [];
}

function json(data: unknown): Response {
  return new Response(JSON.stringify({ data }), { headers: { 'content-type': 'application/json' } });
}

function catalogFixture(now: string): EntityFixture {
  return { id: 'c1', brand: 'Bambu Lab', product_line: 'PLA Basic', material_type: 'PLA', diameter_mm: 1.75, color_name: 'Blue', color_hex: '#1e88e5', nozzle_temp_min_c: 190, nozzle_temp_max_c: 230, bed_temp_min_c: 35, bed_temp_max_c: 60, drying_temp_c: 45, drying_time_minutes: 240, density_g_cm3: 1.24, bambu_studio_preset_name: 'Bambu PLA Basic', orca_slicer_preset_name: 'Bambu PLA Basic', vendor_sku: null, notes: null, created_at: now, updated_at: now, deleted_at: null, version: 1 };
}

function spoolFixture(now: string): EntityFixture {
  return { id: 's1', catalog_item_id: 'c1', display_name: 'Blue PLA', manufacturer_name: 'Bambu Lab', material_type: 'PLA', diameter_mm: 1.75, color_hex: '#1e88e5', initial_filament_weight_g: 1000, remaining_filament_weight_g: 1000, empty_spool_weight_g: 250, purchase_date: null, opened_at: null, status: 'sealed', storage_location: 'Shelf', notes: null, active_tag_id: null, created_at: now, updated_at: now, deleted_at: null, version: 1 };
}

function printerFixture(now: string): EntityFixture {
  return { id: 'p1', name: 'P1S', manufacturer: 'Bambu Lab', model: 'P1S', serial_hash: '0123456789abcdef', host: '192.168.1.50', lan_access_code_secret_ref: null, connection_mode: 'lan', capability_level: 'read_only', last_seen_at: null, firmware_version: null, notes: null, created_at: now, updated_at: now, deleted_at: null, version: 1 };
}
