import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import bcrypt from 'bcryptjs';
import QRCode from 'qrcode';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { ZodError, type ZodTypeAny } from 'zod';
import {
  OFFICIAL_RFID_BOUNDARY,
  approveUsageEventSchema,
  catalogImportSchema,
  classifyRawNfcPayload,
  completePairingSchema,
  createCatalogItemSchema,
  createLabelTemplateSchema,
  createPrinterSchema,
  createSpoolSchema,
  decodePayloadBase64Url,
  editUsageEventSchema,
  encodePayloadBase64Url,
  exportFileSchema,
  renderLabelsSchema,
  loginSchema,
  manualAdjustmentSchema,
  mapPrinterSlotSchema,
  nfcAssignSchema,
  nfcRetireSchema,
  nfcScanSchema,
  nfcVerifySchema,
  nfcWritePayloadSchema,
  nowIso,
  patchCatalogItemSchema,
  patchPrinterSchema,
  patchLabelTemplateSchema,
  patchSpoolSchema,
  setupOwnerSchema,
  startPairingSchema,
  submitSyncEventsSchema,
  type AuthSession,
  type BackupResult,
  type CreateCatalogItemInput,
  type CreatePrinterInput,
  type CreateSpoolInput,
  type CreateLabelTemplateInput,
  type FilamentBridgeExport,
  type NfcScanResult,
  type NfcWritePayloadResult,
  type PrinterSlot,
  type LabelTemplate,
  type Spool,
  type SetupStatus,
  type SyncSubmissionResult,
  type TestConnectionResult,
  type RenderedLabels,
  type UsageReviewStatus
} from '../../../packages/shared/src/index';
import {
  RepositoryError,
  type FilamentBridgeRepository,
  openFilamentBridgeDatabase
} from '../../../packages/db/src/index';
import {
  createSecretKey,
  hashPrinterSerial,
  hashTagUid,
  loadOrCreateSigningKeyStore,
  safeToken,
  saveSigningKeyStore,
  sha256Hex,
  signNfcPayload,
  verifyNfcPayload,
  activeSigningIdentity,
  decryptSecret,
  encryptSecret,
  type SecretBox,
  type SigningKeyStore
} from '../../../packages/crypto/src/index';
import { BambuLanMqttConnector, BambuMqttConnectionServer, ManualMockBambuConnector, capabilityForModel, type BambuLanMqttCredentials, type PrinterConnector } from '../../../packages/printer-connector/src/index';

export type ServerConfig = {
  databasePath: string;
  keyDirectory: string;
  backupDirectory: string;
  webDistPath: string;
  appSecret: string;
  host: string;
  port: number;
  allowedOrigins: string[];
  bambuMqttAllowInsecureTls: boolean;
  printerConnectorEnabled: boolean;
};

export type CreateAppOptions = Partial<ServerConfig> & {
  repo?: FilamentBridgeRepository;
  signingKeyStore?: SigningKeyStore;
  connector?: PrinterConnector;
  logger?: boolean;
};

type AuthContext = {
  token_hash: string;
  session: { id: string; user_id: string; device_id: string };
  user: AuthSession['user'];
  device: AuthSession['device'];
};

type AuthedRequest = FastifyRequest & { auth: AuthContext };

const DEFAULT_DATA_DIR = resolve(process.env.FILAMENTBRIDGE_DATA_DIR ?? './runtime');

export function loadConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  const databasePath = overrides.databasePath ?? process.env.FILAMENTBRIDGE_DATABASE_PATH ?? join(DEFAULT_DATA_DIR, 'filamentbridge.sqlite');
  const keyDirectory = overrides.keyDirectory ?? process.env.FILAMENTBRIDGE_KEY_DIR ?? join(DEFAULT_DATA_DIR, 'keys');
  const backupDirectory = overrides.backupDirectory ?? process.env.FILAMENTBRIDGE_BACKUP_DIR ?? join(DEFAULT_DATA_DIR, 'backups');
  return {
    databasePath,
    keyDirectory,
    backupDirectory,
    webDistPath: overrides.webDistPath ?? process.env.FILAMENTBRIDGE_WEB_DIST ?? resolve('apps/web/dist'),
    appSecret: overrides.appSecret ?? process.env.FILAMENTBRIDGE_APP_SECRET ?? 'dev-only-change-me',
    host: overrides.host ?? process.env.FILAMENTBRIDGE_HOST ?? '0.0.0.0',
    port: overrides.port ?? Number(process.env.PORT ?? process.env.FILAMENTBRIDGE_PORT ?? 3000),
    allowedOrigins: overrides.allowedOrigins ?? (process.env.FILAMENTBRIDGE_ALLOWED_ORIGINS?.split(',').map((origin) => origin.trim()).filter(Boolean) ?? ['http://localhost:5173']),
    bambuMqttAllowInsecureTls: overrides.bambuMqttAllowInsecureTls ?? process.env.FILAMENTBRIDGE_BAMBU_MQTT_INSECURE_TLS === 'true',
    printerConnectorEnabled: overrides.printerConnectorEnabled ?? process.env.FILAMENTBRIDGE_PRINTER_CONNECTOR_ENABLED !== 'false'
  };
}

