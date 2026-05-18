import { createHash } from 'node:crypto';
import {
  type MaterialType,
  type Printer,
  type PrinterCapabilityLevel,
  type PrinterSlot,
  type PrinterSlotState,
  type PrinterSlotUnitType,
  type TestConnectionResult
} from '../../shared/src/index';

export type PrinterFamily = 'X1' | 'P1' | 'P2' | 'A1' | 'H2' | 'X2' | 'unknown';

export type CompatibilityMatrixEntry = {
  family: PrinterFamily;
  models: string[];
  material_system_target: string;
  capability_level: PrinterCapabilityLevel;
  notes: string;
};

export type ObservedPrinterSlot = {
  unit_type: PrinterSlotUnitType;
  unit_index: number;
  slot_index: number;
  display_name: string;
  state: PrinterSlotState;
  detected_material_type: MaterialType | null;
  detected_color_hex: string | null;
  detected_remaining_percent: number | null;
};

export type UsageCandidate = {
  spool_id: string;
  printer_slot_id: string;
  job_id: string;
  delta_weight_g: number;
  confidence: 'estimated' | 'inferred' | 'unknown';
  notes: string;
};

export type PrinterSyncResult = {
  capability_level: PrinterCapabilityLevel;
  observed_slots: ObservedPrinterSlot[];
  usage_candidates: UsageCandidate[];
  warnings: string[];
};

export interface PrinterConnector {
  start?(): Promise<void> | void;
  stop?(): Promise<void> | void;
  testConnection(printer: Printer): Promise<TestConnectionResult>;
  syncNow(printer: Printer, existingSlots: PrinterSlot[]): Promise<PrinterSyncResult>;
}

export type BambuLanMqttCredentials = {
  lan_access_code: string | null;
  device_id: string | null;
  allow_insecure_tls?: boolean;
};

export type BambuLanMqttConnectorOptions = {
  resolveCredentials(printer: Printer): Promise<BambuLanMqttCredentials> | BambuLanMqttCredentials;
  fallback?: PrinterConnector;
  connect_timeout_ms?: number;
  snapshot_timeout_ms?: number;
  mqtt_factory?: BambuMqttFactory;
  snapshot_source?: BambuMqttSnapshotSource;
};

export type BambuMqttFactory = (url: string, options: BambuMqttConnectionOptions) => BambuMqttClientLike;

export type BambuMqttConnectionOptions = {
  protocolVersion: 4;
  clean: true;
  username: 'bblp';
  password: string;
  connectTimeout: number;
  rejectUnauthorized: boolean;
  servername: string;
};

export type BambuMqttClientLike = {
  on(event: 'connect', listener: () => void): BambuMqttClientLike;
  on(event: 'message', listener: (topic: string, payload: Uint8Array | Buffer | string) => void): BambuMqttClientLike;
  on(event: 'error', listener: (error: Error) => void): BambuMqttClientLike;
  subscribe(topic: string, callback: (error?: Error | null) => void): void;
  publish(topic: string, payload: string, callback?: (error?: Error | null) => void): void;
  end(force?: boolean, callback?: () => void): void;
};

export type BambuMqttResolvedCredentials = {
  lan_access_code: string;
  device_id: string;
  allow_insecure_tls?: boolean;
};

export type BambuMqttSnapshot = {
  slots: ObservedPrinterSlot[];
  error: string | null;
  received_at: string;
};

export interface BambuMqttSnapshotSource {
  start?(): Promise<void> | void;
  stop?(): Promise<void> | void;
  readSnapshot(printer: Printer, credentials: BambuMqttResolvedCredentials): Promise<BambuMqttSnapshot>;
}

export type BambuMqttConnectionServerOptions = {
  connect_timeout_ms?: number;
  snapshot_timeout_ms?: number;
  cache_ttl_ms?: number;
  mqtt_factory?: BambuMqttFactory;
  now?: () => number;
};

export const compatibilityMatrixDate = '2026-05-15';

