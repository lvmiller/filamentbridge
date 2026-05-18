import { z } from 'zod';

export const APP_NAME = 'FilamentBridge';
export const EXPORT_FORMAT = 'filamentbridge-export-v1';
export const NFC_FORMAT = 'filamentbridge-v1';
export const OFFICIAL_RFID_BOUNDARY =
  'FilamentBridge writes only FilamentBridge-owned companion NFC tags. It does not clone, forge, emulate, modify, or bypass official Bambu RFID tags or signatures.';

export const spoolStatuses = ['sealed', 'active', 'loaded', 'drying', 'empty', 'retired', 'lost'] as const;
export type SpoolStatus = (typeof spoolStatuses)[number];

export const tagFormats = ['filamentbridge-v1', 'tigertag-compatible-core', 'unknown'] as const;
export type TagFormat = (typeof tagFormats)[number];

export const nfcTagStatuses = ['blank', 'assigned', 'stale', 'retired', 'invalid', 'foreign'] as const;
export type NfcTagStatus = (typeof nfcTagStatuses)[number];

export const deviceTypes = ['ios', 'web', 'server', 'nfc_reader', 'printer_connector'] as const;
export type DeviceType = (typeof deviceTypes)[number];

export const userRoles = ['owner', 'admin', 'operator', 'viewer'] as const;
export type UserRole = (typeof userRoles)[number];

export const userStatuses = ['active', 'disabled'] as const;
export type UserStatus = (typeof userStatuses)[number];

export const printerManufacturers = ['Bambu Lab'] as const;
export type PrinterManufacturer = (typeof printerManufacturers)[number];

export const printerConnectionModes = ['lan', 'vpn_lan', 'manual'] as const;
export type PrinterConnectionMode = (typeof printerConnectionModes)[number];

export const printerCapabilityLevels = ['supported', 'read_only', 'manual_only', 'unsupported'] as const;
export type PrinterCapabilityLevel = (typeof printerCapabilityLevels)[number];

export const printerSlotUnitTypes = ['ams', 'ams_lite', 'ams_2_pro', 'ams_ht', 'external', 'unknown'] as const;
export type PrinterSlotUnitType = (typeof printerSlotUnitTypes)[number];

export const printerSlotStates = ['empty', 'loaded', 'feeding', 'unavailable', 'unknown'] as const;
export type PrinterSlotState = (typeof printerSlotStates)[number];

export const syncSources = ['ios', 'web', 'server', 'printer', 'import', 'api'] as const;
export type SyncSource = (typeof syncSources)[number];

export const syncStatuses = ['pending', 'applied', 'conflict', 'rejected', 'failed'] as const;
export type SyncStatus = (typeof syncStatuses)[number];

export const usageSources = ['manual', 'printer_job', 'slicer_estimate', 'scale', 'correction'] as const;
export type UsageSource = (typeof usageSources)[number];

export const usageConfidenceLevels = ['user_confirmed', 'estimated', 'inferred', 'unknown'] as const;
export type UsageConfidence = (typeof usageConfidenceLevels)[number];

export const usageReviewStatuses = ['pending', 'approved', 'edited', 'rejected', 'auto_approved'] as const;
export type UsageReviewStatus = (typeof usageReviewStatuses)[number];

export const materialTypes = ['PLA', 'PETG', 'ABS', 'ASA', 'TPU', 'PA', 'PC', 'PVA', 'SUPPORT', 'OTHER'] as const;
export type MaterialType = (typeof materialTypes)[number];

const idSchema = z.string().min(3).max(128);
const isoDateTimeSchema = z.string().datetime({ offset: true });
const optionalIsoDateSchema = z.string().min(4).max(32).nullable();
const colorHexSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const nullableStringSchema = z.string().max(4096).nullable();
const gramsSchema = z.number().int().min(0).max(1_000_000);
const versionSchema = z.number().int().min(1);
const jsonRecordSchema = z.record(z.unknown());
const mqttDeviceIdSchema = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/, 'device id cannot contain MQTT topic separators or wildcards');
const lanAccessCodeInputSchema = z.string().trim().max(128);
const optionalMoneyAmountSchema = z.number().nonnegative().max(1_000_000).nullable();
const shortCodeSchema = z.string().trim().min(3).max(32).regex(/^[A-Z0-9][A-Z0-9_-]*$/i, 'short code may contain letters, numbers, dashes, and underscores');