export async function createApp(options: CreateAppOptions = {}): Promise<FastifyInstance> {
  const config = loadConfig(options);
  mkdirSync(dirname(config.databasePath), { recursive: true });
  mkdirSync(config.keyDirectory, { recursive: true });
  mkdirSync(config.backupDirectory, { recursive: true });

  const repo = options.repo ?? openFilamentBridgeDatabase({ path: config.databasePath });
  const signingKeyStore = options.signingKeyStore ?? loadOrCreateSigningKeyStore(config.keyDirectory, repo.getInstanceId() ?? undefined);
  if (repo.getInstanceId() === null) {
    repo.setInstanceId(signingKeyStore.instance_id);
  }
  const secretKey = createSecretKey(config.appSecret);
  const connector: PrinterConnector = options.connector ?? (config.printerConnectorEnabled
    ? new BambuLanMqttConnector({
      fallback: new ManualMockBambuConnector(),
      resolveCredentials: (printer) => resolveBambuLanMqttCredentials(printer.lan_access_code_secret_ref, secretKey, config.bambuMqttAllowInsecureTls),
      snapshot_source: new BambuMqttConnectionServer(),
    })
    : new ManualMockBambuConnector());
  const salt = repo.getMeta('hash_salt') ?? safeToken(24);
  repo.setMetaIfMissing('hash_salt', salt);

  const app = Fastify({ logger: options.logger ?? false });
  app.addHook('onClose', async () => {
    await connector.stop?.();
  });
  await app.register(cookie, { secret: config.appSecret });
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'FilamentBridge API',
        version: '0.1.0',
        description: OFFICIAL_RFID_BOUNDARY
      }
    }
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });

  app.addHook('onRequest', async (request, reply) => {
    if (request.method === 'OPTIONS') {
      applyCors(request, reply, config.allowedOrigins);
      return reply.send();
    }
    applyCors(request, reply, config.allowedOrigins);
  });

  app.decorateRequest('auth', null);
  app.addHook('preHandler', async (request, reply) => {
    if (isPublicRoute(request)) {
      return;
    }
    const auth = authenticateRequest(request, repo);
    if (auth === null) {
      return reply.code(401).send(errorEnvelope('unauthorized', 'authentication required'));
    }
    (request as AuthedRequest).auth = auth;
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send(errorEnvelope('bad_request', 'request validation failed', error.flatten()));
    }
    if (error instanceof RepositoryError) {
      const status = error.code === 'not_found' ? 404 : error.code === 'conflict' ? 409 : error.code === 'unauthorized' ? 401 : 400;
      return reply.code(status).send(errorEnvelope(error.code, error.message));
    }
    app.log.error(error);
    return reply.code(500).send(errorEnvelope('internal_error', 'internal server error'));
  });

  app.get('/health', async () => ({ data: { ok: true, configured: repo.ownerExists(), boundary: OFFICIAL_RFID_BOUNDARY } }));

  app.get('/api/setup/status', async (): Promise<{ data: SetupStatus }> => ({
    data: { configured: repo.ownerExists(), instance_id: repo.getInstanceId(), boundary: OFFICIAL_RFID_BOUNDARY }
  }));

  app.post('/api/setup/owner', async (request, reply) => {
    if (repo.ownerExists()) {
      return reply.code(409).send(errorEnvelope('conflict', 'owner account already exists'));
    }
    const input = parseBody(setupOwnerSchema, request.body);
    const passwordHash = await bcrypt.hash(input.password, 12);
    const user = repo.createUser({ email: input.email, display_name: input.display_name, password_hash: passwordHash, role: 'owner' });
    const device = repo.createDevice(user.id, 'web', 'First-run browser', true);
    const token = safeToken(32);
    repo.createSession(user.id, device.id, sha256Hex(token), null);
    repo.touchUserLogin(user.id);
    setSessionCookie(reply, token);
    return { data: { token, user: repo.getUser(user.id), device } satisfies AuthSession };
  });

  app.post('/api/auth/login', async (request, reply) => {
    const input = parseBody(loginSchema, request.body);
    const user = repo.findUserByEmail(input.email);
    if (user === null || !(await bcrypt.compare(input.password, user.password_hash))) {
      return reply.code(401).send(errorEnvelope('unauthorized', 'invalid email or password'));
    }
    const device = repo.createDevice(user.id, 'web', input.device_name, true);
    const token = safeToken(32);
    repo.createSession(user.id, device.id, sha256Hex(token), null);
    repo.touchUserLogin(user.id);
    setSessionCookie(reply, token);
    return { data: { token, user: repo.getUser(user.id), device } satisfies AuthSession };
  });

  app.post('/api/auth/logout', async (request, reply) => {
    const token = bearerOrCookieToken(request);
    if (token !== null) {
      repo.revokeSessionByTokenHash(sha256Hex(token));
    }
    reply.clearCookie('fb_session', { path: '/' });
    return { data: { ok: true } };
  });

  app.get('/api/auth/me', async (request) => ({ data: { user: (request as AuthedRequest).auth.user, device: (request as AuthedRequest).auth.device } }));

  app.post('/api/devices/pairing/start', async (request) => {
    const input = parseBody(startPairingSchema, request.body);
    const user = (request as AuthedRequest).auth.user;
    const pairingCode = safePairingCode();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    repo.createPairingCode({
      user_id: user.id,
      pairing_code_hash: sha256Hex(pairingCode),
      device_name: input.device_name,
      device_type: input.device_type,
      expires_at: expiresAt
    });
    return { data: { pairing_code: pairingCode, expires_at: expiresAt, server_time: nowIso() } };
  });

  app.post('/api/devices/pairing/complete', async (request, reply) => {
    const input = parseBody(completePairingSchema, request.body);
    const pairing = repo.consumePairingCode(sha256Hex(input.pairing_code));
    const device = repo.createDevice(pairing.user_id, input.device_type, input.device_name, true);
    const token = safeToken(32);
    repo.createSession(pairing.user_id, device.id, sha256Hex(token), null);
    setSessionCookie(reply, token);
    return { data: { token, user: repo.getUser(pairing.user_id), device } satisfies AuthSession };
  });

  app.get('/api/devices', async () => ({ data: repo.listDevices() }));
  app.post('/api/devices/:id/revoke', async (request) => ({ data: repo.revokeDevice((request.params as { id: string }).id) }));

  app.get('/api/catalog-items', async () => ({ data: repo.listCatalogItems() }));
  app.post('/api/catalog-items', async (request) => {
    const input = parseBody(createCatalogItemSchema, request.body) as CreateCatalogItemInput;
    return { data: repo.createCatalogItem(input) };
  });
  app.patch('/api/catalog-items/:id', async (request) => ({
    data: repo.updateCatalogItem((request.params as { id: string }).id, parseBody(patchCatalogItemSchema, request.body) as never)
  }));
  app.post('/api/catalog-items/:id/delete', async (request) => {
    const body = parseExpectedVersion(request.body);
    return { data: repo.deleteCatalogItem((request.params as { id: string }).id, body.expected_version) };
  });
  app.post('/api/catalog/import', async (request) => {
    const input = parseBody(catalogImportSchema, request.body);
    return { data: repo.importCatalogItems(input.items) };
  });
  app.get('/api/catalog/export', async () => ({ data: { format: 'filamentbridge-catalog-v1', exported_at: nowIso(), items: repo.listCatalogItems() } }));

  app.get('/api/spools', async () => ({ data: repo.listSpools() }));
  app.post('/api/spools', async (request) => {
    const input = parseBody(createSpoolSchema, request.body) as CreateSpoolInput;
    return { data: repo.createSpool(input) };
  });
  app.get('/api/spools/lookup', async (request) => {
    const code = (request.query as { code?: string }).code;
    if (typeof code !== 'string' || code.trim().length === 0) {
      throw new RepositoryError('invalid_state', 'code query parameter is required');
    }
    return { data: repo.getSpoolByCode(code) };
  });
  app.get('/api/spools/:id', async (request) => ({ data: repo.getSpool((request.params as { id: string }).id) }));
  app.patch('/api/spools/:id', async (request) => ({ data: repo.updateSpool((request.params as { id: string }).id, parseBody(patchSpoolSchema, request.body) as never) }));
  app.post('/api/spools/:id/retire', async (request) => {
    const body = parseExpectedVersion(request.body);
    return { data: repo.retireSpool((request.params as { id: string }).id, body.expected_version) };
  });
  app.post('/api/spools/:id/delete', async (request) => {
    const body = parseExpectedVersion(request.body);
    return { data: repo.deleteSpool((request.params as { id: string }).id, body.expected_version) };
  });

  app.get('/api/labels/templates', async () => ({ data: repo.listLabelTemplates() }));
  app.post('/api/labels/templates', async (request) => {
    const input = parseBody(createLabelTemplateSchema, request.body) as CreateLabelTemplateInput;
    const auth = (request as AuthedRequest).auth;
    return { data: repo.createLabelTemplate({ ...input, created_by_user_id: auth.user.id }) };
  });
  app.patch('/api/labels/templates/:id', async (request) => ({
    data: repo.updateLabelTemplate((request.params as { id: string }).id, parseBody(patchLabelTemplateSchema, request.body) as never)
  }));
  app.post('/api/labels/render', async (request): Promise<{ data: RenderedLabels }> => {
    const input = parseBody(renderLabelsSchema, request.body);
    const template = repo.getLabelTemplate(input.template_id);
    const spools = input.spool_ids.map((id) => repo.getSpool(id));
    const rendered = await renderSpoolLabels(template, spools, input.base_url);
    repo.touchLabelTemplateUsed(template.id);
    return { data: rendered };
  });

  app.post('/api/usage-events/adjustment', async (request) => {
    const input = parseBody(manualAdjustmentSchema, request.body);
    return { data: repo.manualAdjustment(input.spool_id, input.expected_version, input.new_remaining_weight_g, input.notes) };
  });
  app.get('/api/usage-events', async (request) => {
    const status = (request.query as { review_status?: string }).review_status;
    return { data: repo.listUsageEvents(status as UsageReviewStatus | undefined) };
  });
  app.post('/api/usage-events/:id/approve', async (request) => {
    const body = parseBody(approveUsageEventSchema, request.body ?? {});
    return { data: repo.approveUsageEvent((request.params as { id: string }).id, body.expected_spool_version) };
  });
  app.post('/api/usage-events/:id/edit-and-approve', async (request) => {
    const body = parseBody(editUsageEventSchema, request.body);
    return { data: repo.editAndApproveUsageEvent((request.params as { id: string }).id, body.delta_weight_g, body.notes, body.expected_spool_version) };
  });
  app.post('/api/usage-events/:id/reject', async (request) => ({ data: repo.rejectUsageEvent((request.params as { id: string }).id) }));

  app.get('/api/nfc/tags', async () => ({ data: repo.listTags() }));
  app.post('/api/nfc/assign', async (request) => {
    const input = parseBody(nfcAssignSchema, request.body);
    const identity = activeSigningIdentity(signingKeyStore);
    const result = repo.assignNfcTag({
      tag_uid_hash: hashTagUid(input.tag_uid, salt),
      spool_id: input.spool_id,
      expected_spool_version: input.expected_spool_version,
      instance_id: signingKeyStore.instance_id,
      public_key_id: identity.public_key_id
    });
    return { data: result };
  });
  app.post('/api/nfc/write-payload', async (request) => {
    const input = parseBody(nfcWritePayloadSchema, request.body);
    const tag = repo.getTag(input.tag_id);
    const spool = repo.getSpool(input.spool_id);
    if (tag.assigned_spool_id !== spool.id || spool.active_tag_id !== tag.id) {
      throw new RepositoryError('conflict', 'tag is not active for this spool');
    }
    if (spool.version !== input.expected_spool_version) {
      throw new RepositoryError('conflict', `version conflict: expected ${input.expected_spool_version}, current ${spool.version}`);
    }
    if (tag.status === 'stale' && !input.force_stale_rewrite) {
      throw new RepositoryError('conflict', 'stale tag rewrite requires explicit force_stale_rewrite');
    }
    const catalog = repo.getCatalogItem(spool.catalog_item_id);
    const identity = activeSigningIdentity(signingKeyStore);
    const signed = signNfcPayload({
      instance_id: signingKeyStore.instance_id,
      tag_id: tag.id,
      spool_id: spool.id,
      material_type: spool.material_type,
      diameter_mm: spool.diameter_mm,
      color_hex: spool.color_hex,
      remaining_weight_g: spool.remaining_filament_weight_g,
      nozzle_temp_min_c: catalog.nozzle_temp_min_c,
      nozzle_temp_max_c: catalog.nozzle_temp_max_c,
      drying_temp_c: catalog.drying_temp_c,
      drying_time_minutes: catalog.drying_time_minutes,
      written_at_epoch_seconds: Math.floor(Date.now() / 1000),
      public_key_id: identity.public_key_id
    }, identity);
    const updatedTag = repo.recordTagWrite(tag.id, signed.payload_hash);
    const data: NfcWritePayloadResult = {
      tag: updatedTag,
      spool,
      encoded_payload: signed.encoded_payload,
      payload_hash: signed.payload_hash,
      public_key_id: identity.public_key_id,
      write_count: updatedTag.write_count,
      boundary: OFFICIAL_RFID_BOUNDARY
    };
    return { data };
  });
  app.post('/api/nfc/verify', async (request) => {
    const input = parseBody(nfcVerifySchema, request.body);
    const payload = decodePayloadBase64Url(input.encoded_payload);
    return { data: verifyNfcPayload(payload, signingKeyStore) };
  });
  app.post('/api/nfc/scan', async (request): Promise<{ data: NfcScanResult }> => {
    const input = parseBody(nfcScanSchema, request.body);
    const payload = input.encoded_payload === null ? null : decodePayloadBase64Url(input.encoded_payload);
    const uidHash = input.tag_uid_hash ?? (input.tag_uid === null ? null : hashTagUid(input.tag_uid, salt));
    const classification = classifyRawNfcPayload(payload);
    if (classification === 'blank') {
      return { data: { classification: 'blank', tag: null, spool: null, decoded: null, message: 'blank companion tag detected' } };
    }
    const tag = uidHash === null ? null : repo.getTagByUidHash(uidHash, true);
    if (classification === 'foreign') {
      return { data: { classification: 'foreign', tag, spool: null, decoded: null, message: 'foreign or unknown NFC payload; explicit overwrite confirmation is required' } };
    }
    if (classification === 'invalid' || payload === null) {
      return { data: { classification: 'invalid_signature', tag, spool: null, decoded: null, message: 'invalid FilamentBridge payload layout' } };
    }
    const verification = verifyNfcPayload(payload, signingKeyStore);
    if (!verification.ok || verification.decoded === null) {
      return { data: { classification: 'invalid_signature', tag, spool: null, decoded: verification.decoded, message: `payload verification failed: ${verification.reason}` } };
    }
    if (tag === null) {
      return { data: { classification: 'foreign', tag: null, spool: null, decoded: verification.decoded, message: 'valid FilamentBridge payload from an unknown local tag' } };
    }
    if (tag.status === 'retired') {
      repo.recordTagScan(tag.id, 'retired');
      return { data: { classification: 'retired', tag: repo.getTag(tag.id), spool: null, decoded: verification.decoded, message: 'tag has been retired' } };
    }
    const spool = tag.assigned_spool_id === null ? null : repo.getSpool(tag.assigned_spool_id);
    const stale = spool !== null && tag.last_written_at !== null && new Date(spool.updated_at).getTime() > new Date(tag.last_written_at).getTime();
    const scannedTag = repo.recordTagScan(tag.id, stale ? 'stale' : 'assigned');
    return {
      data: {
        classification: stale ? 'app_owned_stale' : 'app_owned_valid',
        tag: scannedTag,
        spool,
        decoded: verification.decoded,
        message: stale ? 'tag snapshot is stale; rewrite after reviewing server state' : 'valid app-owned companion tag'
      }
    };
  });
  app.post('/api/nfc/retire', async (request) => {
    const input = parseBody(nfcRetireSchema, request.body);
    return { data: repo.retireTag(input.tag_id, input.expected_version) };
  });

  app.post('/api/sync/events', async (request): Promise<{ data: SyncSubmissionResult }> => {
    const input = parseBody(submitSyncEventsSchema, request.body);
    const auth = (request as AuthedRequest).auth;
    if (auth.device.id !== input.device_id) {
      throw new RepositoryError('unauthorized', 'sync device does not match authenticated device');
    }
    const result: SyncSubmissionResult = { applied: [], rejected: [], conflicts: [] };
    for (const event of input.events) {
      try {
        if (event.entity_type === 'spool' && event.event_type === 'manual_adjustment') {
          const expected = Number(event.payload.expected_version ?? event.entity_version);
          const nextWeight = Number(event.payload.new_remaining_weight_g);
          const notes = typeof event.payload.notes === 'string' ? event.payload.notes : null;
          repo.manualAdjustment(event.entity_id, expected, nextWeight, notes);
          result.applied.push(repo.createSyncEvent({ id: event.id, source: 'ios', source_device_id: input.device_id, entity_type: event.entity_type, entity_id: event.entity_id, event_type: event.event_type, payload: event.payload, status: 'applied', error_message: null }));
        } else {
          result.rejected.push({ id: event.id, reason: 'unsupported sync event type' });
          repo.createSyncEvent({ id: event.id, source: 'ios', source_device_id: input.device_id, entity_type: event.entity_type, entity_id: event.entity_id, event_type: event.event_type, payload: event.payload, status: 'rejected', error_message: 'unsupported sync event type' });
        }
      } catch (error) {
        if (error instanceof RepositoryError && error.code === 'conflict') {
          const serverEntity = safeGetSpool(repo, event.entity_id);
          result.conflicts.push({ id: event.id, reason: error.message, server_entity: serverEntity });
          repo.createSyncEvent({ id: event.id, source: 'ios', source_device_id: input.device_id, entity_type: event.entity_type, entity_id: event.entity_id, event_type: event.event_type, payload: event.payload, status: 'conflict', error_message: error.message });
        } else {
          const message = error instanceof Error ? error.message : 'sync event failed';
          result.rejected.push({ id: event.id, reason: message });
          repo.createSyncEvent({ id: event.id, source: 'ios', source_device_id: input.device_id, entity_type: event.entity_type, entity_id: event.entity_id, event_type: event.event_type, payload: event.payload, status: 'failed', error_message: message });
        }
      }
    }
    return { data: result };
  });
  app.get('/api/sync/events', async () => ({ data: repo.listSyncEvents() }));
  app.post('/api/sync/events/:id/resolve', async (request) => {
    const body = request.body as { resolution?: string } | undefined;
    const event = repo.createSyncEvent({ source: 'web', source_device_id: (request as AuthedRequest).auth.device.id, entity_type: 'sync_event', entity_id: (request.params as { id: string }).id, event_type: 'resolve', payload: { resolution: body?.resolution ?? 'acknowledged' }, status: 'applied', error_message: null });
    return { data: event };
  });

  app.get('/api/printers', async () => ({ data: repo.listPrinters() }));
  app.post('/api/printers', async (request) => {
    const input = parseBody(createPrinterSchema, request.body) as CreatePrinterInput;
    const capability = input.connection_mode === 'manual' ? 'manual_only' : input.model === 'Unsupported' ? 'unsupported' : capabilityForModel(input.model);
    const secretRef = input.lan_access_code === null && input.device_id === null ? null : createBambuLanSecretRef(input.lan_access_code, input.device_id, secretKey);
    const printer = repo.createPrinter({
      name: input.name,
      manufacturer: input.manufacturer,
      model: input.model,
      serial_hash: hashPrinterSerial(input.serial, salt),
      host: input.host,
      lan_access_code_secret_ref: secretRef,
      connection_mode: input.connection_mode,
      capability_level: capability,
      firmware_version: input.firmware_version,
      notes: input.notes
    });
    return { data: printer };
  });
  app.patch('/api/printers/:id', async (request) => {
    const printer = repo.getPrinter((request.params as { id: string }).id);
    const input = parseBody(patchPrinterSchema, request.body);
    const patch = { ...input } as Record<string, unknown>;
    if (typeof patch.serial === 'string') {
      patch.serial_hash = hashPrinterSerial(patch.serial, salt);
      delete patch.serial;
    }
    if ('lan_access_code' in patch || 'device_id' in patch) {
      const existingCredentials = resolveBambuLanMqttCredentials(printer.lan_access_code_secret_ref, secretKey, config.bambuMqttAllowInsecureTls);
      const lanAccessCode = 'lan_access_code' in patch ? patch.lan_access_code as string | null : existingCredentials.lan_access_code;
      const deviceId = 'device_id' in patch ? patch.device_id as string | null : existingCredentials.device_id;
      patch.lan_access_code_secret_ref = lanAccessCode === null && deviceId === null ? null : createBambuLanSecretRef(lanAccessCode, deviceId, secretKey);
      delete patch.lan_access_code;
      delete patch.device_id;
    }
    return { data: repo.updatePrinter(printer.id, patch as never) };
  });
  app.post('/api/printers/:id/delete', async (request) => {
    const body = parseExpectedVersion(request.body);
    return { data: repo.deletePrinter((request.params as { id: string }).id, body.expected_version) };
  });
  app.post('/api/printers/:id/test-connection', async (request): Promise<{ data: TestConnectionResult }> => {
    const printer = repo.getPrinter((request.params as { id: string }).id);
    const result = await connector.testConnection(printer);
    if (result.ok) {
      repo.touchPrinterSeen(printer.id, result.capability_level);
    }
    return { data: result };
  });
  app.get('/api/printers/:id/slots', async (request) => {
    const printer = repo.getPrinter((request.params as { id: string }).id);
    return { data: repo.listPrinterSlots(printer.id) };
  });
  app.patch('/api/printer-slots/:id/mapping', async (request) => {
    const input = parseBody(mapPrinterSlotSchema, request.body);
    return { data: repo.mapPrinterSlot((request.params as { id: string }).id, input.mapped_spool_id, input.expected_version) };
  });
  app.post('/api/printers/:id/sync-now', async (request) => {
    const printer = repo.getPrinter((request.params as { id: string }).id);
    const existingSlots = repo.listPrinterSlots(printer.id);
    const result = await connector.syncNow(printer, existingSlots);
    const slots: PrinterSlot[] = result.observed_slots.map((slot) => repo.upsertPrinterSlot({
      printer_id: printer.id,
      unit_type: slot.unit_type,
      unit_index: slot.unit_index,
      slot_index: slot.slot_index,
      display_name: slot.display_name,
      mapped_spool_id: existingSlots.find((existing) => existing.unit_type === slot.unit_type && existing.unit_index === slot.unit_index && existing.slot_index === slot.slot_index)?.mapped_spool_id ?? null,
      detected_material_type: slot.detected_material_type,
      detected_color_hex: slot.detected_color_hex,
      detected_remaining_percent: slot.detected_remaining_percent,
      state: slot.state
    }));
    const usage_events = result.usage_candidates.map((candidate) => repo.createPendingUsageEvent({
      spool_id: candidate.spool_id,
      source: 'printer_job',
      printer_id: printer.id,
      printer_slot_id: candidate.printer_slot_id,
      job_id: candidate.job_id,
      delta_weight_g: candidate.delta_weight_g,
      confidence: candidate.confidence,
      review_status: 'pending',
      notes: candidate.notes
    }));
    if (result.observed_slots.length > 0 || result.warnings.length === 0) repo.touchPrinterSeen(printer.id, result.capability_level);
    return { data: { ...result, slots, usage_events } };
  });

  app.get('/api/export', async () => ({ data: repo.createExportSnapshot() }));
  app.post('/api/backups', async (): Promise<{ data: BackupResult }> => {
    const createdAt = nowIso();
    const filename = `filamentbridge-backup-${createdAt.replace(/[:.]/g, '-')}.json`;
    const path = join(config.backupDirectory, filename);
    const payload = { format: 'filamentbridge-backup-v1', created_at: createdAt, database: repo.createExportSnapshot(), signing_keys: signingKeyStore };
    writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    return { data: { path, includes_database: true, includes_signing_keys: true, created_at: createdAt } };
  });
  app.post('/api/restore', async (request) => {
    const body = request.body as { backup_path?: string; backup?: unknown };
    const backup = body.backup ?? (body.backup_path === undefined ? undefined : JSON.parse(readFileSync(body.backup_path, 'utf8')));
    if (typeof backup !== 'object' || backup === null || (backup as { format?: unknown }).format !== 'filamentbridge-backup-v1') {
      throw new RepositoryError('invalid_state', 'unsupported backup format');
    }
    const database = exportFileSchema.parse((backup as { database: unknown }).database) as FilamentBridgeExport;
    repo.restoreExportSnapshot(database);
    const restoredKeys = (backup as { signing_keys?: SigningKeyStore }).signing_keys;
    if (restoredKeys !== undefined) {
      saveSigningKeyStore(config.keyDirectory, restoredKeys);
      signingKeyStore.active_public_key_id = restoredKeys.active_public_key_id;
      signingKeyStore.keys = restoredKeys.keys;
    }
    return { data: { ok: true, restored_at: nowIso(), includes_signing_keys: restoredKeys !== undefined } };
  });

  app.get('/api/boundary', async () => ({ data: { boundary: OFFICIAL_RFID_BOUNDARY, writes_bambu_rfid: false, companion_tags_only: true } }));

  if (existsSync(config.webDistPath)) {
    await app.register(fastifyStatic, { root: config.webDistPath, prefix: '/' });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/')) {
        return reply.code(404).send(errorEnvelope('not_found', 'route not found'));
      }
      return reply.sendFile('index.html');
    });
  }

  await connector.start?.();

  return app;
}