export const compatibilityMatrix: CompatibilityMatrixEntry[] = [
  {
    family: 'X1',
    models: ['X1C', 'X1E', 'X1 Carbon'],
    material_system_target: 'AMS, AMS 2 Pro, AMS HT where supported',
    capability_level: 'read_only',
    notes: 'Bambu LAN MQTT observation is supported when LAN credentials are configured.'
  },
  {
    family: 'P1',
    models: ['P1S', 'P1P'],
    material_system_target: 'AMS, AMS 2 Pro, AMS HT where supported',
    capability_level: 'read_only',
    notes: 'Bambu LAN MQTT observation is supported when LAN credentials are configured.'
  },
  {
    family: 'P2',
    models: ['P2S'],
    material_system_target: 'AMS 2 Pro, AMS HT where supported',
    capability_level: 'read_only',
    notes: 'First-class inventory model; local telemetry remains observational.'
  },
  {
    family: 'A1',
    models: ['A1', 'A1 mini'],
    material_system_target: 'AMS Lite',
    capability_level: 'manual_only',
    notes: 'AMS Lite handling differs; default to manual-only until verified.'
  },
  {
    family: 'H2',
    models: ['H2D', 'H2S', 'H2C'],
    material_system_target: 'AMS 2 Pro, AMS HT, external paths',
    capability_level: 'manual_only',
    notes: 'Large-format and multi-path workflows need explicit hardware testing.'
  },
  {
    family: 'X2',
    models: ['X2D'],
    material_system_target: 'AMS 2 Pro or current supported feeder paths',
    capability_level: 'manual_only',
    notes: 'Newer model; refresh official docs before enabling telemetry.'
  },
  {
    family: 'unknown',
    models: ['Unknown'],
    material_system_target: 'Unknown',
    capability_level: 'manual_only',
    notes: 'Inventory, NFC, and manual slots remain available without printer telemetry.'
  }
];

export function capabilityForModel(model: string): PrinterCapabilityLevel {
  const normalized = normalizeModel(model);
  const entry = compatibilityMatrix.find((candidate) => candidate.models.some((known) => normalizeModel(known) === normalized));
  return entry?.capability_level ?? 'manual_only';
}

export function familyForModel(model: string): PrinterFamily {
  const normalized = normalizeModel(model);
  const entry = compatibilityMatrix.find((candidate) => candidate.models.some((known) => normalizeModel(known) === normalized));
  return entry?.family ?? 'unknown';
}

export class ManualMockBambuConnector implements PrinterConnector {
  async testConnection(printer: Printer): Promise<TestConnectionResult> {
    const capability = printer.connection_mode === 'manual' ? 'manual_only' : capabilityForModel(printer.model);
    const slots = defaultObservedSlots(printer.model, capability);
    return {
      capability_level: capability,
      ok: true,
      reason: capability === 'manual_only'
        ? 'Manual/mock mode: no Bambu LAN protocol is contacted.'
        : 'Capability-gated mock observation only; real Bambu telemetry is not claimed in this build.',
      observed_slots: slots.map((slot) => ({
        unit_type: slot.unit_type,
        unit_index: slot.unit_index,
        slot_index: slot.slot_index,
        display_name: slot.display_name,
        state: slot.state
      }))
    };
  }

  async syncNow(printer: Printer, existingSlots: PrinterSlot[]): Promise<PrinterSyncResult> {
    const capability = printer.connection_mode === 'manual' ? 'manual_only' : capabilityForModel(printer.model);
    const observedSlots = existingSlots.length > 0
      ? existingSlots.map((slot) => observedFromExistingSlot(slot))
      : defaultObservedSlots(printer.model, capability);
    const usageCandidates = existingSlots
      .filter((slot) => slot.mapped_spool_id !== null && slot.state !== 'empty' && slot.state !== 'unavailable')
      .slice(0, 1)
      .map((slot) => ({
        spool_id: slot.mapped_spool_id as string,
        printer_slot_id: slot.id,
        job_id: `manual-mock-${Date.now()}`,
        delta_weight_g: -12,
        confidence: 'estimated' as const,
        notes: 'Mock connector generated review event; approve only if it matches real usage.'
      }));
    return {
      capability_level: capability,
      observed_slots: observedSlots,
      usage_candidates: usageCandidates,
      warnings: [
        'Printer integration is observational and capability-gated.',
        'This connector never writes Bambu RFID data and never attempts firmware bypasses.'
      ]
    };
  }
}