export const entitySchema = z.object({
  id: idSchema,
  created_at: isoDateTimeSchema,
  updated_at: isoDateTimeSchema,
  deleted_at: isoDateTimeSchema.nullable(),
  version: versionSchema
});
export type Entity = z.infer<typeof entitySchema>;

export const filamentCatalogItemSchema = entitySchema.extend({
  brand: z.string().min(1).max(120),
  product_line: z.string().min(1).max(160),
  material_type: z.enum(materialTypes),
  diameter_mm: z.number().positive().max(5),
  color_name: z.string().min(1).max(120),
  color_hex: colorHexSchema,
  nozzle_temp_min_c: z.number().int().min(0).max(400),
  nozzle_temp_max_c: z.number().int().min(0).max(400),
  bed_temp_min_c: z.number().int().min(0).max(200),
  bed_temp_max_c: z.number().int().min(0).max(200),
  drying_temp_c: z.number().int().min(0).max(120),
  drying_time_minutes: z.number().int().min(0).max(10_080),
  density_g_cm3: z.number().positive().max(10),
  bambu_studio_preset_name: z.string().max(240).nullable(),
  orca_slicer_preset_name: z.string().max(240).nullable(),
  vendor_sku: z.string().max(240).nullable(),
  max_volumetric_speed_mm3_s: z.number().positive().max(1000).nullable(),
  flow_ratio: z.number().positive().max(3).nullable(),
  pressure_advance: z.number().min(0).max(10).nullable(),
  shrinkage_xy_percent: z.number().min(-100).max(100).nullable(),
  shrinkage_z_percent: z.number().min(-100).max(100).nullable(),
  softening_temp_c: z.number().int().min(0).max(400).nullable(),
  required_nozzle_hrc: z.number().min(0).max(100).nullable(),
  soluble: z.boolean().nullable(),
  support_material: z.boolean().nullable(),
  notes: nullableStringSchema
});
export type FilamentCatalogItem = z.infer<typeof filamentCatalogItemSchema>;

export const createCatalogItemSchema = filamentCatalogItemSchema.omit({
  id: true,
  created_at: true,
  updated_at: true,
  deleted_at: true,
  version: true
}).extend({
  max_volumetric_speed_mm3_s: z.number().positive().max(1000).nullable().optional().default(null),
  flow_ratio: z.number().positive().max(3).nullable().optional().default(null),
  pressure_advance: z.number().min(0).max(10).nullable().optional().default(null),
  shrinkage_xy_percent: z.number().min(-100).max(100).nullable().optional().default(null),
  shrinkage_z_percent: z.number().min(-100).max(100).nullable().optional().default(null),
  softening_temp_c: z.number().int().min(0).max(400).nullable().optional().default(null),
  required_nozzle_hrc: z.number().min(0).max(100).nullable().optional().default(null),
  soluble: z.boolean().nullable().optional().default(null),
  support_material: z.boolean().nullable().optional().default(null)
});
export type CreateCatalogItemInput = z.infer<typeof createCatalogItemSchema>;

export const patchCatalogItemSchema = createCatalogItemSchema.partial().extend({
  expected_version: versionSchema
});
export type PatchCatalogItemInput = z.infer<typeof patchCatalogItemSchema>;

export const spoolSchema = entitySchema.extend({
  catalog_item_id: idSchema,
  display_name: z.string().min(1).max(200),
  manufacturer_name: z.string().min(1).max(160),
  material_type: z.enum(materialTypes),
  diameter_mm: z.number().positive().max(5),
  color_hex: colorHexSchema,
  initial_filament_weight_g: gramsSchema,
  remaining_filament_weight_g: gramsSchema,
  empty_spool_weight_g: gramsSchema,
  purchase_date: optionalIsoDateSchema,
  opened_at: isoDateTimeSchema.nullable(),
  status: z.enum(spoolStatuses),
  storage_location: z.string().max(240).nullable(),
  notes: nullableStringSchema,
  short_code: shortCodeSchema,
  purchase_price_amount: optionalMoneyAmountSchema,
  purchase_currency: z.string().trim().length(3).toUpperCase().nullable(),
  vendor_lot: z.string().max(120).nullable(),
  active_tag_id: idSchema.nullable()
});
export type Spool = z.infer<typeof spoolSchema>;