function authenticateRequest(request: FastifyRequest, repo: FilamentBridgeRepository): AuthContext | null {
  const token = bearerOrCookieToken(request);
  if (token === null) {
    return null;
  }
  const tokenHash = sha256Hex(token);
  const session = repo.getSessionByTokenHash(tokenHash);
  if (session === null) {
    return null;
  }
  return {
    token_hash: tokenHash,
    session: { id: session.id, user_id: session.user_id, device_id: session.device_id },
    user: repo.getUser(session.user_id),
    device: repo.getDevice(session.device_id)
  };
}

function bearerOrCookieToken(request: FastifyRequest): string | null {
  const authorization = request.headers.authorization;
  if (authorization?.toLowerCase().startsWith('bearer ')) {
    return authorization.slice(7).trim();
  }
  const cookieToken = request.cookies.fb_session;
  return typeof cookieToken === 'string' && cookieToken.length > 0 ? cookieToken : null;
}

function isPublicRoute(request: FastifyRequest): boolean {
  const path = request.url.split('?')[0] ?? request.url;
  if (path === '/health' || path === '/api/setup/status' || path === '/api/setup/owner' || path === '/api/auth/login' || path === '/api/devices/pairing/complete' || path.startsWith('/docs') || path === '/api/boundary') {
    return true;
  }
  if (!path.startsWith('/api/')) {
    return true;
  }
  return false;
}