export class BambuLanMqttConnector implements PrinterConnector {
  private readonly fallback: PrinterConnector;
  private readonly connectTimeoutMs: number;
  private readonly snapshotTimeoutMs: number;
  private readonly mqttFactory: BambuMqttFactory | undefined;
  private readonly snapshotSource: BambuMqttSnapshotSource | undefined;

  constructor(private readonly options: BambuLanMqttConnectorOptions) {
    this.fallback = options.fallback ?? new ManualMockBambuConnector();
    this.connectTimeoutMs = options.connect_timeout_ms ?? 3500;
    this.snapshotTimeoutMs = options.snapshot_timeout_ms ?? 6500;
    this.mqttFactory = options.mqtt_factory;
    this.snapshotSource = options.snapshot_source;
  }

  async start(): Promise<void> {
    await this.snapshotSource?.start?.();
  }

  async stop(): Promise<void> {
    await this.snapshotSource?.stop?.();
  }

  async testConnection(printer: Printer): Promise<TestConnectionResult> {
    if (printer.connection_mode === 'manual') {
      return this.fallback.testConnection(printer);
    }
    const capability = capabilityForModel(printer.model);
    if (capability === 'manual_only' || capability === 'unsupported') {
      return this.fallback.testConnection(printer);
    }
    const credentials = await this.options.resolveCredentials(printer);
    const missing = missingCredentialReason(credentials);
    if (missing !== null) {
      return { capability_level: 'read_only', ok: false, reason: missing, observed_slots: [] };
    }
    const snapshot = await this.fetchSnapshot(printer, credentials as BambuMqttResolvedCredentials);
    return {
      capability_level: 'read_only',
      ok: snapshot.error === null,
      reason: snapshot.error,
      observed_slots: snapshot.slots.map((slot) => ({
        unit_type: slot.unit_type,
        unit_index: slot.unit_index,
        slot_index: slot.slot_index,
        display_name: slot.display_name,
        state: slot.state
      }))
    };
  }

  async syncNow(printer: Printer, existingSlots: PrinterSlot[]): Promise<PrinterSyncResult> {
    if (printer.connection_mode === 'manual') {
      return this.fallback.syncNow(printer, existingSlots);
    }
    const capability = capabilityForModel(printer.model);
    if (capability === 'manual_only' || capability === 'unsupported') {
      return this.fallback.syncNow(printer, existingSlots);
    }
    const credentials = await this.options.resolveCredentials(printer);
    const missing = missingCredentialReason(credentials);
    if (missing !== null) {
      return { capability_level: 'read_only', observed_slots: [], usage_candidates: [], warnings: [missing] };
    }
    const snapshot = await this.fetchSnapshot(printer, credentials as BambuMqttResolvedCredentials);
    return {
      capability_level: 'read_only',
      observed_slots: snapshot.slots,
      usage_candidates: [],
      warnings: snapshot.error === null ? [] : [snapshot.error]
    };
  }

  private async fetchSnapshot(printer: Printer, credentials: BambuMqttResolvedCredentials): Promise<{ slots: ObservedPrinterSlot[]; error: string | null }> {
    try {
      if (this.snapshotSource !== undefined) {
        const snapshot = await this.snapshotSource.readSnapshot(printer, credentials);
        return { slots: snapshot.slots, error: snapshot.error };
      }
      const report = await readOneBambuMqttReport(createBambuMqttReadOptions(printer, credentials, this.connectTimeoutMs, this.snapshotTimeoutMs, this.mqttFactory));
      return { slots: extractBambuObservedSlots(report), error: null };
    } catch (error) {
      return { slots: [], error: error instanceof Error ? error.message : 'Bambu LAN MQTT observation failed' };
    }
  }
}

export class BambuMqttConnectionServer implements BambuMqttSnapshotSource {
  private readonly connectTimeoutMs: number;
  private readonly snapshotTimeoutMs: number;
  private readonly cacheTtlMs: number;
  private readonly mqttFactory: BambuMqttFactory | undefined;
  private readonly now: () => number;
  private readonly snapshots = new Map<string, { fetched_at_ms: number; snapshot: BambuMqttSnapshot }>();
  private readonly inFlight = new Map<string, Promise<BambuMqttSnapshot>>();
  private readonly activeClients = new Set<BambuMqttClientLike>();
  private abortController: AbortController | null = null;