export const createSpoolSchema = spoolSchema.omit({
  id: true,
  created_at: true,
  updated_at: true,
  deleted_at: true,
  version: true,
  active_tag_id: true
}).extend({
  short_code: shortCodeSchema.optional(),
  purchase_price_amount: optionalMoneyAmountSchema.optional().default(null),
  purchase_currency: z.string().trim().length(3).toUpperCase().nullable().optional().default(null),
  vendor_lot: z.string().max(120).nullable().optional().default(null)
}).superRefine((value, ctx) => {
  if (value.remaining_filament_weight_g > value.initial_filament_weight_g) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['remaining_filament_weight_g'], message: 'remaining weight cannot exceed initial filament weight' });
  }
});
export type CreateSpoolInput = z.infer<typeof createSpoolSchema>;

export const patchSpoolSchema = spoolSchema.omit({
  id: true,
  created_at: true,
  updated_at: true,
  deleted_at: true,
  version: true,
  active_tag_id: true,
  remaining_filament_weight_g: true
}).partial().extend({
  expected_version: versionSchema
});
export type PatchSpoolInput = z.infer<typeof patchSpoolSchema>;

export const nfcTagSchema = entitySchema.extend({
  tag_uid_hash: z.string().min(16).max(128),
  format: z.enum(tagFormats),
  payload_version: z.number().int().min(0).max(255),
  assigned_spool_id: idSchema.nullable(),
  instance_id: idSchema,
  public_key_id: z.string().min(4).max(128),
  last_written_at: isoDateTimeSchema.nullable(),
  last_read_at: isoDateTimeSchema.nullable(),
  write_count: z.number().int().min(0),
  status: z.enum(nfcTagStatuses),
  last_payload_hash: z.string().min(16).max(128).nullable()
});
export type NfcTag = z.infer<typeof nfcTagSchema>;

export const printerSchema = entitySchema.extend({
  name: z.string().min(1).max(160),
  manufacturer: z.enum(printerManufacturers),
  model: z.string().min(1).max(120),
  serial_hash: z.string().min(16).max(128),
  host: z.string().min(1).max(255),
  lan_access_code_secret_ref: z.string().min(1).max(4096).nullable(),
  connection_mode: z.enum(printerConnectionModes),
  capability_level: z.enum(printerCapabilityLevels),
  last_seen_at: isoDateTimeSchema.nullable(),
  firmware_version: z.string().max(120).nullable(),
  notes: nullableStringSchema
});
export type Printer = z.infer<typeof printerSchema>;

export const createPrinterSchema = printerSchema.omit({
  id: true,
  created_at: true,
  updated_at: true,
  deleted_at: true,
  version: true,
  serial_hash: true,
  lan_access_code_secret_ref: true,
  capability_level: true,
  last_seen_at: true
}).extend({
  serial: z.string().min(1).max(255),
  device_id: mqttDeviceIdSchema.optional().nullable().default(null),
  lan_access_code: lanAccessCodeInputSchema.nullable().default(null)
});
export type CreatePrinterInput = z.infer<typeof createPrinterSchema>;

export const patchPrinterSchema = createPrinterSchema.partial().extend({
  expected_version: versionSchema
});
export type PatchPrinterInput = z.infer<typeof patchPrinterSchema>;

export const printerSlotSchema = entitySchema.extend({
  printer_id: idSchema,
  unit_type: z.enum(printerSlotUnitTypes),
  unit_index: z.number().int().min(0).max(64),
  slot_index: z.number().int().min(0).max(256),
  display_name: z.string().min(1).max(160),
  mapped_spool_id: idSchema.nullable(),
  detected_material_type: z.enum(materialTypes).nullable(),
  detected_color_hex: colorHexSchema.nullable(),
  detected_remaining_percent: z.number().int().min(0).max(100).nullable(),
  last_detected_at: isoDateTimeSchema.nullable(),
  state: z.enum(printerSlotStates)
});
export type PrinterSlot = z.infer<typeof printerSlotSchema>;

export const mapPrinterSlotSchema = z.object({
  mapped_spool_id: idSchema.nullable(),
  expected_version: versionSchema
});
export type MapPrinterSlotInput = z.infer<typeof mapPrinterSlotSchema>;

export const syncEventSchema = z.object({
  id: idSchema,
  source: z.enum(syncSources),
  source_device_id: idSchema.nullable(),
  entity_type: z.string().min(1).max(80),
  entity_id: idSchema,
  event_type: z.string().min(1).max(120),
  payload: jsonRecordSchema,
  status: z.enum(syncStatuses),
  created_at: isoDateTimeSchema,
  applied_at: isoDateTimeSchema.nullable(),
  error_message: z.string().max(2000).nullable()
});
export type SyncEvent = z.infer<typeof syncEventSchema>;