function parseBody<T extends ZodTypeAny>(schema: T, body: unknown): ReturnType<T['parse']> {
  return schema.parse(body);
}

function parseExpectedVersion(body: unknown): { expected_version: number } {
  if (typeof body !== 'object' || body === null || typeof (body as { expected_version?: unknown }).expected_version !== 'number') {
    throw new RepositoryError('invalid_state', 'expected_version is required');
  }
  return { expected_version: (body as { expected_version: number }).expected_version };
}

function errorEnvelope(code: string, message: string, details?: unknown): { error: { code: string; message: string; details?: unknown } } {
  const error: { code: string; message: string; details?: unknown } = { code, message };
  if (details !== undefined) {
    error.details = details;
  }
  return { error };
}

function setSessionCookie(reply: FastifyReply, token: string): void {
  reply.setCookie('fb_session', token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: false
  });
}

function safePairingCode(): string {
  const raw = safeToken(12).replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}

function safeGetSpool(repo: FilamentBridgeRepository, id: string): unknown {
  try {
    return repo.getSpool(id);
  } catch {
    return null;
  }
}

const BAMBU_LAN_SECRET_PREFIX = 'secretbox:bambu-lan-v1:';
const LEGACY_SECRET_PREFIX = 'secretbox:';

type BambuLanSecretPayload = {
  lan_access_code: string | null;
  device_id: string | null;
};