  constructor(options: BambuMqttConnectionServerOptions = {}) {
    this.connectTimeoutMs = options.connect_timeout_ms ?? 3500;
    this.snapshotTimeoutMs = options.snapshot_timeout_ms ?? 6500;
    this.cacheTtlMs = options.cache_ttl_ms ?? 2000;
    this.mqttFactory = options.mqtt_factory;
    this.now = options.now ?? Date.now;
  }

  start(): void {
    if (this.abortController === null) {
      this.abortController = new AbortController();
    }
  }

  stop(): void {
    if (this.abortController !== null && !this.abortController.signal.aborted) {
      this.abortController.abort();
    }
    for (const client of this.activeClients) {
      client.end(true);
    }
    this.activeClients.clear();
    this.inFlight.clear();
    this.snapshots.clear();
    this.abortController = null;
  }

  async readSnapshot(printer: Printer, credentials: BambuMqttResolvedCredentials): Promise<BambuMqttSnapshot> {
    this.start();
    const controller = this.abortController;
    if (controller === null) {
      throw new Error('Bambu MQTT connection server is not running');
    }
    const key = bambuMqttSnapshotCacheKey(printer, credentials);
    const nowMs = this.now();
    const cached = this.snapshots.get(key);
    if (cached !== undefined && nowMs - cached.fetched_at_ms <= this.cacheTtlMs) {
      return cloneBambuMqttSnapshot(cached.snapshot);
    }

    const existing = this.inFlight.get(key);
    if (existing !== undefined) {
      return cloneBambuMqttSnapshot(await existing);
    }

    const request = this.fetchSnapshot(key, printer, credentials, controller);
    this.inFlight.set(key, request);
    try {
      return cloneBambuMqttSnapshot(await request);
    } finally {
      if (this.inFlight.get(key) === request) {
        this.inFlight.delete(key);
      }
    }
  }

  private async fetchSnapshot(key: string, printer: Printer, credentials: BambuMqttResolvedCredentials, controller: AbortController): Promise<BambuMqttSnapshot> {
    try {
      const options = createBambuMqttReadOptions(printer, credentials, this.connectTimeoutMs, this.snapshotTimeoutMs, this.mqttFactory);
      options.abort_signal = controller.signal;
      options.on_client_ready = (client) => {
        this.activeClients.add(client);
      };
      options.on_client_closed = (client) => {
        this.activeClients.delete(client);
      };
      const report = await readOneBambuMqttReport(options);
      const snapshot: BambuMqttSnapshot = {
        slots: extractBambuObservedSlots(report),
        error: null,
        received_at: new Date(this.now()).toISOString()
      };
      this.snapshots.set(key, { fetched_at_ms: this.now(), snapshot: cloneBambuMqttSnapshot(snapshot) });
      return snapshot;
    } catch (error) {
      return {
        slots: [],
        error: error instanceof Error ? error.message : 'Bambu LAN MQTT observation failed',
        received_at: new Date(this.now()).toISOString()
      };
    }
  }
}


export type BambuMqttReadOptions = BambuMqttResolvedCredentials & {
  host: string;
  connect_timeout_ms: number;
  snapshot_timeout_ms: number;
  mqtt_factory?: BambuMqttFactory;
  abort_signal?: AbortSignal;
  on_client_ready?: (client: BambuMqttClientLike) => void;
  on_client_closed?: (client: BambuMqttClientLike) => void;
};

function createBambuMqttReadOptions(
  printer: Printer,
  credentials: BambuMqttResolvedCredentials,
  connectTimeoutMs: number,
  snapshotTimeoutMs: number,
  mqttFactory: BambuMqttFactory | undefined
): BambuMqttReadOptions {
  const options: BambuMqttReadOptions = {
    host: printer.host,
    device_id: credentials.device_id,
    lan_access_code: credentials.lan_access_code,
    allow_insecure_tls: credentials.allow_insecure_tls === true,
    connect_timeout_ms: connectTimeoutMs,
    snapshot_timeout_ms: snapshotTimeoutMs
  };
  if (mqttFactory !== undefined) {
    options.mqtt_factory = mqttFactory;
  }
  return options;
}

function cloneBambuMqttSnapshot(snapshot: BambuMqttSnapshot): BambuMqttSnapshot {
  return {
    slots: snapshot.slots.map((slot) => ({ ...slot })),
    error: snapshot.error,
    received_at: snapshot.received_at
  };
}