export const submitSyncEventsSchema = z.object({
  device_id: idSchema,
  events: z.array(z.object({
    id: idSchema,
    entity_type: z.string().min(1).max(80),
    entity_id: idSchema,
    event_type: z.string().min(1).max(120),
    entity_version: z.number().int().min(0),
    local_created_at: isoDateTimeSchema,
    payload: jsonRecordSchema
  })).min(1).max(200)
});
export type SubmitSyncEventsInput = z.infer<typeof submitSyncEventsSchema>;

export type SyncSubmissionResult = {
  applied: SyncEvent[];
  rejected: Array<{ id: string; reason: string }>;
  conflicts: Array<{ id: string; reason: string; server_entity: unknown }>;
};

export const usageEventSchema = z.object({
  id: idSchema,
  spool_id: idSchema,
  source: z.enum(usageSources),
  printer_id: idSchema.nullable(),
  printer_slot_id: idSchema.nullable(),
  job_id: z.string().max(240).nullable(),
  delta_weight_g: z.number().int().min(-1_000_000).max(1_000_000),
  before_weight_g: gramsSchema,
  after_weight_g: gramsSchema,
  confidence: z.enum(usageConfidenceLevels),
  review_status: z.enum(usageReviewStatuses),
  notes: nullableStringSchema,
  estimated_material_cost_amount: optionalMoneyAmountSchema,
  estimated_material_cost_currency: z.string().trim().length(3).toUpperCase().nullable(),
  created_at: isoDateTimeSchema,
  updated_at: isoDateTimeSchema
});
export type UsageEvent = z.infer<typeof usageEventSchema>;

export const manualAdjustmentSchema = z.object({
  spool_id: idSchema,
  expected_version: versionSchema,
  new_remaining_weight_g: gramsSchema,
  notes: z.string().max(2000).nullable().default(null)
});
export type ManualAdjustmentInput = z.infer<typeof manualAdjustmentSchema>;

export const approveUsageEventSchema = z.object({
  expected_spool_version: versionSchema.optional()
});
export type ApproveUsageEventInput = z.infer<typeof approveUsageEventSchema>;

export const editUsageEventSchema = z.object({
  delta_weight_g: z.number().int().min(-1_000_000).max(1_000_000),
  notes: z.string().max(2000).nullable().default(null),
  expected_spool_version: versionSchema.optional()
});
export type EditUsageEventInput = z.infer<typeof editUsageEventSchema>;

export const userSchema = z.object({
  id: idSchema,
  email: z.string().email(),
  display_name: z.string().min(1).max(160),
  role: z.enum(userRoles),
  last_login_at: isoDateTimeSchema.nullable(),
  status: z.enum(userStatuses),
  created_at: isoDateTimeSchema,
  updated_at: isoDateTimeSchema
});
export type User = z.infer<typeof userSchema>;

export const setupOwnerSchema = z.object({
  email: z.string().email(),
  display_name: z.string().min(1).max(160),
  password: z.string().min(12).max(256)
});
export type SetupOwnerInput = z.infer<typeof setupOwnerSchema>;

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(256),
  device_name: z.string().min(1).max(160).default('Web browser')
});
export type LoginInput = z.infer<typeof loginSchema>;

export const deviceSchema = z.object({
  id: idSchema,
  user_id: idSchema,
  device_type: z.enum(deviceTypes),
  name: z.string().min(1).max(160),
  paired_at: isoDateTimeSchema,
  last_seen_at: isoDateTimeSchema.nullable(),
  trusted: z.boolean(),
  revoked_at: isoDateTimeSchema.nullable()
});
export type Device = z.infer<typeof deviceSchema>;

export const startPairingSchema = z.object({
  device_name: z.string().min(1).max(160),
  device_type: z.enum(deviceTypes).default('ios')
});
export type StartPairingInput = z.infer<typeof startPairingSchema>;

export const completePairingSchema = z.object({
  pairing_code: z.string().min(6).max(64),
  device_name: z.string().min(1).max(160),
  device_type: z.enum(deviceTypes).default('ios')
});
export type CompletePairingInput = z.infer<typeof completePairingSchema>;

export const nfcAssignSchema = z.object({
  spool_id: idSchema,
  tag_uid: z.string().min(1).max(256),
  expected_spool_version: versionSchema
});
export type NfcAssignInput = z.infer<typeof nfcAssignSchema>;