function createBambuLanSecretRef(lanAccessCode: string | null, deviceId: string | null, secretKey: Uint8Array): string {
  const payload: BambuLanSecretPayload = {
    lan_access_code: normalizeNullableSecret(lanAccessCode),
    device_id: normalizeNullableSecret(deviceId)
  };
  return `${BAMBU_LAN_SECRET_PREFIX}${JSON.stringify(encryptSecret(JSON.stringify(payload), secretKey))}`;
}

function resolveBambuLanMqttCredentials(secretRef: string | null, secretKey: Uint8Array, allowInsecureTls: boolean): BambuLanMqttCredentials {
  if (secretRef === null) {
    return { lan_access_code: null, device_id: null, allow_insecure_tls: allowInsecureTls };
  }
  if (secretRef.startsWith(BAMBU_LAN_SECRET_PREFIX)) {
    const plaintext = decryptSecret(JSON.parse(secretRef.slice(BAMBU_LAN_SECRET_PREFIX.length)) as SecretBox, secretKey);
    const payload = JSON.parse(plaintext) as Partial<BambuLanSecretPayload>;
    return {
      lan_access_code: normalizeNullableSecret(payload.lan_access_code ?? null),
      device_id: normalizeNullableSecret(payload.device_id ?? null),
      allow_insecure_tls: allowInsecureTls
    };
  }
  if (secretRef.startsWith(LEGACY_SECRET_PREFIX)) {
    return {
      lan_access_code: normalizeNullableSecret(decryptSecret(JSON.parse(secretRef.slice(LEGACY_SECRET_PREFIX.length)) as SecretBox, secretKey)),
      device_id: null,
      allow_insecure_tls: allowInsecureTls
    };
  }
  return { lan_access_code: null, device_id: null, allow_insecure_tls: allowInsecureTls };
}