function bambuMqttSnapshotCacheKey(printer: Printer, credentials: BambuMqttResolvedCredentials): string {
  const accessCodeHash = createHash('sha256').update(credentials.lan_access_code).digest('hex').slice(0, 16);
  return [printer.id, printer.host, credentials.device_id, credentials.allow_insecure_tls === true ? 'insecure-tls' : 'verified-tls', accessCodeHash].join('\0');
}

export async function readOneBambuMqttReport(options: BambuMqttReadOptions): Promise<Record<string, unknown>> {
  if (options.abort_signal?.aborted) {
    throw new Error('Bambu LAN MQTT observation aborted');
  }

  const factory = options.mqtt_factory ?? await loadMqttFactory();
  const reportTopic = `device/${options.device_id}/report`;
  const requestTopic = `device/${options.device_id}/request`;
  const client = factory(`mqtts://${options.host}:8883`, {
    protocolVersion: 4,
    clean: true,
    username: 'bblp',
    password: options.lan_access_code,
    connectTimeout: options.connect_timeout_ms,
    rejectUnauthorized: options.allow_insecure_tls !== true,
    servername: options.device_id
  });
  options.on_client_ready?.(client);

  return new Promise((resolve, reject) => {
    let settled = false;
    let requestedPushAll = false;
    let clientClosed = false;
    let snapshot: Record<string, unknown> = {};
    let noSnapshotTimer: ReturnType<typeof setTimeout> | undefined;
    const deadlineTimer = setTimeout(() => finishReject(new Error('timed out waiting for Bambu LAN MQTT report')), options.snapshot_timeout_ms);
    const abortListener = () => finishReject(new Error('Bambu LAN MQTT observation aborted'));

    const closeClient = (callback: () => void) => {
      if (clientClosed) {
        callback();
        return;
      }
      clientClosed = true;
      options.abort_signal?.removeEventListener('abort', abortListener);
      client.end(true, () => {
        options.on_client_closed?.(client);
        callback();
      });
    };

    const finishResolve = (value: Record<string, unknown>) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadlineTimer);
      if (noSnapshotTimer !== undefined) clearTimeout(noSnapshotTimer);
      closeClient(() => resolve(value));
    };
    const finishReject = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadlineTimer);
      if (noSnapshotTimer !== undefined) clearTimeout(noSnapshotTimer);
      closeClient(() => reject(error));
    };

    if (options.abort_signal !== undefined) {
      if (options.abort_signal.aborted) {
        finishReject(new Error('Bambu LAN MQTT observation aborted'));
        return;
      }
      options.abort_signal.addEventListener('abort', abortListener, { once: true });
    }

    client.on('error', finishReject);
    client.on('message', (topic, payload) => {
      if (topic !== reportTopic) return;
      const parsed = parseBambuReportPayload(payload);
      if (parsed === null) return;
      snapshot = deepMergeBambuReport(snapshot, parsed);
      if (extractBambuObservedSlots(snapshot).length > 0) {
        finishResolve(snapshot);
      }
    });
    client.on('connect', () => {
      client.subscribe(reportTopic, (subscribeError) => {
        if (subscribeError) {
          finishReject(subscribeError);
          return;
        }
        noSnapshotTimer = setTimeout(() => {
          if (settled || requestedPushAll) return;
          requestedPushAll = true;
          client.publish(requestTopic, JSON.stringify(createBambuPushAllRequest()), (publishError) => {
            if (publishError) finishReject(publishError);
          });
        }, Math.min(1000, Math.max(0, options.snapshot_timeout_ms - 1000)));
      });
    });
  });
}

async function loadMqttFactory(): Promise<BambuMqttFactory> {
  const mqttModule = await import('mqtt');
  const connect = (mqttModule as { connect?: BambuMqttFactory; default?: { connect?: BambuMqttFactory } }).connect
    ?? (mqttModule as { default?: { connect?: BambuMqttFactory } }).default?.connect;
  if (connect === undefined) {
    throw new Error('mqtt dependency did not expose connect()');
  }
  return connect;
}