export const nfcWritePayloadSchema = z.object({
  tag_id: idSchema,
  spool_id: idSchema,
  expected_spool_version: versionSchema,
  force_stale_rewrite: z.boolean().default(false)
});
export type NfcWritePayloadInput = z.infer<typeof nfcWritePayloadSchema>;

export const nfcScanSchema = z.object({
  tag_uid: z.string().min(1).max(256).nullable().default(null),
  tag_uid_hash: z.string().min(16).max(128).nullable().default(null),
  encoded_payload: z.string().min(1).max(4096).nullable().default(null),
  payload_hash: z.string().min(8).max(128).nullable().default(null),
  scanned_at: isoDateTimeSchema.optional()
});
export type NfcScanInput = z.infer<typeof nfcScanSchema>;

export const nfcVerifySchema = z.object({
  encoded_payload: z.string().min(1).max(4096)
});
export type NfcVerifyInput = z.infer<typeof nfcVerifySchema>;

export const nfcRetireSchema = z.object({
  tag_id: idSchema,
  expected_version: versionSchema
});
export type NfcRetireInput = z.infer<typeof nfcRetireSchema>;

export const catalogImportSchema = z.object({
  items: z.array(createCatalogItemSchema).max(5000)
});
export type CatalogImportInput = z.infer<typeof catalogImportSchema>;

export const labelTemplateSchema = entitySchema.extend({
  name: z.string().min(1).max(120),
  medium: z.enum(['sheet', 'roll', 'thermal', 'custom']),
  page_width_mm: z.number().positive().max(1000),
  page_height_mm: z.number().positive().max(1000),
  label_width_mm: z.number().positive().max(300),
  label_height_mm: z.number().positive().max(300),
  rows: z.number().int().min(1).max(100),
  columns: z.number().int().min(1).max(100),
  code_type: z.enum(['qr', 'barcode', 'none']),
  template_text: z.string().min(1).max(2000),
  included_fields: z.array(z.enum(['short_code', 'display_name', 'material_type', 'color_hex', 'remaining_filament_weight_g', 'storage_location', 'vendor_lot'])).min(1).max(20),
  created_by_user_id: idSchema,
  last_used_at: isoDateTimeSchema.nullable()
});
export type LabelTemplate = z.infer<typeof labelTemplateSchema>;

export const createLabelTemplateSchema = labelTemplateSchema.omit({
  id: true,
  created_at: true,
  updated_at: true,
  deleted_at: true,
  version: true,
  last_used_at: true,
  created_by_user_id: true,
});
export type CreateLabelTemplateInput = z.infer<typeof createLabelTemplateSchema>;

export const patchLabelTemplateSchema = createLabelTemplateSchema.partial().extend({
  expected_version: versionSchema
});
export type PatchLabelTemplateInput = z.infer<typeof patchLabelTemplateSchema>;

export const renderLabelsSchema = z.object({
  template_id: idSchema,
  spool_ids: z.array(idSchema).min(1).max(100),
  base_url: z.string().url().max(500).nullable().optional().default(null)
});
export type RenderLabelsInput = z.infer<typeof renderLabelsSchema>;

export type RenderedLabels = {
  mime_type: 'image/svg+xml';
  filename: string;
  svg: string;
};


export const exportFileSchema = z.object({
  format: z.literal(EXPORT_FORMAT),
  exported_at: isoDateTimeSchema,
  instance_id: idSchema,
  catalog_items: z.array(filamentCatalogItemSchema),
  spools: z.array(spoolSchema),
  nfc_tags: z.array(nfcTagSchema),
  printers: z.array(printerSchema),
  printer_slots: z.array(printerSlotSchema),
  usage_events: z.array(usageEventSchema),
  label_templates: z.array(labelTemplateSchema).default([])
});
export type FilamentBridgeExport = z.infer<typeof exportFileSchema>;

export type ApiEnvelope<T> = { data: T };
export type ApiError = { error: { code: string; message: string; details?: unknown } };

export type AuthSession = {
  token: string;
  user: User;
  device: Device;
};

export type SetupStatus = {
  configured: boolean;
  instance_id: string | null;
  boundary: string;
};

export type NfcScanResult = {
  classification: 'blank' | 'app_owned_valid' | 'app_owned_stale' | 'foreign' | 'invalid_signature' | 'retired';
  tag: NfcTag | null;
  spool: Spool | null;
  decoded: DecodedNfcPayload | null;
  message: string;
};

