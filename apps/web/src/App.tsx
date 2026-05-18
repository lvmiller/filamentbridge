import { FormEvent, useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react';
import {
  OFFICIAL_RFID_BOUNDARY,
  FilamentBridgeClient,
  type AuthSession,
  type Device,
  type FilamentCatalogItem,
  type LabelTemplate,
  type NfcScanResult,
  type NfcTag,
  type NfcWritePayloadResult,
  type Printer,
  type PrinterSlot,
  type SetupStatus,
  type Spool,
  type RenderedLabels,
  type UsageEvent
} from '@filamentbridge/shared';

type Screen = 'dashboard' | 'inventory' | 'catalog' | 'spool' | 'printers' | 'usage' | 'nfc' | 'labels' | 'backup' | 'security';

type AppState = {
  setup: SetupStatus | null;
  session: AuthSession | null;
  catalog: FilamentCatalogItem[];
  spools: Spool[];
  tags: NfcTag[];
  printers: Printer[];
  slots: PrinterSlot[];
  usage: UsageEvent[];
  labelTemplates: LabelTemplate[];
  devices: Device[];
};

const initialState: AppState = {
  setup: null,
  session: null,
  catalog: [],
  spools: [],
  tags: [],
  printers: [],
  slots: [],
  usage: [],
  labelTemplates: [],
  devices: []
};

export function App(): ReactElement {
  const [state, setState] = useState<AppState>(initialState);
  const [screen, setScreen] = useState<Screen>('dashboard');
  const [selectedSpoolId, setSelectedSpoolId] = useState<string | null>(null);
  const [message, setMessage] = useState<string>('');
  const token = state.session?.token ?? window.localStorage.getItem('fb_token');
  const client = useMemo(() => new FilamentBridgeClient('', token), [token]);

  async function refresh(): Promise<void> {
    const setup = await client.get<SetupStatus>('/api/setup/status');
    if (!setup.configured) {
      setState((current) => ({ ...current, setup }));
      return;
    }
    let session = state.session;
    if (token !== null && session === null) {
      client.setToken(token);
      try {
        const me = await client.get<Omit<AuthSession, 'token'>>('/api/auth/me');
        session = { token, ...me };
      } catch {
        window.localStorage.removeItem('fb_token');
      }
    }
    if (session === null) {
      setState((current) => ({ ...current, setup, session: null }));
      return;
    }
    client.setToken(session.token);
    const [catalog, spools, tags, printers, usage, devices, labelTemplates] = await Promise.all([
      client.get<FilamentCatalogItem[]>('/api/catalog-items'),
      client.get<Spool[]>('/api/spools'),
      client.get<NfcTag[]>('/api/nfc/tags'),
      client.get<Printer[]>('/api/printers'),
      client.get<UsageEvent[]>('/api/usage-events'),
      client.get<Device[]>('/api/devices'),
      client.get<LabelTemplate[]>('/api/labels/templates')
    ]);
    const firstPrinter = printers[0];
    const slots = firstPrinter === undefined ? [] : await client.get<PrinterSlot[]>(`/api/printers/${firstPrinter.id}/slots`);
    setState({ setup, session, catalog, spools, tags, printers, slots, usage, devices, labelTemplates });
  }

  useEffect(() => {
    refresh().catch((error: unknown) => setMessage(error instanceof Error ? error.message : 'Failed to load application state'));
  }, []);

  async function run(action: () => Promise<void>, success: string): Promise<void> {
    try {
      setMessage('');
      await action();
      await refresh();
      setMessage(success);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  if (state.setup === null) {
    return <main className="center-card"><h1>FilamentBridge</h1><p>Loading local server state…</p></main>;
  }

  if (!state.setup.configured) {
    return <SetupScreen client={client} onDone={(session) => { window.localStorage.setItem('fb_token', session.token); setState((current) => ({ ...current, session, setup: { ...state.setup as SetupStatus, configured: true } })); }} message={message} setMessage={setMessage} />;
  }

  if (state.session === null) {
    return <LoginScreen client={client} onDone={(session) => { window.localStorage.setItem('fb_token', session.token); setState((current) => ({ ...current, session })); refresh().catch((error: unknown) => setMessage(error instanceof Error ? error.message : String(error))); }} message={message} setMessage={setMessage} />;
  }

  const selectedSpool = state.spools.find((spool) => spool.id === selectedSpoolId) ?? state.spools[0] ?? null;

  return (
    <div className="app-shell">
      <aside>
        <h1>FilamentBridge</h1>
        <p className="boundary">{OFFICIAL_RFID_BOUNDARY}</p>
        <nav aria-label="Primary screens">
          {navItems.map((item) => <button key={item.screen} className={screen === item.screen ? 'active' : ''} onClick={() => setScreen(item.screen)}>{item.label}</button>)}
        </nav>
      </aside>
      <main>
        <header className="topbar">
          <div><strong>{state.session.user.display_name}</strong><span>{state.setup.instance_id}</span></div>
          <button onClick={() => run(async () => { await client.post('/api/auth/logout'); window.localStorage.removeItem('fb_token'); setState((current) => ({ ...current, session: null })); }, 'Logged out')}>Logout</button>
        </header>
        {message !== '' && <p role="status" className="message">{message}</p>}
        {screen === 'dashboard' && <Dashboard state={state} />}
        {screen === 'inventory' && <InventoryScreen state={state} client={client} run={run} selectSpool={(id) => { setSelectedSpoolId(id); setScreen('spool'); }} />}
        {screen === 'catalog' && <CatalogScreen state={state} client={client} run={run} />}
        {screen === 'spool' && <SpoolDetail spool={selectedSpool} tags={state.tags} usage={state.usage} client={client} run={run} />}
        {screen === 'printers' && <PrinterScreen state={state} client={client} run={run} />}
        {screen === 'usage' && <UsageReviewScreen usage={state.usage} client={client} run={run} />}
        {screen === 'nfc' && <NfcAuditScreen state={state} client={client} run={run} />}
        {screen === 'labels' && <LabelsScreen state={state} client={client} run={run} />}
        {screen === 'backup' && <BackupScreen client={client} run={run} />}
        {screen === 'security' && <SecurityScreen state={state} client={client} run={run} />}
      </main>
    </div>
  );
}

const navItems: Array<{ screen: Screen; label: string }> = [
  { screen: 'dashboard', label: 'Dashboard' },
  { screen: 'inventory', label: 'Inventory' },
  { screen: 'catalog', label: 'Catalog' },
  { screen: 'spool', label: 'Spool detail' },
  { screen: 'printers', label: 'Printer setup' },
  { screen: 'usage', label: 'Usage review' },
  { screen: 'nfc', label: 'NFC audit' },
  { screen: 'labels', label: 'Labels' },
  { screen: 'backup', label: 'Backup/export' },
  { screen: 'security', label: 'Security/devices' }
];

function SetupScreen({ client, onDone, message, setMessage }: { client: FilamentBridgeClient; onDone: (session: AuthSession) => void; message: string; setMessage: (value: string) => void }): ReactElement {
  const [email, setEmail] = useState('owner@example.local');
  const [displayName, setDisplayName] = useState('Owner');
  const [password, setPassword] = useState('change-me-local-owner');
  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    try {
      const session = await client.post<AuthSession>('/api/setup/owner', { email, display_name: displayName, password });
      onDone(session);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }
  return <main className="center-card"><h1>First-run setup</h1><p>{OFFICIAL_RFID_BOUNDARY}</p>{message && <p role="status" className="message">{message}</p>}<form onSubmit={submit}><label>Email<input value={email} onChange={(event) => setEmail(event.target.value)} /></label><label>Display name<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label><label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label><button>Create owner</button></form></main>;
}

function LoginScreen({ client, onDone, message, setMessage }: { client: FilamentBridgeClient; onDone: (session: AuthSession) => void; message: string; setMessage: (value: string) => void }): ReactElement {
  const [email, setEmail] = useState('owner@example.local');
  const [password, setPassword] = useState('');
  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    try {
      onDone(await client.post<AuthSession>('/api/auth/login', { email, password, device_name: navigator.userAgent.slice(0, 80) }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }
  return <main className="center-card"><h1>Login</h1>{message && <p role="status" className="message">{message}</p>}<form onSubmit={submit}><label>Email<input value={email} onChange={(event) => setEmail(event.target.value)} /></label><label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label><button>Login</button></form></main>;
}

function Dashboard({ state }: { state: AppState }): ReactElement {
  const pending = state.usage.filter((event) => event.review_status === 'pending').length;
  const staleTags = state.tags.filter((tag) => tag.status === 'stale').length;
  return <section><h2>Dashboard</h2><div className="cards"><Metric label="Spools" value={state.spools.length} /><Metric label="Catalog items" value={state.catalog.length} /><Metric label="Printers" value={state.printers.length} /><Metric label="Pending reviews" value={pending} /><Metric label="Stale tags" value={staleTags} /></div></section>;
}

function Metric({ label, value }: { label: string; value: number }): ReactElement {
  return <article className="metric"><span>{label}</span><strong>{value}</strong></article>;
}

function CatalogScreen({ state, client, run }: { state: AppState; client: FilamentBridgeClient; run: (action: () => Promise<void>, success: string) => Promise<void> }): ReactElement {
  const activeSpoolsByCatalog = new Map<string, number>();
  for (const spool of state.spools) {
    activeSpoolsByCatalog.set(spool.catalog_item_id, (activeSpoolsByCatalog.get(spool.catalog_item_id) ?? 0) + 1);
  }
  return (
    <section>
      <h2>Catalog management</h2>
      <CatalogForm onSubmit={(body) => run(async () => { await client.post('/api/catalog-items', body); }, 'Catalog item created')} />
      <DataTable
        rows={state.catalog.map((item) => {
          const activeSpools = activeSpoolsByCatalog.get(item.id) ?? 0;
          return [
            item.brand,
            item.product_line,
            item.material_type,
            item.color_name,
            item.bambu_studio_preset_name ?? '—',
            activeSpools,
            <button
              className="danger"
              disabled={activeSpools > 0}
              key={item.id}
              title={activeSpools > 0 ? 'Remove the active spools using this catalog item first.' : 'Remove catalog item'}
              onClick={() => {
                if (window.confirm(`Remove catalog item ${item.brand} ${item.product_line} ${item.color_name}?`)) {
                  void run(async () => { await client.post(`/api/catalog-items/${item.id}/delete`, { expected_version: item.version }); }, 'Catalog item removed');
                }
              }}
            >
              Remove
            </button>
          ];
        })}
        headers={['Brand', 'Line', 'Material', 'Color', 'Bambu preset', 'Active spools', 'Action']}
      />
    </section>
  );
}

function CatalogForm({ onSubmit }: { onSubmit: (body: Record<string, unknown>) => void }): ReactElement {
  const [brand, setBrand] = useState('Bambu Lab');
  const [line, setLine] = useState('PLA Basic');
  const [color, setColor] = useState('#1e88e5');
  return <form className="grid-form" onSubmit={(event) => { event.preventDefault(); onSubmit({ brand, product_line: line, material_type: 'PLA', diameter_mm: 1.75, color_name: 'Blue', color_hex: color, nozzle_temp_min_c: 190, nozzle_temp_max_c: 230, bed_temp_min_c: 35, bed_temp_max_c: 60, drying_temp_c: 45, drying_time_minutes: 240, density_g_cm3: 1.24, bambu_studio_preset_name: 'Bambu PLA Basic', orca_slicer_preset_name: 'Bambu PLA Basic', vendor_sku: null, notes: null }); }}><label>Brand<input value={brand} onChange={(event) => setBrand(event.target.value)} /></label><label>Product line<input value={line} onChange={(event) => setLine(event.target.value)} /></label><label>Color<input type="color" value={color} onChange={(event) => setColor(event.target.value)} /></label><button>Add catalog item</button></form>;
}

function InventoryScreen({ state, client, run, selectSpool }: { state: AppState; client: FilamentBridgeClient; run: (action: () => Promise<void>, success: string) => Promise<void>; selectSpool: (id: string) => void }): ReactElement {
  const [catalogId, setCatalogId] = useState(state.catalog[0]?.id ?? '');
  const catalog = state.catalog.find((item) => item.id === catalogId) ?? state.catalog[0];
  return (
    <section>
      <h2>Inventory</h2>
      <form className="grid-form" onSubmit={(event) => { event.preventDefault(); if (catalog) void run(async () => { await client.post('/api/spools', { catalog_item_id: catalog.id, display_name: `${catalog.brand} ${catalog.product_line} ${catalog.color_name}`, manufacturer_name: catalog.brand, material_type: catalog.material_type, diameter_mm: catalog.diameter_mm, color_hex: catalog.color_hex, initial_filament_weight_g: 1000, remaining_filament_weight_g: 1000, empty_spool_weight_g: 250, purchase_date: null, opened_at: null, status: 'sealed', storage_location: 'Shelf', notes: null }); }, 'Spool created'); }}>
        <label>Catalog item<select value={catalogId} onChange={(event) => setCatalogId(event.target.value)}>{state.catalog.map((item) => <option key={item.id} value={item.id}>{item.brand} {item.product_line} {item.color_name}</option>)}</select></label>
        <button disabled={!catalog}>Create spool from catalog</button>
      </form>
      <div className="list">
        {state.spools.map((spool) => (
          <article className="panel" key={spool.id}>
            <h3><span className="color" style={{ background: spool.color_hex }} />{spool.display_name}</h3>
            <small>{spool.material_type} · {spool.remaining_filament_weight_g} g · {spool.status} · code {spool.short_code}</small>
            <div className="actions">
              <button onClick={() => selectSpool(spool.id)}>Open details</button>
              <button
                className="danger"
                onClick={() => {
                  if (window.confirm(`Remove spool ${spool.display_name} from active inventory?`)) {
                    void run(async () => { await client.post(`/api/spools/${spool.id}/delete`, { expected_version: spool.version }); }, 'Spool removed');
                  }
                }}
              >
                Remove spool
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function SpoolDetail({ spool, tags, usage, client, run }: { spool: Spool | null; tags: NfcTag[]; usage: UsageEvent[]; client: FilamentBridgeClient; run: (action: () => Promise<void>, success: string) => Promise<void> }): ReactElement {
  const [weight, setWeight] = useState(spool?.remaining_filament_weight_g.toString() ?? '0');
  if (spool === null) return <section><h2>Spool detail</h2><p>Create a spool to see detail.</p></section>;
  const tag = tags.find((candidate) => candidate.id === spool.active_tag_id);
  return <section><h2>Spool detail</h2><article className="panel"><h3>{spool.display_name}</h3><p>{spool.material_type} · {spool.remaining_filament_weight_g} g remaining · code {spool.short_code} · tag {tag?.status ?? 'none'}</p><form className="inline" onSubmit={(event) => { event.preventDefault(); void run(async () => { await client.post('/api/usage-events/adjustment', { spool_id: spool.id, expected_version: spool.version, new_remaining_weight_g: Number(weight), notes: 'Manual web adjustment' }); }, 'Manual adjustment saved'); }}><label>Remaining grams<input type="number" value={weight} onChange={(event) => setWeight(event.target.value)} /></label><button>Save adjustment</button></form><button className="danger" onClick={() => { if (window.confirm(`Remove spool ${spool.display_name} from active inventory?`)) void run(async () => { await client.post(`/api/spools/${spool.id}/delete`, { expected_version: spool.version }); }, 'Spool removed'); }}>Remove spool</button></article><h3>Weight history</h3><DataTable rows={usage.filter((event) => event.spool_id === spool.id).map((event) => [event.source, event.delta_weight_g, event.before_weight_g, event.after_weight_g, event.estimated_material_cost_amount === null ? '—' : `${event.estimated_material_cost_amount} ${event.estimated_material_cost_currency ?? ''}`, event.review_status])} headers={['Source', 'Delta', 'Before', 'After', 'Cost', 'Review']} /></section>;
}

function PrinterScreen({ state, client, run }: { state: AppState; client: FilamentBridgeClient; run: (action: () => Promise<void>, success: string) => Promise<void> }): ReactElement {
  const [name, setName] = useState('P1S printer');
  const [model, setModel] = useState('P1S');
  const [serial, setSerial] = useState('');
  const [deviceId, setDeviceId] = useState('');
  const [host, setHost] = useState('192.168.1.50');
  const [lanAccessCode, setLanAccessCode] = useState('');
  const [connectionMode, setConnectionMode] = useState<'lan' | 'vpn_lan' | 'manual'>('lan');
  return (
    <section>
      <h2>Printer setup and slot mapping</h2>
      <p className="boundary">FilamentBridge runs an internal lightweight MQTT connection service. LAN/VPN-LAN opens outbound TLS MQTT sessions to your printer at the configured host on port 8883 and subscribes to <code>device/&lt;MQTT device ID&gt;/report</code>. The device ID is usually the printer serial and must match the printer MQTT topic identifier; the separate serial field is stored only as a local identity hash and fallback.</p>
      <form className="grid-form" onSubmit={(event) => {
        event.preventDefault();
        void run(async () => {
          await client.post('/api/printers', {
            name,
            manufacturer: 'Bambu Lab',
            model,
            serial: serial || deviceId || `${model}-local`,
            device_id: deviceId || serial || null,
            host,
            lan_access_code: lanAccessCode || null,
            connection_mode: connectionMode,
            firmware_version: null,
            notes: connectionMode === 'manual' ? 'Manual printer setup' : 'Bambu LAN MQTT observational setup'
          });
        }, 'Printer registered');
      }}>
        <label>Name<input value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label>Model<input value={model} onChange={(event) => setModel(event.target.value)} /></label>
        <label>Printer host/IP<input value={host} onChange={(event) => setHost(event.target.value)} /></label>
        <label>Printer serial<input value={serial} onChange={(event) => setSerial(event.target.value)} placeholder="Used for hashing and fallback device id" /></label>
        <label>MQTT device ID / serial<input value={deviceId} onChange={(event) => setDeviceId(event.target.value)} placeholder="Required for device/{id}/report" /></label>
        <label>LAN access code<input type="password" value={lanAccessCode} onChange={(event) => setLanAccessCode(event.target.value)} placeholder="Required for LAN/VPN LAN" /></label>
        <label>Connection mode<select value={connectionMode} onChange={(event) => setConnectionMode(event.target.value as 'lan' | 'vpn_lan' | 'manual')}><option value="lan">LAN MQTT</option><option value="vpn_lan">VPN / Tailscale LAN MQTT</option><option value="manual">Manual only</option></select></label>
        <button>Register printer</button>
      </form>
      <div className="list">
        {state.printers.map((printer) => (
          <article className="panel" key={printer.id}>
            <h3>{printer.name}</h3>
            <p>{printer.model} · {printer.capability_level} · {printer.connection_mode} · {printer.host}</p>
            <div className="actions">
              <button onClick={() => run(async () => { await client.post(`/api/printers/${printer.id}/test-connection`); }, 'MQTT connection tested')}>Test MQTT connection</button>
              <button onClick={() => run(async () => { await client.post(`/api/printers/${printer.id}/sync-now`); }, 'MQTT sync completed')}>Sync now</button>
              <button
                className="danger"
                onClick={() => {
                  if (window.confirm(`Remove printer ${printer.name}? Slot mappings for this printer will be removed.`)) {
                    void run(async () => { await client.post(`/api/printers/${printer.id}/delete`, { expected_version: printer.version }); }, 'Printer removed');
                  }
                }}
              >
                Remove printer
              </button>
            </div>
          </article>
        ))}
      </div>
      <h3>Slots</h3>
      {state.slots.map((slot) => <form className="inline" key={slot.id} onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void run(async () => { await client.patch(`/api/printer-slots/${slot.id}/mapping`, { mapped_spool_id: String(form.get('spool') || '') || null, expected_version: slot.version }); }, 'Slot mapping saved'); }}><span>{slot.display_name} · {slot.state} · {slot.detected_material_type ?? 'unknown'} · {slot.detected_color_hex ?? 'no color'}</span><select name="spool" defaultValue={slot.mapped_spool_id ?? ''}><option value="">Unmapped</option>{state.spools.map((spool) => <option key={spool.id} value={spool.id}>{spool.display_name}</option>)}</select><button>Map</button></form>)}
    </section>
  );
}

function UsageReviewScreen({ usage, client, run }: { usage: UsageEvent[]; client: FilamentBridgeClient; run: (action: () => Promise<void>, success: string) => Promise<void> }): ReactElement {
  const pending = usage.filter((event) => event.review_status === 'pending');
  return <section><h2>Usage event review queue</h2>{pending.length === 0 && <p>No pending usage events.</p>}{pending.map((event) => <article className="panel" key={event.id}><h3>{event.source} {event.job_id ?? ''}</h3><p>Delta {event.delta_weight_g} g; after approval: {event.after_weight_g} g.</p><button onClick={() => run(async () => { await client.post(`/api/usage-events/${event.id}/approve`, {}); }, 'Usage approved')}>Approve</button><button onClick={() => run(async () => { await client.post(`/api/usage-events/${event.id}/edit-and-approve`, { delta_weight_g: event.delta_weight_g, notes: 'Edited in review' }); }, 'Usage edited and approved')}>Edit & approve</button><button onClick={() => run(async () => { await client.post(`/api/usage-events/${event.id}/reject`, {}); }, 'Usage rejected')}>Reject</button></article>)}</section>;
}

function NfcAuditScreen({ state, client, run }: { state: AppState; client: FilamentBridgeClient; run: (action: () => Promise<void>, success: string) => Promise<void> }): ReactElement {
  const [tagUid, setTagUid] = useState('demo-tag-uid');
  const [spoolId, setSpoolId] = useState(state.spools[0]?.id ?? '');
  const [encoded, setEncoded] = useState('');
  const [scan, setScan] = useState<NfcScanResult | null>(null);
  return <section><h2>NFC tag audit</h2><p>{OFFICIAL_RFID_BOUNDARY}</p><form className="grid-form" onSubmit={(event) => { event.preventDefault(); const spool = state.spools.find((candidate) => candidate.id === spoolId); if (spool) void run(async () => { await client.post('/api/nfc/assign', { spool_id: spool.id, tag_uid: tagUid, expected_spool_version: spool.version }); }, 'Tag assigned'); }}><label>Tag UID<input value={tagUid} onChange={(event) => setTagUid(event.target.value)} /></label><label>Spool<select value={spoolId} onChange={(event) => setSpoolId(event.target.value)}>{state.spools.map((spool) => <option key={spool.id} value={spool.id}>{spool.display_name}</option>)}</select></label><button>Assign blank companion tag</button></form><div className="list">{state.tags.map((tag) => <article className="panel" key={tag.id}><h3>{tag.status} tag</h3><p>{tag.assigned_spool_id ?? 'unassigned'} · writes {tag.write_count}</p><button disabled={tag.assigned_spool_id === null} onClick={() => run(async () => { const spool = state.spools.find((candidate) => candidate.id === tag.assigned_spool_id); if (!spool) return; const result = await client.post<NfcWritePayloadResult>('/api/nfc/write-payload', { tag_id: tag.id, spool_id: spool.id, expected_spool_version: spool.version, force_stale_rewrite: true }); setEncoded(result.encoded_payload); }, 'Payload generated for iOS write')}>Generate write payload</button><button onClick={() => run(async () => { await client.post('/api/nfc/retire', { tag_id: tag.id, expected_version: tag.version }); }, 'Tag retired')}>Retire</button></article>)}</div><form onSubmit={(event) => { event.preventDefault(); void run(async () => { setScan(await client.post<NfcScanResult>('/api/nfc/scan', { tag_uid: tagUid, encoded_payload: encoded || null })); }, 'Scan submitted'); }}><label>Encoded payload<textarea value={encoded} onChange={(event) => setEncoded(event.target.value)} /></label><button>Verify scan</button></form>{scan && <pre>{JSON.stringify(scan, null, 2)}</pre>}</section>;
}

function LabelsScreen({ state, client, run }: { state: AppState; client: FilamentBridgeClient; run: (action: () => Promise<void>, success: string) => Promise<void> }): ReactElement {
  const [selectedSpoolId, setSelectedSpoolId] = useState(state.spools[0]?.id ?? '');
  const [selectedTemplateId, setSelectedTemplateId] = useState(state.labelTemplates[0]?.id ?? '');
  const [rendered, setRendered] = useState<RenderedLabels | null>(null);
  const selectedSpool = state.spools.find((spool) => spool.id === selectedSpoolId) ?? state.spools[0];
  const selectedTemplate = state.labelTemplates.find((template) => template.id === selectedTemplateId) ?? state.labelTemplates[0];
  return (
    <section>
      <h2>Labels and lookup</h2>
      <p>QR/barcode labels identify local spools by short code. NFC signatures remain the trusted app-owned tag mechanism.</p>
      <form className="grid-form" onSubmit={(event) => { event.preventDefault(); void run(async () => { const template = await client.post<LabelTemplate>('/api/labels/templates', { name: 'Default spool QR labels', medium: 'sheet', page_width_mm: 210, page_height_mm: 297, label_width_mm: 70, label_height_mm: 35, rows: 8, columns: 2, code_type: 'qr', template_text: '{{display_name}}\\n{{material_type}} · {{remaining_filament_weight_g}}g', included_fields: ['short_code', 'storage_location'] }); setSelectedTemplateId(template.id); }, 'Label template created'); }}>
        <button>Create default QR template</button>
      </form>
      <form className="grid-form" onSubmit={(event) => { event.preventDefault(); if (!selectedSpool || !selectedTemplate) return; void run(async () => { setRendered(await client.post<RenderedLabels>('/api/labels/render', { template_id: selectedTemplate.id, spool_ids: [selectedSpool.id], base_url: window.location.origin })); }, 'Label rendered locally'); }}>
        <label>Template<select value={selectedTemplateId} onChange={(event) => setSelectedTemplateId(event.target.value)}>{state.labelTemplates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select></label>
        <label>Spool<select value={selectedSpoolId} onChange={(event) => setSelectedSpoolId(event.target.value)}>{state.spools.map((spool) => <option key={spool.id} value={spool.id}>{spool.display_name} ({spool.short_code})</option>)}</select></label>
        <button disabled={!selectedSpool || !selectedTemplate}>Render label SVG</button>
      </form>
      {rendered && <article className="panel"><h3>{rendered.filename}</h3><div className="label-preview" dangerouslySetInnerHTML={{ __html: rendered.svg }} /><textarea readOnly value={rendered.svg} /></article>}
      <DataTable headers={['Template', 'Code type', 'Size', 'Last used']} rows={state.labelTemplates.map((template) => [template.name, template.code_type, `${template.label_width_mm}×${template.label_height_mm} mm`, template.last_used_at ?? 'never'])} />
    </section>
  );
}

function BackupScreen({ client, run }: { client: FilamentBridgeClient; run: (action: () => Promise<void>, success: string) => Promise<void> }): ReactElement {
  const [exportText, setExportText] = useState('');
  return <section><h2>Backup/export settings</h2><button onClick={() => run(async () => { setExportText(JSON.stringify(await client.get('/api/export'), null, 2)); }, 'Inventory exported')}>Export inventory</button><button onClick={() => run(async () => { setExportText(JSON.stringify(await client.post('/api/backups'), null, 2)); }, 'Backup created')}>Create backup with signing keys</button><form onSubmit={(event) => { event.preventDefault(); void run(async () => { await client.post('/api/restore', { backup: JSON.parse(exportText) }); }, 'Backup restored'); }}><label>Backup JSON<textarea value={exportText} onChange={(event) => setExportText(event.target.value)} /></label><button>Restore backup</button></form></section>;
}

function SecurityScreen({ state, client, run }: { state: AppState; client: FilamentBridgeClient; run: (action: () => Promise<void>, success: string) => Promise<void> }): ReactElement {
  const [pairingCode, setPairingCode] = useState('');
  return <section><h2>Security and device settings</h2><button onClick={() => run(async () => { const result = await client.post<{ pairing_code: string }>('/api/devices/pairing/start', { device_name: 'iPhone', device_type: 'ios' }); setPairingCode(result.pairing_code); }, 'Pairing code created')}>Create iOS pairing code</button>{pairingCode && <p className="pairing">{pairingCode}</p>}<DataTable headers={['Name', 'Type', 'Trusted', 'Last seen', 'Action']} rows={state.devices.map((device) => [device.name, device.device_type, device.trusted ? 'yes' : 'no', device.last_seen_at ?? 'never', <button key={device.id} onClick={() => run(async () => { await client.post(`/api/devices/${device.id}/revoke`, {}); }, 'Device revoked')}>Revoke</button>])} /></section>;
}

function DataTable({ headers, rows }: { headers: string[]; rows: Array<Array<ReactNode>> }): ReactElement {
  return <table><thead><tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody></table>;
}