export function parseBambuReportPayload(payload: Uint8Array | Buffer | string): Record<string, unknown> | null {
  try {
    const text = typeof payload === 'string' ? payload : Buffer.from(payload).toString('utf8');
    const parsed = JSON.parse(text) as unknown;
    return isRecord(parsed) ? stripRfidAdjacentFields(parsed) : null;
  } catch {
    return null;
  }
}

export function deepMergeBambuReport(base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (isRfidAdjacentKey(key)) continue;
    const existing = merged[key];
    merged[key] = isRecord(existing) && isRecord(value) ? deepMergeBambuReport(existing, value) : stripRfidAdjacentValue(value);
  }
  return merged;
}

export function extractBambuObservedSlots(report: Record<string, unknown>): ObservedPrinterSlot[] {
  const print = isRecord(report.print) ? report.print : report;
  const trayNow = toInteger(print.tray_now);
  const slots: ObservedPrinterSlot[] = [];
  const amsRoot = isRecord(print.ams) ? print.ams : null;
  const amsUnits = Array.isArray(amsRoot?.ams) ? amsRoot.ams : [];
  for (let amsIndex = 0; amsIndex < amsUnits.length; amsIndex += 1) {
    const ams = amsUnits[amsIndex];
    if (!isRecord(ams)) continue;
    const amsId = toInteger(ams.id) ?? toInteger(ams.ams_id) ?? amsIndex;
    const trays = Array.isArray(ams.tray) ? ams.tray : [];
    for (let trayIndex = 0; trayIndex < trays.length; trayIndex += 1) {
      const tray = trays[trayIndex];
      if (!isRecord(tray)) continue;
      const slotIndex = toInteger(tray.id) ?? toInteger(tray.tray_id) ?? trayIndex;
      const hasMaterial = firstString(tray.tray_type, tray.material, tray.filament_type) !== null;
      const color = normalizeBambuColor(firstString(tray.tray_color, firstArrayString(tray.cols)));
      const hasTrayIdentity = 'id' in tray || 'tray_id' in tray;
      if (!hasTrayIdentity && !hasMaterial && color === null) continue;
      const state = trayNow === amsId * 4 + slotIndex ? 'feeding' : hasMaterial || color !== null ? 'loaded' : 'empty';
      slots.push({
        unit_type: 'ams',
        unit_index: amsId,
        slot_index: slotIndex,
        display_name: `AMS ${amsId + 1} Slot ${slotIndex + 1}`,
        state,
        detected_material_type: normalizeBambuMaterial(firstString(tray.tray_type, tray.material, tray.filament_type)),
        detected_color_hex: color,
        detected_remaining_percent: null
      });
    }
  }

  const externalTray = isRecord(print.vt_tray) ? print.vt_tray : null;
  if (externalTray !== null) {
    const hasMaterial = firstString(externalTray.tray_type, externalTray.material, externalTray.filament_type) !== null;
    const color = normalizeBambuColor(firstString(externalTray.tray_color, firstArrayString(externalTray.cols)));
    const hasTrayIdentity = 'id' in externalTray || 'tray_id' in externalTray;
    if (hasTrayIdentity || hasMaterial || color !== null) {
      slots.push({
        unit_type: 'external',
        unit_index: 0,
        slot_index: 0,
        display_name: 'External spool path',
        state: trayNow === 254 ? 'feeding' : hasMaterial || color !== null ? 'loaded' : 'empty',
        detected_material_type: normalizeBambuMaterial(firstString(externalTray.tray_type, externalTray.material, externalTray.filament_type)),
        detected_color_hex: color,
        detected_remaining_percent: null
      });
    }
  }
  return slots;
}

export function normalizeBambuMaterial(value: string | null): MaterialType | null {
  if (value === null) return null;
  const normalized = value.trim().toUpperCase().replace(/[\s_-]+/g, '');
  if (normalized.length === 0) return null;
  if (normalized.includes('SUPPORT')) return 'SUPPORT';
  if (normalized === 'PLA') return 'PLA';
  if (normalized === 'PETG') return 'PETG';
  if (normalized === 'ABS') return 'ABS';
  if (normalized === 'ASA') return 'ASA';
  if (normalized === 'TPU') return 'TPU';
  if (normalized === 'PA' || normalized === 'NYLON') return 'PA';
  if (normalized === 'PC') return 'PC';
  if (normalized === 'PVA') return 'PVA';
  return 'OTHER';
}