export type NfcWritePayloadResult = {
  tag: NfcTag;
  spool: Spool;
  encoded_payload: string;
  payload_hash: string;
  public_key_id: string;
  write_count: number;
  boundary: string;
};

export type TestConnectionResult = {
  capability_level: PrinterCapabilityLevel;
  ok: boolean;
  reason: string | null;
  observed_slots: Array<Pick<PrinterSlot, 'unit_type' | 'unit_index' | 'slot_index' | 'display_name' | 'state'>>;
};

export type BackupResult = {
  path: string;
  includes_database: boolean;
  includes_signing_keys: boolean;
  created_at: string;
};

export function nowIso(): string {
  return new Date().toISOString();
}

export function assertSpoolWeightInvariant(input: Pick<Spool, 'initial_filament_weight_g' | 'remaining_filament_weight_g' | 'empty_spool_weight_g'>): void {
  if (input.remaining_filament_weight_g > input.initial_filament_weight_g) {
    throw new Error('remaining filament weight cannot exceed initial filament weight');
  }
  if (input.empty_spool_weight_g < 0) {
    throw new Error('empty spool weight cannot be negative');
  }
}

export function applyWeightDelta(currentRemainingWeightG: number, deltaWeightG: number): number {
  const next = currentRemainingWeightG + deltaWeightG;
  if (!Number.isInteger(next) || next < 0) {
    throw new Error('weight change would make remaining filament negative');
  }
  return next;
}

export function materialTypeFromUnknown(value: string): MaterialType {
  const normalized = value.trim().toUpperCase();
  return (materialTypes as readonly string[]).includes(normalized) ? (normalized as MaterialType) : 'OTHER';
}

export const NFC_PAYLOAD_BYTES = 144;
export const NFC_SIGNATURE_OFFSET = 69;
export const NFC_SIGNATURE_LENGTH = 64;
export const NFC_PAYLOAD_HASH_OFFSET = 53;
export const NFC_PAYLOAD_HASH_LENGTH = 16;
export const NFC_PUBLIC_KEY_ID_OFFSET = 45;
export const NFC_PUBLIC_KEY_ID_LENGTH = 8;
export const NFC_SIGNING_LENGTH = NFC_SIGNATURE_OFFSET;

const NFC_MAGIC_0 = 0x46;
const NFC_MAGIC_1 = 0x42;
const NFC_VERSION = 1;
const NFC_LAYOUT = 1;

export const materialCodes: Record<MaterialType, number> = {
  PLA: 1,
  PETG: 2,
  ABS: 3,
  ASA: 4,
  TPU: 5,
  PA: 6,
  PC: 7,
  PVA: 8,
  SUPPORT: 9,
  OTHER: 255
};

const materialByCode = new Map<number, MaterialType>(Object.entries(materialCodes).map(([key, value]) => [value, key as MaterialType]));

export type UnsignedNfcPayloadInput = {
  instance_id: string;
  tag_id: string;
  spool_id: string;
  material_type: MaterialType;
  diameter_mm: number;
  color_hex: string;
  remaining_weight_g: number;
  nozzle_temp_min_c: number;
  nozzle_temp_max_c: number;
  drying_temp_c: number;
  drying_time_minutes: number;
  written_at_epoch_seconds: number;
  public_key_id: string;
};

export type SignedNfcPayloadInput = UnsignedNfcPayloadInput & {
  payload_hash: Uint8Array;
  signature: Uint8Array;
};

export type DecodedNfcPayload = {
  version: number;
  layout: number;
  instance_ref: string;
  tag_ref: string;
  spool_ref: string;
  material_type: MaterialType;
  diameter_mm: number;
  color_hex: string;
  remaining_weight_g: number;
  nozzle_temp_min_c: number;
  nozzle_temp_max_c: number;
  drying_temp_c: number;
  drying_time_minutes: number;
  written_at_epoch_seconds: number;
  public_key_id_ref: string;
  payload_hash: string;
  signature: string;
  reserved_non_zero: boolean;
};

export function compactRefBytes(value: string, length = 8): Uint8Array {
  if (length <= 0 || length > 32) {
    throw new Error('compact reference length must be between 1 and 32');
  }
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * prime);
  }
  const out = new Uint8Array(length);
  let cursor = hash;
  for (let index = 0; index < length; index += 1) {
    out[index] = Number(cursor & 0xffn);
    cursor >>= 8n;
    if (cursor === 0n) {
      cursor = BigInt.asUintN(64, hash ^ BigInt(index + 1));
    }
  }
  return out;
}

