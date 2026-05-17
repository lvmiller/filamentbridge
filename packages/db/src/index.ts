import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import {
  EXPORT_FORMAT,
  OFFICIAL_RFID_BOUNDARY,
  applyWeightDelta,
  assertSpoolWeightInvariant,
  nowIso,
  type Device,
  type DeviceType,
  type FilamentBridgeExport,
  type FilamentCatalogItem,
  type NfcTag,
  type NfcTagStatus,
  type Printer,
  type PrinterCapabilityLevel,
  type PrinterConnectionMode,
  type PrinterSlot,
  type PrinterSlotState,
  type PrinterSlotUnitType,
  type Spool,
  type SyncEvent,
  type SyncSource,
  type SyncStatus,
  type UsageConfidence,
  type UsageEvent,
  type UsageReviewStatus,
  type UsageSource,
  type User
} from '../../shared/src/index';

export type OpenDatabaseOptions = {
  path: string;
  migrate?: boolean;
};

export type StoredUser = User & { password_hash: string };
export type StoredSession = {
  id: string;
  user_id: string;
  device_id: string;
  token_hash: string;
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
};

export type PairingCode = {
  id: string;
  user_id: string;
  pairing_code_hash: string;
  device_name: string;
  device_type: DeviceType;
  created_at: string;
  expires_at: string;
  consumed_at: string | null;
};

export type RepositoryErrorCode = 'not_found' | 'conflict' | 'invalid_state' | 'unauthorized';

export class RepositoryError extends Error {
  readonly code: RepositoryErrorCode;