export function normalizeBambuColor(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  const withoutHash = trimmed.startsWith('#') ? trimmed.slice(1) : trimmed;
  if (/^[0-9a-fA-F]{8}$/.test(withoutHash)) return `#${withoutHash.slice(0, 6).toUpperCase()}`;
  if (/^[0-9a-fA-F]{6}$/.test(withoutHash)) return `#${withoutHash.toUpperCase()}`;
  return null;
}

export function createBambuPushAllRequest(sequenceId = `fb-${Date.now().toString(36)}`): { pushing: { sequence_id: string; command: 'pushall'; version: 1; push_target: 1 } } {
  return {
    pushing: {
      sequence_id: sequenceId,
      command: 'pushall',
      version: 1,
      push_target: 1
    }
  };
}

export function defaultObservedSlots(model: string, capability: PrinterCapabilityLevel): ObservedPrinterSlot[] {
  const family = familyForModel(model);
  if (capability === 'unsupported') {
    return [];
  }
  if (family === 'A1') {
    return Array.from({ length: 4 }, (_, index) => ({
      unit_type: 'ams_lite' as const,
      unit_index: 0,
      slot_index: index,
      display_name: `AMS Lite ${index + 1}`,
      state: 'unknown' as const,
      detected_material_type: null,
      detected_color_hex: null,
      detected_remaining_percent: null
    }));
  }
  if (family === 'H2') {
    return [
      ...Array.from({ length: 4 }, (_, index) => ({
        unit_type: 'ams_2_pro' as const,
        unit_index: 0,
        slot_index: index,
        display_name: `AMS 2 Pro ${index + 1}`,
        state: 'unknown' as const,
        detected_material_type: null,
        detected_color_hex: null,
        detected_remaining_percent: null
      })),
      {
        unit_type: 'external' as const,
        unit_index: 0,
        slot_index: 0,
        display_name: 'External spool path',
        state: 'unknown' as const,
        detected_material_type: null,
        detected_color_hex: null,
        detected_remaining_percent: null
      }
    ];
  }
  return Array.from({ length: 4 }, (_, index) => ({
    unit_type: 'ams' as const,
    unit_index: 0,
    slot_index: index,
    display_name: `AMS ${index + 1}`,
    state: index === 0 ? 'loaded' as const : 'unknown' as const,
    detected_material_type: index === 0 ? 'PLA' as const : null,
    detected_color_hex: index === 0 ? '#1e88e5' : null,
    detected_remaining_percent: index === 0 ? 83 : null
  }));
}

function missingCredentialReason(credentials: BambuLanMqttCredentials): string | null {
  if (credentials.lan_access_code === null || credentials.lan_access_code.trim().length === 0) {
    return 'Bambu LAN MQTT requires a LAN access code.';
  }
  if (credentials.device_id === null || credentials.device_id.trim().length === 0) {
    return 'Bambu LAN MQTT requires a device id/serial for exact MQTT topics.';
  }
  return null;
}

function observedFromExistingSlot(slot: PrinterSlot): ObservedPrinterSlot {
  return {
    unit_type: slot.unit_type,
    unit_index: slot.unit_index,
    slot_index: slot.slot_index,
    display_name: slot.display_name,
    state: slot.state === 'unknown' ? 'loaded' : slot.state,
    detected_material_type: slot.detected_material_type,
    detected_color_hex: slot.detected_color_hex,
    detected_remaining_percent: slot.detected_remaining_percent
  };
}

function normalizeModel(model: string): string {
  return model.trim().toLowerCase().replace(/\s+/g, ' ');
}

function stripRfidAdjacentFields(value: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (!isRfidAdjacentKey(key)) sanitized[key] = stripRfidAdjacentValue(child);
  }
  return sanitized;
}

function stripRfidAdjacentValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripRfidAdjacentValue);
  if (isRecord(value)) return stripRfidAdjacentFields(value);
  return value;
}

function isRfidAdjacentKey(key: string): boolean {
  return key === 'tag_uid' || key === 'tray_uuid' || key === 'ams_rfid_status' || key === 'rfid';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
  return null;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) return value;
  }
  return null;
}

function firstArrayString(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  for (const item of value) {
    if (typeof item === 'string' && item.trim().length > 0) return item;
  }
  return null;
}