export function createUnsignedNfcPayload(input: UnsignedNfcPayloadInput): Uint8Array {
  const bytes = new Uint8Array(NFC_PAYLOAD_BYTES);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  bytes[0] = NFC_MAGIC_0;
  bytes[1] = NFC_MAGIC_1;
  bytes[2] = NFC_VERSION;
  bytes[3] = NFC_LAYOUT;
  bytes.set(compactRefBytes(input.instance_id), 4);
  bytes.set(compactRefBytes(input.tag_id), 12);
  bytes.set(compactRefBytes(input.spool_id), 20);
  bytes[28] = materialCodes[input.material_type] ?? materialCodes.OTHER;
  view.setUint16(29, Math.round(input.diameter_mm * 100), true);
  bytes.set(colorHexToRgb(input.color_hex), 31);
  view.setUint16(34, clampUInt16(input.remaining_weight_g), true);
  bytes[36] = clampUInt8(input.nozzle_temp_min_c);
  bytes[37] = clampUInt8(input.nozzle_temp_max_c);
  bytes[38] = clampUInt8(input.drying_temp_c);
  view.setUint16(39, clampUInt16(input.drying_time_minutes), true);
  view.setUint32(41, clampUInt32(input.written_at_epoch_seconds), true);
  bytes.set(compactRefBytes(input.public_key_id), NFC_PUBLIC_KEY_ID_OFFSET);
  return bytes;
}

export function finalizeNfcPayload(unsignedPayload: Uint8Array, payloadHash: Uint8Array, signature: Uint8Array): Uint8Array {
  if (unsignedPayload.byteLength !== NFC_PAYLOAD_BYTES) {
    throw new Error(`NFC payload must be ${NFC_PAYLOAD_BYTES} bytes`);
  }
  if (payloadHash.byteLength !== NFC_PAYLOAD_HASH_LENGTH) {
    throw new Error(`payload hash must be ${NFC_PAYLOAD_HASH_LENGTH} bytes`);
  }
  if (signature.byteLength !== NFC_SIGNATURE_LENGTH) {
    throw new Error(`signature must be ${NFC_SIGNATURE_LENGTH} bytes`);
  }
  const out = new Uint8Array(unsignedPayload);
  out.set(payloadHash, NFC_PAYLOAD_HASH_OFFSET);
  out.set(signature, NFC_SIGNATURE_OFFSET);
  return out;
}

export function createSignedNfcPayload(input: SignedNfcPayloadInput): Uint8Array {
  return finalizeNfcPayload(createUnsignedNfcPayload(input), input.payload_hash, input.signature);
}

export function nfcSigningBytes(payload: Uint8Array): Uint8Array {
  if (payload.byteLength !== NFC_PAYLOAD_BYTES) {
    throw new Error(`NFC payload must be ${NFC_PAYLOAD_BYTES} bytes`);
  }
  return payload.slice(0, NFC_SIGNING_LENGTH);
}

export function decodeNfcPayload(payload: Uint8Array): DecodedNfcPayload {
  if (payload.byteLength !== NFC_PAYLOAD_BYTES) {
    throw new Error(`NFC payload must be ${NFC_PAYLOAD_BYTES} bytes`);
  }
  if (payload[0] !== NFC_MAGIC_0 || payload[1] !== NFC_MAGIC_1) {
    throw new Error('not a FilamentBridge NFC payload');
  }
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const materialCode = payload[28] ?? materialCodes.OTHER;
  const reserved = payload.slice(NFC_SIGNATURE_OFFSET + NFC_SIGNATURE_LENGTH);
  return {
    version: payload[2] ?? 0,
    layout: payload[3] ?? 0,
    instance_ref: bytesToHex(payload.slice(4, 12)),
    tag_ref: bytesToHex(payload.slice(12, 20)),
    spool_ref: bytesToHex(payload.slice(20, 28)),
    material_type: materialByCode.get(materialCode) ?? 'OTHER',
    diameter_mm: view.getUint16(29, true) / 100,
    color_hex: rgbToColorHex(payload[31] ?? 0, payload[32] ?? 0, payload[33] ?? 0),
    remaining_weight_g: view.getUint16(34, true),
    nozzle_temp_min_c: payload[36] ?? 0,
    nozzle_temp_max_c: payload[37] ?? 0,
    drying_temp_c: payload[38] ?? 0,
    drying_time_minutes: view.getUint16(39, true),
    written_at_epoch_seconds: view.getUint32(41, true),
    public_key_id_ref: bytesToHex(payload.slice(NFC_PUBLIC_KEY_ID_OFFSET, NFC_PUBLIC_KEY_ID_OFFSET + NFC_PUBLIC_KEY_ID_LENGTH)),
    payload_hash: bytesToHex(payload.slice(NFC_PAYLOAD_HASH_OFFSET, NFC_PAYLOAD_HASH_OFFSET + NFC_PAYLOAD_HASH_LENGTH)),
    signature: bytesToHex(payload.slice(NFC_SIGNATURE_OFFSET, NFC_SIGNATURE_OFFSET + NFC_SIGNATURE_LENGTH)),
    reserved_non_zero: reserved.some((value) => value !== 0)
  };
}