function normalizeNullableSecret(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function renderSpoolLabels(template: LabelTemplate, spools: Spool[], baseUrl: string | null): Promise<RenderedLabels> {
  const pageWidth = template.page_width_mm;
  const pageHeight = template.page_height_mm;
  const gap = 2;
  const labels = await Promise.all(spools.map(async (spool, index) => {
    const column = index % template.columns;
    const row = Math.floor(index / template.columns) % template.rows;
    const page = Math.floor(index / (template.rows * template.columns));
    const x = gap + column * (template.label_width_mm + gap);
    const y = page * pageHeight + gap + row * (template.label_height_mm + gap);
    return renderSingleSpoolLabel(template, spool, baseUrl, x, y);
  }));
  const pageCount = Math.max(1, Math.ceil(spools.length / (template.rows * template.columns)));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${pageWidth}mm" height="${pageHeight * pageCount}mm" viewBox="0 0 ${pageWidth} ${pageHeight * pageCount}" role="img" aria-label="${escapeXml(template.name)} labels"><rect width="100%" height="100%" fill="white"/>${labels.join('')}</svg>`;
  return { mime_type: 'image/svg+xml', filename: `${safeFilePart(template.name)}.svg`, svg };
}

async function renderSingleSpoolLabel(template: LabelTemplate, spool: Spool, baseUrl: string | null, x: number, y: number): Promise<string> {
  const padding = 2;
  const codeSize = Math.min(template.label_width_mm * 0.34, template.label_height_mm - padding * 2);
  const codeX = x + template.label_width_mm - codeSize - padding;
  const codeY = y + padding;
  const payload = labelPayload(spool, baseUrl);
  const code = template.code_type === 'qr'
    ? renderQr(payload, codeX, codeY, codeSize)
    : template.code_type === 'barcode'
      ? renderCode39(spool.short_code, codeX, codeY, codeSize, Math.max(8, codeSize * 0.45))
      : '';
  const lines = labelTextLines(template, spool);
  const text = lines.map((line, index) => `<text x="${x + padding}" y="${y + padding + 4 + index * 4.2}" font-size="3.2" font-family="Arial, sans-serif">${escapeXml(line)}</text>`).join('');
  return `<g><rect x="${x}" y="${y}" width="${template.label_width_mm}" height="${template.label_height_mm}" rx="1.5" fill="#fff" stroke="#1f2937" stroke-width="0.2"/>${text}${code}<text x="${x + padding}" y="${y + template.label_height_mm - 2.2}" font-size="3" font-family="Arial, sans-serif" font-weight="700">${escapeXml(spool.short_code)}</text></g>`;
}

function labelPayload(spool: Spool, baseUrl: string | null): string {
  return baseUrl === null ? spool.short_code : `${baseUrl.replace(/\/$/, '')}/api/spools/lookup?code=${encodeURIComponent(spool.short_code)}`;
}

function labelTextLines(template: LabelTemplate, spool: Spool): string[] {
  const values: Record<string, string> = {
    short_code: spool.short_code,
    display_name: spool.display_name,
    material_type: spool.material_type,
    color_hex: spool.color_hex,
    remaining_filament_weight_g: `${spool.remaining_filament_weight_g} g`,
    storage_location: spool.storage_location ?? '',
    vendor_lot: spool.vendor_lot ?? ''
  };
  const rendered = template.template_text.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_match, key: string) => values[key] ?? '');
  const fieldLines = template.included_fields.map((field) => values[field]).filter((value): value is string => typeof value === 'string' && value.length > 0);
  return [...rendered.split(/\r?\n/), ...fieldLines].filter((value, index, array) => value.trim().length > 0 && array.indexOf(value) === index).slice(0, 5);
}