  constructor(code: RepositoryErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export type CreateUserRecord = {
  email: string;
  display_name: string;
  password_hash: string;
  role?: 'owner' | 'admin' | 'operator' | 'viewer';
};

export type CreateCatalogRecord = Omit<FilamentCatalogItem, 'id' | 'created_at' | 'updated_at' | 'deleted_at' | 'version'>;
export type PatchCatalogRecord = Partial<CreateCatalogRecord> & { expected_version: number };

export type CreateSpoolRecord = Omit<Spool, 'id' | 'created_at' | 'updated_at' | 'deleted_at' | 'version' | 'active_tag_id'>;
export type PatchSpoolRecord = Partial<Omit<CreateSpoolRecord, 'remaining_filament_weight_g'>> & { expected_version: number };

export type CreatePrinterRecord = {
  name: string;
  manufacturer: 'Bambu Lab';
  model: string;
  serial_hash: string;
  host: string;
  lan_access_code_secret_ref: string | null;
  connection_mode: PrinterConnectionMode;
  capability_level: PrinterCapabilityLevel;
  firmware_version: string | null;
  notes: string | null;
};

export type PatchPrinterRecord = Partial<Omit<CreatePrinterRecord, 'serial_hash' | 'lan_access_code_secret_ref'>> & {
  expected_version: number;
  serial_hash?: string;
  lan_access_code_secret_ref?: string | null;
};

export type CreatePrinterSlotRecord = {
  printer_id: string;
  unit_type: PrinterSlotUnitType;
  unit_index: number;
  slot_index: number;
  display_name: string;
  mapped_spool_id: string | null;
  detected_material_type: PrinterSlot['detected_material_type'];
  detected_color_hex: string | null;
  detected_remaining_percent: number | null;
  state: PrinterSlotState;
};

export type CreateUsageEventRecord = {
  spool_id: string;
  source: UsageSource;
  printer_id: string | null;
  printer_slot_id: string | null;
  job_id: string | null;
  delta_weight_g: number;
  confidence: UsageConfidence;
  review_status: UsageReviewStatus;
  notes: string | null;
};

export type CreateSyncEventRecord = {
  id?: string;
  source: SyncSource;
  source_device_id: string | null;
  entity_type: string;
  entity_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  status: SyncStatus;
  error_message: string | null;
};

export function openFilamentBridgeDatabase(options: OpenDatabaseOptions): FilamentBridgeRepository {
  if (options.path !== ':memory:') {
    mkdirSync(dirname(options.path), { recursive: true });
  }
  const database = new DatabaseSync(options.path);
  const repo = new FilamentBridgeRepository(database, options.path);
  if (options.migrate !== false) {
    repo.migrate();
  }
  return repo;
}

export class FilamentBridgeRepository {
  readonly database: DatabaseSync;
  readonly path: string;

  constructor(database: DatabaseSync, path = ':memory:') {
    this.database = database;
    this.path = path;
  }

  close(): void {
    this.database.close();
  }

  migrate(): void {
    this.database.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
    this.database.exec(SCHEMA_SQL);
    this.setMetaIfMissing('schema_version', '1');
    this.setMetaIfMissing('boundary', OFFICIAL_RFID_BOUNDARY);
  }

  transaction<T>(fn: () => T): T {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const value = fn();
      this.database.exec('COMMIT');
      return value;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  getMeta(key: string): string | null {
    const row = this.database.prepare('select value from app_meta where key = ?').get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  setMeta(key: string, value: string): void {
    this.database.prepare('insert into app_meta(key, value) values(?, ?) on conflict(key) do update set value = excluded.value').run(key, value);
  }

  setMetaIfMissing(key: string, value: string): void {
    this.database.prepare('insert or ignore into app_meta(key, value) values(?, ?)').run(key, value);
  }

  getInstanceId(): string | null {
    return this.getMeta('instance_id');
  }

  setInstanceId(instanceId: string): void {
    this.setMeta('instance_id', instanceId);
  }

  ownerExists(): boolean {
    const row = this.database.prepare("select count(*) as count from users where role = 'owner' and status = 'active'").get() as { count: number };
    return row.count > 0;
  }

  createUser(input: CreateUserRecord): StoredUser {
    const now = nowIso();
    const user: StoredUser = {
      id: randomUUID(),
      email: input.email.trim().toLowerCase(),
      display_name: input.display_name,
      role: input.role ?? 'owner',
      password_hash: input.password_hash,
      last_login_at: null,
      status: 'active',
      created_at: now,
      updated_at: now
    };
    this.database.prepare(`insert into users(id, email, display_name, role, password_hash, last_login_at, status, created_at, updated_at)
      values(@id, @email, @display_name, @role, @password_hash, @last_login_at, @status, @created_at, @updated_at)`).run(user);
    return user;
  }

  findUserByEmail(email: string): StoredUser | null {
    const row = this.database.prepare('select * from users where email = ? and status = ?').get(email.trim().toLowerCase(), 'active') as StoredUser | undefined;
    return row ?? null;
  }

  getUser(id: string): User {
    const row = this.database.prepare('select id, email, display_name, role, last_login_at, status, created_at, updated_at from users where id = ?').get(id) as User | undefined;
    if (row === undefined) {
      throw new RepositoryError('not_found', 'user not found');
    }
    return row;
  }

  touchUserLogin(id: string): void {
    const now = nowIso();
    this.database.prepare('update users set last_login_at = ?, updated_at = ? where id = ?').run(now, now, id);
  }

  createDevice(userId: string, deviceType: DeviceType, name: string, trusted = true): Device {
    const now = nowIso();
    const device: Device = {
      id: randomUUID(),
      user_id: userId,
      device_type: deviceType,
      name,
      paired_at: now,
      last_seen_at: now,
      trusted,
      revoked_at: null
    };
    this.database.prepare(`insert into devices(id, user_id, device_type, name, paired_at, last_seen_at, trusted, revoked_at)
      values(@id, @user_id, @device_type, @name, @paired_at, @last_seen_at, @trusted, @revoked_at)`).run({ ...device, trusted: device.trusted ? 1 : 0 });
    return device;
  }

  listDevices(): Device[] {
    return this.database.prepare('select * from devices order by paired_at desc').all().map(mapDevice);
  }

  getDevice(id: string): Device {
    const row = this.database.prepare('select * from devices where id = ?').get(id);
    if (row === undefined) {
      throw new RepositoryError('not_found', 'device not found');
    }
    return mapDevice(row);
  }

  revokeDevice(id: string): Device {
    const now = nowIso();
    const result = this.database.prepare('update devices set trusted = 0, revoked_at = coalesce(revoked_at, ?), last_seen_at = ? where id = ?').run(now, now, id);
    if (result.changes === 0) {
      throw new RepositoryError('not_found', 'device not found');
    }
    this.database.prepare('update sessions set revoked_at = coalesce(revoked_at, ?) where device_id = ?').run(now, id);
    return this.getDevice(id);
  }

  createSession(userId: string, deviceId: string, tokenHash: string, expiresAt: string | null): StoredSession {
    const session: StoredSession = {
      id: randomUUID(),
      user_id: userId,
      device_id: deviceId,
      token_hash: tokenHash,
      created_at: nowIso(),
      expires_at: expiresAt,
      revoked_at: null
    };
    this.database.prepare(`insert into sessions(id, user_id, device_id, token_hash, created_at, expires_at, revoked_at)
      values(@id, @user_id, @device_id, @token_hash, @created_at, @expires_at, @revoked_at)`).run(session);
    return session;
  }

  getSessionByTokenHash(tokenHash: string): StoredSession | null {
    const row = this.database.prepare(`select s.* from sessions s join devices d on d.id = s.device_id
      where s.token_hash = ? and s.revoked_at is null and d.revoked_at is null and d.trusted = 1
      and (s.expires_at is null or s.expires_at > ?)`).get(tokenHash, nowIso()) as StoredSession | undefined;
    return row ?? null;
  }

  revokeSessionByTokenHash(tokenHash: string): void {
    this.database.prepare('update sessions set revoked_at = coalesce(revoked_at, ?) where token_hash = ?').run(nowIso(), tokenHash);
  }

  createPairingCode(input: { user_id: string; pairing_code_hash: string; device_name: string; device_type: DeviceType; expires_at: string }): PairingCode {
    const code: PairingCode = {
      id: randomUUID(),
      user_id: input.user_id,
      pairing_code_hash: input.pairing_code_hash,
      device_name: input.device_name,
      device_type: input.device_type,
      created_at: nowIso(),
      expires_at: input.expires_at,
      consumed_at: null
    };
    this.database.prepare(`insert into pairing_codes(id, user_id, pairing_code_hash, device_name, device_type, created_at, expires_at, consumed_at)
      values(@id, @user_id, @pairing_code_hash, @device_name, @device_type, @created_at, @expires_at, @consumed_at)`).run(code);
    return code;
  }

  consumePairingCode(pairingCodeHash: string): PairingCode {
    return this.transaction(() => {
      const row = this.database.prepare('select * from pairing_codes where pairing_code_hash = ? and consumed_at is null and expires_at > ?').get(pairingCodeHash, nowIso()) as PairingCode | undefined;
      if (row === undefined) {
        throw new RepositoryError('unauthorized', 'pairing code is invalid or expired');
      }
      this.database.prepare('update pairing_codes set consumed_at = ? where id = ?').run(nowIso(), row.id);
      return { ...row, consumed_at: nowIso() };
    });
  }

  createCatalogItem(input: CreateCatalogRecord): FilamentCatalogItem {
    const now = nowIso();
    const item: FilamentCatalogItem = { id: randomUUID(), created_at: now, updated_at: now, deleted_at: null, version: 1, ...input };
    this.database.prepare(CATALOG_INSERT_SQL).run(item);
    return item;
  }

  listCatalogItems(includeDeleted = false): FilamentCatalogItem[] {
    const sql = includeDeleted ? 'select * from catalog_items order by brand, product_line, color_name' : 'select * from catalog_items where deleted_at is null order by brand, product_line, color_name';
    return this.database.prepare(sql).all() as FilamentCatalogItem[];
  }

  getCatalogItem(id: string): FilamentCatalogItem {
    const row = this.database.prepare('select * from catalog_items where id = ?').get(id) as FilamentCatalogItem | undefined;
    if (row === undefined || row.deleted_at !== null) {
      throw new RepositoryError('not_found', 'catalog item not found');
    }
    return row;
  }

  updateCatalogItem(id: string, patch: PatchCatalogRecord): FilamentCatalogItem {
    const current = this.getCatalogItem(id);
    assertVersion(current.version, patch.expected_version);
    const next: FilamentCatalogItem = { ...current, ...withoutExpectedVersion(patch), version: current.version + 1, updated_at: nowIso() };
    this.database.prepare(CATALOG_UPDATE_SQL).run(next);
    return next;
  }

  deleteCatalogItem(id: string, expectedVersion: number): FilamentCatalogItem {
    const current = this.getCatalogItem(id);
    assertVersion(current.version, expectedVersion);
    const activeSpoolCount = this.database.prepare('select count(*) as count from spools where catalog_item_id = ? and deleted_at is null').get(id) as { count: number };
    if (activeSpoolCount.count > 0) {
      throw new RepositoryError('invalid_state', 'catalog item has active spools; remove those spools before deleting it');
    }
    const now = nowIso();
    const next: FilamentCatalogItem = { ...current, deleted_at: now, updated_at: now, version: current.version + 1 };
    this.database.prepare(CATALOG_UPDATE_SQL).run(next);
    return next;
  }

  importCatalogItems(items: CreateCatalogRecord[]): FilamentCatalogItem[] {
    return this.transaction(() => items.map((item) => this.createCatalogItem(item)));
  }

  createSpool(input: CreateSpoolRecord): Spool {
    assertSpoolWeightInvariant({ ...input, active_tag_id: null } as Spool);
    this.getCatalogItem(input.catalog_item_id);
    const now = nowIso();
    const spool: Spool = { id: randomUUID(), created_at: now, updated_at: now, deleted_at: null, version: 1, active_tag_id: null, ...input };
    this.database.prepare(SPOOL_INSERT_SQL).run(spool);
    return spool;
  }

  listSpools(includeDeleted = false): Spool[] {
    const sql = includeDeleted ? 'select * from spools order by updated_at desc' : 'select * from spools where deleted_at is null order by updated_at desc';
    return this.database.prepare(sql).all() as Spool[];
  }

  getSpool(id: string): Spool {
    const row = this.database.prepare('select * from spools where id = ?').get(id) as Spool | undefined;
    if (row === undefined || row.deleted_at !== null) {
      throw new RepositoryError('not_found', 'spool not found');
    }
    return row;
  }

  updateSpool(id: string, patch: PatchSpoolRecord): Spool {
    const current = this.getSpool(id);
    assertVersion(current.version, patch.expected_version);
    const next: Spool = { ...current, ...withoutExpectedVersion(patch), version: current.version + 1, updated_at: nowIso() };
    assertSpoolWeightInvariant(next);
    this.database.prepare(SPOOL_UPDATE_SQL).run(next);
    return next;
  }

  deleteSpool(id: string, expectedVersion: number): Spool {
    return this.transaction(() => {
      const current = this.getSpool(id);
      assertVersion(current.version, expectedVersion);
      const now = nowIso();
      const next: Spool = { ...current, status: 'retired', active_tag_id: null, deleted_at: now, updated_at: now, version: current.version + 1 };
      this.database.prepare(SPOOL_UPDATE_SQL).run(next);
      this.database.prepare("update nfc_tags set status = 'retired', deleted_at = coalesce(deleted_at, ?), updated_at = ?, version = version + 1 where assigned_spool_id = ? and status != 'retired'").run(now, now, id);
      this.database.prepare('update printer_slots set mapped_spool_id = null, updated_at = ?, version = version + 1 where mapped_spool_id = ? and deleted_at is null').run(now, id);
      return next;
    });
  }

  retireSpool(id: string, expectedVersion: number): Spool {
    return this.deleteSpool(id, expectedVersion);
  }

  manualAdjustment(spoolId: string, expectedVersion: number, newRemainingWeightG: number, notes: string | null): { spool: Spool; usage_event: UsageEvent } {
    return this.transaction(() => {
      const spool = this.getSpool(spoolId);
      assertVersion(spool.version, expectedVersion);
      const delta = newRemainingWeightG - spool.remaining_filament_weight_g;
      if (newRemainingWeightG > spool.initial_filament_weight_g) {
        throw new RepositoryError('invalid_state', 'remaining weight cannot exceed initial filament weight');
      }
      const now = nowIso();
      const next: Spool = { ...spool, remaining_filament_weight_g: newRemainingWeightG, updated_at: now, version: spool.version + 1 };
      this.database.prepare(SPOOL_UPDATE_SQL).run(next);
      const usageEvent = this.insertUsageEvent({
        spool_id: spoolId,
        source: 'manual',
        printer_id: null,
        printer_slot_id: null,
        job_id: null,
        delta_weight_g: delta,
        before_weight_g: spool.remaining_filament_weight_g,
        after_weight_g: newRemainingWeightG,
        confidence: 'user_confirmed',
        review_status: 'auto_approved',
        notes,
        created_at: now,
        updated_at: now
      });
      return { spool: next, usage_event: usageEvent };
    });
  }

  createPendingUsageEvent(input: CreateUsageEventRecord): UsageEvent {
    const spool = this.getSpool(input.spool_id);
    const after = Math.max(0, spool.remaining_filament_weight_g + input.delta_weight_g);
    return this.insertUsageEvent({
      ...input,
      before_weight_g: spool.remaining_filament_weight_g,
      after_weight_g: after,
      created_at: nowIso(),
      updated_at: nowIso()
    });
  }

  listUsageEvents(reviewStatus?: UsageReviewStatus): UsageEvent[] {
    const statement = reviewStatus === undefined
      ? this.database.prepare('select * from usage_events order by created_at desc')
      : this.database.prepare('select * from usage_events where review_status = ? order by created_at desc');
    return (reviewStatus === undefined ? statement.all() : statement.all(reviewStatus)) as UsageEvent[];
  }

  getUsageEvent(id: string): UsageEvent {
    const row = this.database.prepare('select * from usage_events where id = ?').get(id) as UsageEvent | undefined;
    if (row === undefined) {
      throw new RepositoryError('not_found', 'usage event not found');
    }
    return row;
  }

  approveUsageEvent(id: string, expectedSpoolVersion?: number): { spool: Spool; usage_event: UsageEvent } {
    return this.applyUsageEvent(id, undefined, expectedSpoolVersion, 'approved');
  }

  editAndApproveUsageEvent(id: string, deltaWeightG: number, notes: string | null, expectedSpoolVersion?: number): { spool: Spool; usage_event: UsageEvent } {
    return this.applyUsageEvent(id, { deltaWeightG, notes }, expectedSpoolVersion, 'edited');
  }

  rejectUsageEvent(id: string): UsageEvent {
    const current = this.getUsageEvent(id);
    if (current.review_status !== 'pending') {
      throw new RepositoryError('invalid_state', 'only pending usage events can be rejected');
    }
    const next: UsageEvent = { ...current, review_status: 'rejected', updated_at: nowIso() };
    this.database.prepare(USAGE_UPDATE_SQL).run(next);
    return next;
  }

  assignNfcTag(input: { tag_uid_hash: string; spool_id: string; expected_spool_version: number; instance_id: string; public_key_id: string }): { tag: NfcTag; spool: Spool } {
    return this.transaction(() => {
      const spool = this.getSpool(input.spool_id);
      assertVersion(spool.version, input.expected_spool_version);
      const now = nowIso();
      const existing = this.getTagByUidHash(input.tag_uid_hash, true);
      if (existing !== null && existing.status !== 'blank' && existing.status !== 'retired' && existing.assigned_spool_id !== input.spool_id) {
        throw new RepositoryError('conflict', 'tag is already assigned to another spool');
      }
      if (spool.active_tag_id !== null) {
        this.database.prepare("update nfc_tags set status = 'retired', updated_at = ?, version = version + 1 where id = ?").run(now, spool.active_tag_id);
      }
      const tag: NfcTag = existing === null
        ? {
          id: randomUUID(),
          created_at: now,
          updated_at: now,
          deleted_at: null,
          version: 1,
          tag_uid_hash: input.tag_uid_hash,
          format: 'filamentbridge-v1',
          payload_version: 1,
          assigned_spool_id: input.spool_id,
          instance_id: input.instance_id,
          public_key_id: input.public_key_id,
          last_written_at: null,
          last_read_at: null,
          write_count: 0,
          status: 'assigned',
          last_payload_hash: null
        }
        : { ...existing, assigned_spool_id: input.spool_id, instance_id: input.instance_id, public_key_id: input.public_key_id, status: 'assigned', updated_at: now, version: existing.version + 1 };
      if (existing === null) {
        this.database.prepare(NFC_INSERT_SQL).run(tag);
      } else {
        this.database.prepare(NFC_UPDATE_SQL).run(tag);
      }
      const nextSpool: Spool = { ...spool, active_tag_id: tag.id, updated_at: now, version: spool.version + 1 };
      this.database.prepare(SPOOL_UPDATE_SQL).run(nextSpool);
      return { tag, spool: nextSpool };
    });
  }

  getTag(id: string): NfcTag {
    const row = this.database.prepare('select * from nfc_tags where id = ?').get(id) as NfcTag | undefined;
    if (row === undefined) {
      throw new RepositoryError('not_found', 'NFC tag not found');
    }
    return row;
  }

  getTagByUidHash(tagUidHash: string, includeRetired = false): NfcTag | null {
    const sql = includeRetired ? 'select * from nfc_tags where tag_uid_hash = ?' : "select * from nfc_tags where tag_uid_hash = ? and status != 'retired'";
    const row = this.database.prepare(sql).get(tagUidHash) as NfcTag | undefined;
    return row ?? null;
  }

  listTags(): NfcTag[] {
    return this.database.prepare('select * from nfc_tags order by updated_at desc').all() as NfcTag[];
  }

  recordTagWrite(tagId: string, payloadHash: string): NfcTag {
    const tag = this.getTag(tagId);
    if (tag.status === 'retired') {
      throw new RepositoryError('invalid_state', 'retired tags cannot be written');
    }
    const next: NfcTag = { ...tag, last_written_at: nowIso(), write_count: tag.write_count + 1, status: 'assigned', last_payload_hash: payloadHash, updated_at: nowIso(), version: tag.version + 1 };
    this.database.prepare(NFC_UPDATE_SQL).run(next);
    return next;
  }

  recordTagScan(tagId: string, status?: NfcTagStatus): NfcTag {
    const tag = this.getTag(tagId);
    const next: NfcTag = { ...tag, last_read_at: nowIso(), status: status ?? tag.status, updated_at: nowIso(), version: tag.version + 1 };
    this.database.prepare(NFC_UPDATE_SQL).run(next);
    return next;
  }

  retireTag(tagId: string, expectedVersion: number): { tag: NfcTag; spool: Spool | null } {
    return this.transaction(() => {
      const tag = this.getTag(tagId);
      assertVersion(tag.version, expectedVersion);
      const now = nowIso();
      const nextTag: NfcTag = { ...tag, status: 'retired', deleted_at: now, updated_at: now, version: tag.version + 1 };
      this.database.prepare(NFC_UPDATE_SQL).run(nextTag);
      let spool: Spool | null = null;
      if (tag.assigned_spool_id !== null) {
        const current = this.getSpool(tag.assigned_spool_id);
        if (current.active_tag_id === tag.id) {
          spool = { ...current, active_tag_id: null, updated_at: now, version: current.version + 1 };
          this.database.prepare(SPOOL_UPDATE_SQL).run(spool);
        }
      }
      return { tag: nextTag, spool };
    });
  }

  createPrinter(input: CreatePrinterRecord): Printer {
    const now = nowIso();
    const printer: Printer = { id: randomUUID(), created_at: now, updated_at: now, deleted_at: null, version: 1, last_seen_at: null, ...input };
    this.database.prepare(PRINTER_INSERT_SQL).run(printer);
    return printer;
  }

  listPrinters(): Printer[] {
    return this.database.prepare('select * from printers where deleted_at is null order by name').all() as Printer[];
  }

  getPrinter(id: string): Printer {
    const row = this.database.prepare('select * from printers where id = ?').get(id) as Printer | undefined;
    if (row === undefined || row.deleted_at !== null) {
      throw new RepositoryError('not_found', 'printer not found');
    }
    return row;
  }

  updatePrinter(id: string, patch: PatchPrinterRecord): Printer {
    const current = this.getPrinter(id);
    assertVersion(current.version, patch.expected_version);
    const next: Printer = { ...current, ...withoutExpectedVersion(patch), updated_at: nowIso(), version: current.version + 1 };
    this.database.prepare(PRINTER_UPDATE_SQL).run(next);
    return next;
  }

  deletePrinter(id: string, expectedVersion: number): Printer {
    return this.transaction(() => {
      const current = this.getPrinter(id);
      assertVersion(current.version, expectedVersion);
      const now = nowIso();
      const next: Printer = { ...current, deleted_at: now, updated_at: now, version: current.version + 1 };
      this.database.prepare(PRINTER_UPDATE_SQL).run(next);
      this.database.prepare('update printer_slots set deleted_at = coalesce(deleted_at, ?), mapped_spool_id = null, updated_at = ?, version = version + 1 where printer_id = ? and deleted_at is null').run(now, now, id);
      return next;
    });
  }

  touchPrinterSeen(id: string, capabilityLevel?: PrinterCapabilityLevel): Printer {
    const current = this.getPrinter(id);
    const next: Printer = { ...current, last_seen_at: nowIso(), capability_level: capabilityLevel ?? current.capability_level, updated_at: nowIso(), version: current.version + 1 };
    this.database.prepare(PRINTER_UPDATE_SQL).run(next);
    return next;
  }

  createPrinterSlot(input: CreatePrinterSlotRecord): PrinterSlot {
    this.getPrinter(input.printer_id);
    const now = nowIso();
    const slot: PrinterSlot = {
      id: randomUUID(),
      created_at: now,
      updated_at: now,
      deleted_at: null,
      version: 1,
      last_detected_at: null,
      ...input
    };
    this.database.prepare(SLOT_INSERT_SQL).run(slot);
    return slot;
  }

  upsertPrinterSlot(input: CreatePrinterSlotRecord): PrinterSlot {
    const existing = this.database.prepare('select * from printer_slots where printer_id = ? and unit_type = ? and unit_index = ? and slot_index = ?').get(input.printer_id, input.unit_type, input.unit_index, input.slot_index) as PrinterSlot | undefined;
    if (existing === undefined) {
      return this.createPrinterSlot(input);
    }
    const next: PrinterSlot = { ...existing, ...input, last_detected_at: nowIso(), updated_at: nowIso(), version: existing.version + 1 };
    this.database.prepare(SLOT_UPDATE_SQL).run(next);
    return next;
  }

  listPrinterSlots(printerId: string): PrinterSlot[] {
    return this.database.prepare('select * from printer_slots where printer_id = ? and deleted_at is null order by unit_index, slot_index').all(printerId) as PrinterSlot[];
  }

  getPrinterSlot(id: string): PrinterSlot {
    const row = this.database.prepare('select * from printer_slots where id = ?').get(id) as PrinterSlot | undefined;
    if (row === undefined || row.deleted_at !== null) {
      throw new RepositoryError('not_found', 'printer slot not found');
    }
    return row;
  }

  mapPrinterSlot(id: string, mappedSpoolId: string | null, expectedVersion: number): PrinterSlot {
    const current = this.getPrinterSlot(id);
    assertVersion(current.version, expectedVersion);
    if (mappedSpoolId !== null) {
      this.getSpool(mappedSpoolId);
    }
    const next: PrinterSlot = { ...current, mapped_spool_id: mappedSpoolId, updated_at: nowIso(), version: current.version + 1 };
    this.database.prepare(SLOT_UPDATE_SQL).run(next);
    return next;
  }

  createSyncEvent(input: CreateSyncEventRecord): SyncEvent {
    const now = nowIso();
    const event: SyncEvent = {
      id: input.id ?? randomUUID(),
      source: input.source,
      source_device_id: input.source_device_id,
      entity_type: input.entity_type,
      entity_id: input.entity_id,
      event_type: input.event_type,
      payload: input.payload,
      status: input.status,
      created_at: now,
      applied_at: input.status === 'applied' ? now : null,
      error_message: input.error_message
    };
    this.database.prepare(SYNC_INSERT_SQL).run({ ...event, payload: JSON.stringify(event.payload) });
    return event;
  }

  listSyncEvents(): SyncEvent[] {
    return this.database.prepare('select * from sync_events order by created_at desc').all().map(mapSyncEvent);
  }

  createExportSnapshot(): FilamentBridgeExport {
    const instanceId = this.getInstanceId();
    if (instanceId === null) {
      throw new RepositoryError('invalid_state', 'instance id is not configured');
    }
    return {
      format: EXPORT_FORMAT,
      exported_at: nowIso(),
      instance_id: instanceId,
      catalog_items: this.listCatalogItems(true),
      spools: this.listSpools(true),
      nfc_tags: this.listTags(),
      printers: this.database.prepare('select * from printers order by name').all() as Printer[],
      printer_slots: this.database.prepare('select * from printer_slots order by printer_id, unit_index, slot_index').all() as PrinterSlot[],
      usage_events: this.listUsageEvents()
    };
  }

  restoreExportSnapshot(snapshot: FilamentBridgeExport): void {
    if (snapshot.format !== EXPORT_FORMAT) {
      throw new RepositoryError('invalid_state', 'unsupported export format');
    }
    this.transaction(() => {
      this.database.exec('delete from sync_events; delete from usage_events; delete from printer_slots; delete from printers; delete from nfc_tags; delete from spools; delete from catalog_items;');
      this.setInstanceId(snapshot.instance_id);
      for (const item of snapshot.catalog_items) this.database.prepare(CATALOG_INSERT_SQL).run(item);
      for (const spool of snapshot.spools) this.database.prepare(SPOOL_INSERT_SQL).run(spool);
      for (const tag of snapshot.nfc_tags) this.database.prepare(NFC_INSERT_SQL).run(tag);
      for (const printer of snapshot.printers) this.database.prepare(PRINTER_INSERT_SQL).run(printer);
      for (const slot of snapshot.printer_slots) this.database.prepare(SLOT_INSERT_SQL).run(slot);
      for (const usage of snapshot.usage_events) this.database.prepare(USAGE_INSERT_SQL).run(usage);
    });
  }

  private applyUsageEvent(id: string, edit: { deltaWeightG: number; notes: string | null } | undefined, expectedSpoolVersion: number | undefined, status: 'approved' | 'edited'): { spool: Spool; usage_event: UsageEvent } {
    return this.transaction(() => {
      const current = this.getUsageEvent(id);
      if (current.review_status !== 'pending') {
        throw new RepositoryError('invalid_state', 'only pending usage events can be approved');
      }
      const spool = this.getSpool(current.spool_id);
      if (expectedSpoolVersion !== undefined) {
        assertVersion(spool.version, expectedSpoolVersion);
      }
      const delta = edit?.deltaWeightG ?? current.delta_weight_g;
      const after = applyWeightDelta(spool.remaining_filament_weight_g, delta);
      const now = nowIso();
      const nextSpool: Spool = { ...spool, remaining_filament_weight_g: after, updated_at: now, version: spool.version + 1 };
      this.database.prepare(SPOOL_UPDATE_SQL).run(nextSpool);
      const nextEvent: UsageEvent = {
        ...current,
        delta_weight_g: delta,
        before_weight_g: spool.remaining_filament_weight_g,
        after_weight_g: after,
        review_status: status,
        notes: edit?.notes ?? current.notes,
        updated_at: now
      };
      this.database.prepare(USAGE_UPDATE_SQL).run(nextEvent);
      return { spool: nextSpool, usage_event: nextEvent };
    });
  }

  private insertUsageEvent(input: Omit<UsageEvent, 'id'>): UsageEvent {
    const event: UsageEvent = { id: randomUUID(), ...input };
    this.database.prepare(USAGE_INSERT_SQL).run(event);
    return event;
  }
}

export function seedDemoData(repo: FilamentBridgeRepository): { catalog_item: FilamentCatalogItem; spool: Spool } {
  const catalog = repo.createCatalogItem({
    brand: 'Bambu Lab',
    product_line: 'PLA Basic',
    material_type: 'PLA',
    diameter_mm: 1.75,
    color_name: 'Blue',
    color_hex: '#1e88e5',
    nozzle_temp_min_c: 190,
    nozzle_temp_max_c: 230,
    bed_temp_min_c: 35,
    bed_temp_max_c: 60,
    drying_temp_c: 45,
    drying_time_minutes: 240,
    density_g_cm3: 1.24,
    bambu_studio_preset_name: 'Bambu PLA Basic',
    orca_slicer_preset_name: 'Bambu PLA Basic',
    vendor_sku: null,
    notes: 'Demo catalog item'
  });
  const spool = repo.createSpool({
    catalog_item_id: catalog.id,
    display_name: 'Demo PLA Blue',
    manufacturer_name: catalog.brand,
    material_type: catalog.material_type,
    diameter_mm: catalog.diameter_mm,
    color_hex: catalog.color_hex,
    initial_filament_weight_g: 1000,
    remaining_filament_weight_g: 1000,
    empty_spool_weight_g: 250,
    purchase_date: null,
    opened_at: null,
    status: 'sealed',
    storage_location: 'Shelf A',
    notes: null
  });
  return { catalog_item: catalog, spool };
}

function assertVersion(actual: number, expected: number): void {
  if (actual !== expected) {
    throw new RepositoryError('conflict', `version conflict: expected ${expected}, current ${actual}`);
  }
}

function withoutExpectedVersion<T extends { expected_version: number }>(value: T): Omit<T, 'expected_version'> {
  const { expected_version: _expectedVersion, ...rest } = value;
  return rest;
}

function mapDevice(row: unknown): Device {
  const device = row as Device & { trusted: 0 | 1 | boolean };
  return { ...device, trusted: Boolean(device.trusted) };
}

function mapSyncEvent(row: unknown): SyncEvent {
  const event = row as Omit<SyncEvent, 'payload'> & { payload: string };
  return { ...event, payload: JSON.parse(event.payload) as Record<string, unknown> };
}

const SCHEMA_SQL = `
create table if not exists app_meta (
  key text primary key,
  value text not null
);

create table if not exists users (
  id text primary key,
  email text not null unique,
  display_name text not null,
  role text not null,
  password_hash text not null,
  last_login_at text,
  status text not null,
  created_at text not null,
  updated_at text not null
);

create table if not exists devices (
  id text primary key,
  user_id text not null references users(id),
  device_type text not null,
  name text not null,
  paired_at text not null,
  last_seen_at text,
  trusted integer not null,
  revoked_at text
);

create table if not exists sessions (
  id text primary key,
  user_id text not null references users(id),
  device_id text not null references devices(id),
  token_hash text not null unique,
  created_at text not null,
  expires_at text,
  revoked_at text
);

create table if not exists pairing_codes (
  id text primary key,
  user_id text not null references users(id),
  pairing_code_hash text not null unique,
  device_name text not null,
  device_type text not null,
  created_at text not null,
  expires_at text not null,
  consumed_at text
);

create table if not exists catalog_items (
  id text primary key,
  created_at text not null,
  updated_at text not null,
  deleted_at text,
  version integer not null,
  brand text not null,
  product_line text not null,
  material_type text not null,
  diameter_mm real not null,
  color_name text not null,
  color_hex text not null,
  nozzle_temp_min_c integer not null,
  nozzle_temp_max_c integer not null,
  bed_temp_min_c integer not null,
  bed_temp_max_c integer not null,
  drying_temp_c integer not null,
  drying_time_minutes integer not null,
  density_g_cm3 real not null,
  bambu_studio_preset_name text,
  orca_slicer_preset_name text,
  vendor_sku text,
  notes text
);

create table if not exists spools (
  id text primary key,
  created_at text not null,
  updated_at text not null,
  deleted_at text,
  version integer not null,
  catalog_item_id text not null references catalog_items(id),
  display_name text not null,
  manufacturer_name text not null,
  material_type text not null,
  diameter_mm real not null,
  color_hex text not null,
  initial_filament_weight_g integer not null,
  remaining_filament_weight_g integer not null,
  empty_spool_weight_g integer not null,
  purchase_date text,
  opened_at text,
  status text not null,
  storage_location text,
  notes text,
  active_tag_id text
);

create table if not exists nfc_tags (
  id text primary key,
  created_at text not null,
  updated_at text not null,
  deleted_at text,
  version integer not null,
  tag_uid_hash text not null unique,
  format text not null,
  payload_version integer not null,
  assigned_spool_id text references spools(id),
  instance_id text not null,
  public_key_id text not null,
  last_written_at text,
  last_read_at text,
  write_count integer not null,
  status text not null,
  last_payload_hash text
);

create table if not exists printers (
  id text primary key,
  created_at text not null,
  updated_at text not null,
  deleted_at text,
  version integer not null,
  name text not null,
  manufacturer text not null,
  model text not null,
  serial_hash text not null,
  host text not null,
  lan_access_code_secret_ref text,
  connection_mode text not null,
  capability_level text not null,
  last_seen_at text,
  firmware_version text,
  notes text
);

create table if not exists printer_slots (
  id text primary key,
  created_at text not null,
  updated_at text not null,
  deleted_at text,
  version integer not null,
  printer_id text not null references printers(id),
  unit_type text not null,
  unit_index integer not null,
  slot_index integer not null,
  display_name text not null,
  mapped_spool_id text references spools(id),
  detected_material_type text,
  detected_color_hex text,
  detected_remaining_percent integer,
  last_detected_at text,
  state text not null,
  unique(printer_id, unit_type, unit_index, slot_index)
);

create table if not exists sync_events (
  id text primary key,
  source text not null,
  source_device_id text,
  entity_type text not null,
  entity_id text not null,
  event_type text not null,
  payload text not null,
  status text not null,
  created_at text not null,
  applied_at text,
  error_message text
);

create table if not exists usage_events (
  id text primary key,
  spool_id text not null references spools(id),
  source text not null,
  printer_id text references printers(id),
  printer_slot_id text references printer_slots(id),
  job_id text,
  delta_weight_g integer not null,
  before_weight_g integer not null,
  after_weight_g integer not null,
  confidence text not null,
  review_status text not null,
  notes text,
  created_at text not null,
  updated_at text not null
);
`;

const CATALOG_INSERT_SQL = `insert into catalog_items(id, created_at, updated_at, deleted_at, version, brand, product_line, material_type, diameter_mm, color_name, color_hex, nozzle_temp_min_c, nozzle_temp_max_c, bed_temp_min_c, bed_temp_max_c, drying_temp_c, drying_time_minutes, density_g_cm3, bambu_studio_preset_name, orca_slicer_preset_name, vendor_sku, notes)
values(@id, @created_at, @updated_at, @deleted_at, @version, @brand, @product_line, @material_type, @diameter_mm, @color_name, @color_hex, @nozzle_temp_min_c, @nozzle_temp_max_c, @bed_temp_min_c, @bed_temp_max_c, @drying_temp_c, @drying_time_minutes, @density_g_cm3, @bambu_studio_preset_name, @orca_slicer_preset_name, @vendor_sku, @notes)`;

const CATALOG_UPDATE_SQL = `update catalog_items set created_at=@created_at, updated_at=@updated_at, deleted_at=@deleted_at, version=@version, brand=@brand, product_line=@product_line, material_type=@material_type, diameter_mm=@diameter_mm, color_name=@color_name, color_hex=@color_hex, nozzle_temp_min_c=@nozzle_temp_min_c, nozzle_temp_max_c=@nozzle_temp_max_c, bed_temp_min_c=@bed_temp_min_c, bed_temp_max_c=@bed_temp_max_c, drying_temp_c=@drying_temp_c, drying_time_minutes=@drying_time_minutes, density_g_cm3=@density_g_cm3, bambu_studio_preset_name=@bambu_studio_preset_name, orca_slicer_preset_name=@orca_slicer_preset_name, vendor_sku=@vendor_sku, notes=@notes where id=@id`;

const SPOOL_INSERT_SQL = `insert into spools(id, created_at, updated_at, deleted_at, version, catalog_item_id, display_name, manufacturer_name, material_type, diameter_mm, color_hex, initial_filament_weight_g, remaining_filament_weight_g, empty_spool_weight_g, purchase_date, opened_at, status, storage_location, notes, active_tag_id)
values(@id, @created_at, @updated_at, @deleted_at, @version, @catalog_item_id, @display_name, @manufacturer_name, @material_type, @diameter_mm, @color_hex, @initial_filament_weight_g, @remaining_filament_weight_g, @empty_spool_weight_g, @purchase_date, @opened_at, @status, @storage_location, @notes, @active_tag_id)`;

const SPOOL_UPDATE_SQL = `update spools set created_at=@created_at, updated_at=@updated_at, deleted_at=@deleted_at, version=@version, catalog_item_id=@catalog_item_id, display_name=@display_name, manufacturer_name=@manufacturer_name, material_type=@material_type, diameter_mm=@diameter_mm, color_hex=@color_hex, initial_filament_weight_g=@initial_filament_weight_g, remaining_filament_weight_g=@remaining_filament_weight_g, empty_spool_weight_g=@empty_spool_weight_g, purchase_date=@purchase_date, opened_at=@opened_at, status=@status, storage_location=@storage_location, notes=@notes, active_tag_id=@active_tag_id where id=@id`;

const NFC_INSERT_SQL = `insert into nfc_tags(id, created_at, updated_at, deleted_at, version, tag_uid_hash, format, payload_version, assigned_spool_id, instance_id, public_key_id, last_written_at, last_read_at, write_count, status, last_payload_hash)
values(@id, @created_at, @updated_at, @deleted_at, @version, @tag_uid_hash, @format, @payload_version, @assigned_spool_id, @instance_id, @public_key_id, @last_written_at, @last_read_at, @write_count, @status, @last_payload_hash)`;

const NFC_UPDATE_SQL = `update nfc_tags set created_at=@created_at, updated_at=@updated_at, deleted_at=@deleted_at, version=@version, tag_uid_hash=@tag_uid_hash, format=@format, payload_version=@payload_version, assigned_spool_id=@assigned_spool_id, instance_id=@instance_id, public_key_id=@public_key_id, last_written_at=@last_written_at, last_read_at=@last_read_at, write_count=@write_count, status=@status, last_payload_hash=@last_payload_hash where id=@id`;

const PRINTER_INSERT_SQL = `insert into printers(id, created_at, updated_at, deleted_at, version, name, manufacturer, model, serial_hash, host, lan_access_code_secret_ref, connection_mode, capability_level, last_seen_at, firmware_version, notes)
values(@id, @created_at, @updated_at, @deleted_at, @version, @name, @manufacturer, @model, @serial_hash, @host, @lan_access_code_secret_ref, @connection_mode, @capability_level, @last_seen_at, @firmware_version, @notes)`;

const PRINTER_UPDATE_SQL = `update printers set created_at=@created_at, updated_at=@updated_at, deleted_at=@deleted_at, version=@version, name=@name, manufacturer=@manufacturer, model=@model, serial_hash=@serial_hash, host=@host, lan_access_code_secret_ref=@lan_access_code_secret_ref, connection_mode=@connection_mode, capability_level=@capability_level, last_seen_at=@last_seen_at, firmware_version=@firmware_version, notes=@notes where id=@id`;

const SLOT_INSERT_SQL = `insert into printer_slots(id, created_at, updated_at, deleted_at, version, printer_id, unit_type, unit_index, slot_index, display_name, mapped_spool_id, detected_material_type, detected_color_hex, detected_remaining_percent, last_detected_at, state)
values(@id, @created_at, @updated_at, @deleted_at, @version, @printer_id, @unit_type, @unit_index, @slot_index, @display_name, @mapped_spool_id, @detected_material_type, @detected_color_hex, @detected_remaining_percent, @last_detected_at, @state)`;

const SLOT_UPDATE_SQL = `update printer_slots set created_at=@created_at, updated_at=@updated_at, deleted_at=@deleted_at, version=@version, printer_id=@printer_id, unit_type=@unit_type, unit_index=@unit_index, slot_index=@slot_index, display_name=@display_name, mapped_spool_id=@mapped_spool_id, detected_material_type=@detected_material_type, detected_color_hex=@detected_color_hex, detected_remaining_percent=@detected_remaining_percent, last_detected_at=@last_detected_at, state=@state where id=@id`;

const SYNC_INSERT_SQL = `insert into sync_events(id, source, source_device_id, entity_type, entity_id, event_type, payload, status, created_at, applied_at, error_message)
values(@id, @source, @source_device_id, @entity_type, @entity_id, @event_type, @payload, @status, @created_at, @applied_at, @error_message)`;

const USAGE_INSERT_SQL = `insert into usage_events(id, spool_id, source, printer_id, printer_slot_id, job_id, delta_weight_g, before_weight_g, after_weight_g, confidence, review_status, notes, created_at, updated_at)
values(@id, @spool_id, @source, @printer_id, @printer_slot_id, @job_id, @delta_weight_g, @before_weight_g, @after_weight_g, @confidence, @review_status, @notes, @created_at, @updated_at)`;

const USAGE_UPDATE_SQL = `update usage_events set spool_id=@spool_id, source=@source, printer_id=@printer_id, printer_slot_id=@printer_slot_id, job_id=@job_id, delta_weight_g=@delta_weight_g, before_weight_g=@before_weight_g, after_weight_g=@after_weight_g, confidence=@confidence, review_status=@review_status, notes=@notes, created_at=@created_at, updated_at=@updated_at where id=@id`;