export function classifyRawNfcPayload(payload: Uint8Array | null): 'blank' | 'filamentbridge' | 'foreign' | 'invalid' {
  if (payload === null || payload.byteLength === 0 || payload.every((byte) => byte === 0)) {
    return 'blank';
  }
  if (payload.byteLength !== NFC_PAYLOAD_BYTES) {
    return 'foreign';
  }
  if (payload[0] === NFC_MAGIC_0 && payload[1] === NFC_MAGIC_1) {
    return payload[2] === NFC_VERSION && payload[3] === NFC_LAYOUT ? 'filamentbridge' : 'invalid';
  }
  return 'foreign';
}

export function encodePayloadBase64Url(payload: Uint8Array): string {
  return bytesToBase64Url(payload);
}

export function decodePayloadBase64Url(encoded: string): Uint8Array {
  return base64UrlToBytes(encoded);
}

export function colorHexToRgb(colorHex: string): Uint8Array {
  const parsed = colorHexSchema.parse(colorHex);
  return new Uint8Array([
    Number.parseInt(parsed.slice(1, 3), 16),
    Number.parseInt(parsed.slice(3, 5), 16),
    Number.parseInt(parsed.slice(5, 7), 16)
  ]);
}

export function rgbToColorHex(red: number, green: number, blue: number): string {
  return `#${toHexByte(red)}${toHexByte(green)}${toHexByte(blue)}`;
}

export function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) {
    out += toHexByte(byte);
  }
  return out;
}

export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0 || /[^0-9a-fA-F]/.test(hex)) {
    throw new Error('invalid hex string');
  }
  const out = new Uint8Array(hex.length / 2);
  for (let index = 0; index < out.length; index += 1) {
    out[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return out;
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
  const base64 = typeof Buffer !== 'undefined'
    ? Buffer.from(bytes).toString('base64')
    : btoa(binary);
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function base64UrlToBytes(encoded: string): Uint8Array {
  const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(padded, 'base64'));
  }
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    out[index] = binary.charCodeAt(index);
  }
  return out;
}

function toHexByte(value: number): string {
  return clampUInt8(value).toString(16).padStart(2, '0');
}

function clampUInt8(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(255, Math.max(0, Math.round(value)));
}

function clampUInt16(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(65_535, Math.max(0, Math.round(value)));
}

function clampUInt32(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(4_294_967_295, Math.max(0, Math.round(value)));
}

export class FilamentBridgeClient {
  private readonly baseUrl: string;
  private token: string | null;

  constructor(baseUrl = '', token: string | null = null) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.token = token;
  }

  setToken(token: string | null): void {
    this.token = token;
  }

  async get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  async patch<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PATCH', path, body);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    if (this.token !== null) {
      headers.Authorization = `Bearer ${this.token}`;
    }
    const init: RequestInit = {
      method,
      headers,
      credentials: 'include'
    };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }
    const response = await fetch(`${this.baseUrl}${path}`, init);
    const contentType = response.headers.get('content-type') ?? '';
    const payload = contentType.includes('application/json') ? await response.json() : await response.text();
    if (!response.ok) {
      const message = typeof payload === 'object' && payload !== null && 'error' in payload
        ? String((payload as ApiError).error.message)
        : `HTTP ${response.status}`;
      throw new Error(message);
    }
    return (typeof payload === 'object' && payload !== null && 'data' in payload ? (payload as ApiEnvelope<T>).data : payload) as T;
  }
}