function renderQr(payload: string, x: number, y: number, size: number): string {
  const qr = QRCode.create(payload, { errorCorrectionLevel: 'M' }) as unknown as { modules: { size: number; get(row: number, column: number): number } };
  const cell = size / qr.modules.size;
  const rects: string[] = [];
  for (let row = 0; row < qr.modules.size; row += 1) {
    for (let column = 0; column < qr.modules.size; column += 1) {
      if (qr.modules.get(row, column) !== 0) {
        rects.push(`<rect x="${(x + column * cell).toFixed(3)}" y="${(y + row * cell).toFixed(3)}" width="${cell.toFixed(3)}" height="${cell.toFixed(3)}"/>`);
      }
    }
  }
  return `<g fill="#111827">${rects.join('')}</g>`;
}

const CODE39_PATTERNS: Record<string, string> = {
  '0': 'nnnwwnwnn', '1': 'wnnwnnnnw', '2': 'nnwwnnnnw', '3': 'wnwwnnnnn', '4': 'nnnwwnnnw',
  '5': 'wnnwwnnnn', '6': 'nnwwwnnnn', '7': 'nnnwnnwnw', '8': 'wnnwnnwnn', '9': 'nnwwnnwnn',
  A: 'wnnnnwnnw', B: 'nnwnnwnnw', C: 'wnwnnwnnn', D: 'nnnnwwnnw', E: 'wnnnwwnnn',
  F: 'nnwnwwnnn', G: 'nnnnnwwnw', H: 'wnnnnwwnn', I: 'nnwnnwwnn', J: 'nnnnwwwnn',
  K: 'wnnnnnnww', L: 'nnwnnnnww', M: 'wnwnnnnwn', N: 'nnnnwnnww', O: 'wnnnwnnwn',
  P: 'nnwnwnnwn', Q: 'nnnnnnwww', R: 'wnnnnnwwn', S: 'nnwnnnwwn', T: 'nnnnwnwwn',
  U: 'wwnnnnnnw', V: 'nwwnnnnnw', W: 'wwwnnnnnn', X: 'nwnnwnnnw', Y: 'wwnnwnnnn',
  Z: 'nwwnwnnnn', '-': 'nwnnnnwnw', '.': 'wwnnnnwnn', ' ': 'nwwnnnwnn', '*': 'nwnnwnwnn'
};

function renderCode39(value: string, x: number, y: number, width: number, height: number): string {
  const encoded = `*${value.toUpperCase().replace(/[^A-Z0-9 .-]/g, '')}*`;
  const units = encoded.length * 13;
  const narrow = width / units;
  let cursor = x;
  const bars: string[] = [];
  for (const char of encoded) {
    const pattern = CODE39_PATTERNS[char] ?? CODE39_PATTERNS['-']!;
    for (let index = 0; index < pattern.length; index += 1) {
      const lineWidth = narrow * (pattern.charAt(index) === 'w' ? 2.5 : 1);
      if (index % 2 === 0) bars.push(`<rect x="${cursor.toFixed(3)}" y="${y.toFixed(3)}" width="${lineWidth.toFixed(3)}" height="${height.toFixed(3)}"/>`);
      cursor += lineWidth;
    }
    cursor += narrow;
  }
  return `<g fill="#111827">${bars.join('')}</g>`;
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char] ?? char);
}

function safeFilePart(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'labels';
}

function applyCors(request: FastifyRequest, reply: FastifyReply, allowedOrigins: string[]): void {
  const origin = request.headers.origin;
  if (origin !== undefined && allowedOrigins.includes(origin)) {
    reply.header('Access-Control-Allow-Origin', origin);
    reply.header('Vary', 'Origin');
    reply.header('Access-Control-Allow-Credentials', 'true');
    reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    reply.header('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
  }
}
