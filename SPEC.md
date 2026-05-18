# FilamentBridge Specification

Status: Draft v0.1  
Last updated: 2026-05-15  
Audience: Build agents, engineers, and future maintainers

## 1. Summary

FilamentBridge is a self-hostable filament inventory application for Bambu Lab printer owners who want NFC-based spool tracking without depending on a third-party cloud service.

The application is inspired by TigerTag-style NFC spool metadata, but it is not a Bambu RFID cloning tool. V1 uses FilamentBridge-owned companion NFC tags, a local server as the source of truth, an iOS-first mobile app for NFC read/write operations, and a web UI for inventory, printer, catalog, and review workflows.

Bambu integration is an AMS companion sync layer. The system observes Bambu printer and AMS slot state over local network access where supported, maps those slots to FilamentBridge spool records, and creates reviewed filament usage events from completed print jobs. It must not emulate, forge, rewrite, or bypass official Bambu RFID tags or signatures.

## 2. Product Goals

- Provide a self-hosted spool inventory system optimized for Bambu printer and AMS workflows.
- Let users create, scan, assign, and update app-owned NFC tags for filament spools.
- Keep the server authoritative while allowing the NFC tag to hold a useful offline identity and spool snapshot.
- Support iOS NFC read/write in v1 through a native app suitable for TestFlight distribution.
- Provide a browser-based admin UI for inventory, catalog, printer setup, sync history, and review queues.
- Track Bambu AMS slot state and create pending usage events from print-job telemetry when available.
- Keep catalog data local by default, including brands, materials, colors, print settings, drying notes, and slicer preset alignment.
- Deploy on a home LAN with Docker Compose, with private remote access through Tailscale or a similar VPN-style network.
- Provide printable QR/barcode labels and short human-readable spool codes as a non-NFC fallback for fast identification and slot assignment.
- Warn users when a mapped spool appears to have insufficient remaining filament for an estimated job, while keeping print start/control outside v1.

## 3. Non-Goals

- Do not clone, forge, emulate, modify, or bypass official Bambu RFID tags, signatures, firmware checks, or AMS firmware behavior.
- Do not require Bambu Cloud, public internet exposure, or SaaS-style multi-tenancy for v1.
- Do not make Web NFC the primary NFC path for v1, because browser support and low-level tag access are not sufficient across iOS and all target workflows.
- Do not require printer command/control, remote print start, or camera streaming for v1.
- Do not require Bambu Studio or Orca Slicer integration to ship the first usable inventory and NFC workflow.
- Do not lock the app to a specific backend, frontend, database, or mobile framework in this specification.

## 4. Primary Users And Workflows

### 4.1 Primary User

A home or small-shop Bambu printer owner with one or more Bambu printers, AMS units, and third-party or Bambu filament spools. They want reliable inventory, spool identity, and remaining-weight tracking across printers without relying on cloud-only storage.

### 4.2 Core V1 Workflows

1. Create a filament catalog item in the web UI.
2. Create a spool record from that catalog item.
3. Use the iOS app to assign a blank NTAG213-compatible NFC tag to the spool.
4. Place the app-owned companion tag on or near the spool.
5. Scan the tag later to view spool identity, material, color, remaining weight, and history.
6. Update remaining weight manually from the iOS app or web UI.
7. Register a Bambu printer using LAN details.
8. View detected printer and AMS slot state in the web UI.
9. Map a physical AMS or external slot to a FilamentBridge spool.
10. Review pending printer-derived usage events after completed jobs.
11. Approve, edit, or reject usage events before they affect remaining weight.


### 4.3 Adjacent-App Feature Review

Reviewed adjacent products point to several useful, boundary-safe additions:

- Spoolman emphasizes a self-hosted central inventory with REST integrations, WebSocket-style live updates, QR labels, custom fields, multi-printer usage updates, and Prometheus monitoring (https://github.com/Donkie/Spoolman).
- OctoPrint filament plugins commonly track extruded filament, warn when selected spools do not have enough material, pause on runout, apply spool temperature offsets, and support import/export or shared databases (https://github.com/OllisGit/OctoPrint-FilamentManager).
- Bambu Studio and Bambu Handy provide slicer/profile alignment, remote monitoring/control, official filament palettes, AMS filament management, and automatic AMS enrollment; FilamentBridge should only observe compatible local state and must not replicate official control or RFID behavior (https://github.com/bambulab/BambuStudio, https://apps.apple.com/us/app/bambu-handy/id1625671285).
- OrcaSlicer exposes filament profile fields and calibration workflows such as temperature, flow ratio, pressure advance, max volumetric speed, density, shrinkage, price, soluble/support material flags, and nozzle requirements (https://www.orcaslicer.com/wiki/material_settings/filament/material_basic_information, https://www.orcaslicer.com/wiki/calibration_guide).
- SimplyPrint shows strong physical-inventory workflows: short spool IDs, QR/barcode label templates, mobile label generation, scan-to-assign flows, low-filament warnings, print history/cost attribution, Bambu AMS material syncing, and NFC assignment that can link a tag UID without rewriting the tag (https://help.simplyprint.io/en/article/the-filament-label-generator-feature-organize-your-filament-inventory-fh6shk/, https://help.simplyprint.io/en/article/assigning-filament-spools-to-printers-1r66t1p/).
- OpenPrintTag highlights offline, rewritable, open smart-spool data as a safe future interoperability direction for app-owned tags; v1 may read compatible open tags for import, but must not write proprietary Bambu-compatible RFID payloads (https://openprinttag.org/).

V1 should adopt only the features that reinforce FilamentBridge's local-first inventory purpose: local labels, richer filament profile metadata, scan-assisted assignment, low-filament review warnings, cost/history metadata, and observable fleet health. It must not add cloud dependency, remote print control, camera streaming, official Bambu RFID cloning, or firmware bypass behavior.

## 5. Architecture

### 5.1 Required Components

- **Self-hosted server:** Owns all authoritative data, exposes API, handles sync, stores events, signs app-owned NFC payloads, and runs the printer connection services.
- **Database:** Stores users, devices, spool inventory, catalog records, tag assignments, printer state, slot state, and event history.
- **Web UI:** Runs against the local server and provides inventory, catalog, printer setup, review, and settings screens.
- **iOS app:** Provides NFC read/write, offline scan queue, spool lookup, manual weight events, and mobile pairing.
- **Bambu connector:** Observes Bambu printer and AMS state on the LAN where supported, using local access credentials provided by the user and the lightweight MQTT connection server.
- **Background workers:** Poll or subscribe to printer state, reconcile sync queues, create pending usage events, and maintain printer health state.
- **Lightweight MQTT connection server:** Runs inside the self-hosted server or worker process, owns Bambu LAN MQTT sessions, coalesces concurrent snapshot requests, and keeps only short-lived sanitized printer snapshots.

### 5.2 Optional Later Components

- Android mobile app.
- USB or network NFC reader station.
- Connected scale integration.
- Home Assistant integration.
- Spoolman import/export bridge.
- Public reverse-proxy deployment profile.
- Bambu Studio or Orca Slicer preset sync beyond basic import/export.

### 5.3 Source Of Truth

The server is authoritative for all mutable state. NFC tags are a portable cache and identity carrier. Printer telemetry is observational input and must be converted into events before it updates inventory.

## 6. Data Model

All entities require:

- `id`: stable server-side identifier.
- `created_at`, `updated_at`: server timestamps.
- `deleted_at`: nullable soft-delete timestamp where deletion is supported.
- `version`: monotonically increasing integer for optimistic concurrency.

### 6.1 Spool

Represents one physical spool or refill.

Required fields:

- `id`
- `catalog_item_id`
- `display_name`
- `manufacturer_name`
- `material_type`
- `diameter_mm`
- `color_hex`
- `initial_filament_weight_g`
- `remaining_filament_weight_g`
- `empty_spool_weight_g`
- `purchase_date`
- `opened_at`
- `status`: `sealed`, `active`, `loaded`, `drying`, `empty`, `retired`, `lost`
- `storage_location`
- `notes`
- `short_code`: unique local human-readable identifier for labels and manual lookup
- `active_tag_id`
- `purchase_price_amount`
- `purchase_currency`
- `vendor_lot`

Behavior:

- Remaining weight changes must be represented by `UsageEvent` or manual adjustment events.
- A spool may have zero or one active NFC tag.
- Historical tags remain linked for audit, but only one tag is active.

### 6.2 FilamentCatalogItem

Represents reusable material metadata.

Required fields:

- `id`
- `brand`
- `product_line`
- `material_type`
- `diameter_mm`
- `color_name`
- `color_hex`
- `nozzle_temp_min_c`
- `nozzle_temp_max_c`
- `bed_temp_min_c`
- `bed_temp_max_c`
- `drying_temp_c`
- `drying_time_minutes`
- `density_g_cm3`
- `bambu_studio_preset_name`
- `orca_slicer_preset_name`
- `vendor_sku`
- `notes`
- `max_volumetric_speed_mm3_s`
- `flow_ratio`
- `pressure_advance`
- `shrinkage_xy_percent`
- `shrinkage_z_percent`
- `softening_temp_c`
- `required_nozzle_hrc`
- `soluble`
- `support_material`

Behavior:

- Catalog data is local-first and user-editable.
- External imports must create editable local copies, not hidden remote dependencies.

### 6.3 NfcTag

Represents an app-owned NFC companion tag.

Required fields:

- `id`
- `tag_uid_hash`
- `format`: `filamentbridge-v1`, `tigertag-compatible-core`, or `unknown`
- `payload_version`
- `assigned_spool_id`
- `instance_id`
- `public_key_id`
- `last_written_at`
- `last_read_at`
- `write_count`
- `status`: `blank`, `assigned`, `stale`, `retired`, `invalid`, `foreign`
- `last_payload_hash`

Behavior:

- Store a salted hash of hardware UID by default; raw UID storage must be optional and disabled unless needed for a reader implementation.
- Tags written by FilamentBridge must include an instance identifier and self-issued signature/check value.
- Foreign tags may be read for best-effort import, but must not be overwritten without explicit user action.

- Reading open, non-Bambu smart-spool standards may prefill local catalog or spool records, but official Bambu RFID data must remain printer-observed context only.

### 6.4 Printer

Represents one Bambu printer.

Required fields:

- `id`
- `name`
- `manufacturer`: `Bambu Lab`
- `model`
- `serial_hash`
- `host`
- `lan_access_code_secret_ref`
- `connection_mode`: `lan`, `vpn_lan`, `manual`
- `capability_level`: `supported`, `read_only`, `manual_only`, `unsupported`
- `last_seen_at`
- `firmware_version`
- `notes`

Behavior:

- Access codes and credentials must be encrypted at rest or stored via a secret provider.
- Printer connections must degrade to manual mode when firmware, network, or credential behavior changes.

### 6.5 PrinterSlot

Represents an AMS, AMS Lite, AMS 2 Pro, AMS HT, external spool holder, or other material feed slot.

Required fields:

- `id`
- `printer_id`
- `unit_type`: `ams`, `ams_lite`, `ams_2_pro`, `ams_ht`, `external`, `unknown`
- `unit_index`
- `slot_index`
- `display_name`
- `mapped_spool_id`
- `detected_material_type`
- `detected_color_hex`
- `detected_remaining_percent`
- `last_detected_at`
- `state`: `empty`, `loaded`, `feeding`, `unavailable`, `unknown`

Behavior:

- Detected slot data is observational.
- User mapping wins over inferred mapping.
- If printer-reported material conflicts with mapped spool data, create a review warning rather than silently changing the spool.
- Scan-assisted mapping may use app-owned NFC tags, local QR/barcode labels, or manual short-code entry, but every slot mapping must remain user-confirmed.

### 6.6 SyncEvent

Represents every client, tag, printer, or background sync action.

Required fields:

- `id`
- `source`: `ios`, `web`, `server`, `printer`, `import`, `api`
- `source_device_id`
- `entity_type`
- `entity_id`
- `event_type`
- `payload`
- `status`: `pending`, `applied`, `conflict`, `rejected`, `failed`
- `created_at`
- `applied_at`
- `error_message`

Behavior:

- Offline mobile changes create queued sync events.
- The server applies events in timestamp order per entity, using entity `version` for conflict detection.
- Conflicts must be visible in the review UI.

### 6.7 UsageEvent

Represents a change to spool remaining weight.

Required fields:

- `id`
- `spool_id`
- `source`: `manual`, `printer_job`, `slicer_estimate`, `scale`, `correction`
- `printer_id`
- `printer_slot_id`
- `job_id`
- `delta_weight_g`
- `before_weight_g`
- `after_weight_g`
- `confidence`: `user_confirmed`, `estimated`, `inferred`, `unknown`
- `review_status`: `pending`, `approved`, `edited`, `rejected`, `auto_approved`
- `notes`

Behavior:

- Printer-derived usage starts as `pending` unless the user has enabled auto-approval for that printer or spool.
- Approving or editing a usage event updates spool remaining weight.
- Rejected usage events remain in history.

### 6.8 User

Represents a local account.

Required fields:

- `id`
- `email`
- `display_name`
- `role`: `owner`, `admin`, `operator`, `viewer`
- `password_hash` or external auth identity
- `last_login_at`
- `status`

Behavior:

- V1 may ship with a single owner account but must not block later multi-user roles.

### 6.9 Device

Represents a paired iOS app, browser session, server connector, or reader.

Required fields:

- `id`
- `user_id`
- `device_type`: `ios`, `web`, `server`, `nfc_reader`, `printer_connector`
- `name`
- `paired_at`
- `last_seen_at`
- `trusted`
- `revoked_at`

Behavior:

- Mobile devices must pair through a local server flow before syncing.
- Revoked devices must not submit new sync events.


### 6.10 LabelTemplate

Represents a local printable QR/barcode label layout for physical spool identification.

Required fields:

- `id`
- `name`
- `medium`: `sheet`, `roll`, `thermal`, `custom`
- `page_width_mm`
- `page_height_mm`
- `label_width_mm`
- `label_height_mm`
- `rows`
- `columns`
- `code_type`: `qr`, `barcode`, `none`
- `template_text`
- `included_fields`
- `created_by_user_id`
- `last_used_at`

Behavior:

- Labels must encode only FilamentBridge local URLs, local spool IDs, or short codes.
- Label generation must work without an internet service.
- QR/barcode labels are identification aids, not trusted authentication; NFC signatures remain the trusted app-owned tag mechanism.

## 7. NFC Tag Specification

### 7.1 Tag Class

V1 targets NTAG213-compatible NFC Forum Type 2 tags because they are inexpensive and align with TigerTag-style memory assumptions. NTAG215 and NTAG216 may be supported later as larger-capacity variants.

Baseline assumptions:

- Usable user memory: 144 bytes.
- Page size: 4 bytes.
- User memory pages: 4 through 39.
- Tag must be readable and writable by the iOS app through native NFC APIs.

### 7.2 Compatibility Intent

FilamentBridge should use a TigerTag-compatible core where practical:

- Use compact page-oriented binary payloads rather than large JSON.
- Include material, color, diameter, weight, temperature, drying, timestamp, and metadata fields where they fit.
- Reserve a signature/check region inspired by TigerTag's signature-oriented layout.
- Avoid claiming official TigerTag authenticity unless a tag was actually issued by TigerTag.

### 7.3 FilamentBridge V1 Payload

The exact byte layout may be finalized during implementation, but it must fit within NTAG213 user memory and include:

- Magic/version bytes identifying `FilamentBridge`.
- `instance_id`: stable identifier for the self-hosted instance.
- `tag_id`: app-level tag identifier.
- `spool_id`: compact server spool reference.
- Material code or local catalog code.
- Diameter code.
- Color RGBA or RGB value.
- Remaining weight snapshot.
- Recommended nozzle temperature range.
- Drying temperature and time.
- Last-written timestamp.
- Payload hash.
- Self-issued signature/check value.

The payload must include enough data for the mobile app to show a useful offline spool summary even when the server is unreachable.

### 7.4 Self-Issued Signing

The server creates and manages a local signing identity for app-owned tags.

Requirements:

- Generate an instance signing key during setup.
- Store private signing material securely.
- Include a `public_key_id` in tag metadata.
- Verify app-owned tags during scans.
- Mark unverifiable tags as `foreign`, `stale`, or `invalid`, not as trusted.
- Allow key rotation while preserving verification of historical tags where possible.

This signing proves that a tag was written by this FilamentBridge instance. It does not prove official TigerTag or Bambu authenticity.

### 7.5 Tag Write Rules

- The iOS app may assign blank tags, rewrite app-owned tags, and retire app-owned tags.
- Writing must require an explicit user action.
- If the app detects a foreign tag, it must show a warning before overwrite.
- The server must reject stale writes unless the mobile app reconciles first or the user explicitly resolves the conflict.
- Tags should not be permanently locked in v1.

## 8. Bambu Integration

### 8.1 Integration Stance

FilamentBridge is a companion inventory system for Bambu printers. It observes and reconciles printer and AMS state; it does not attempt to become Bambu firmware, replace official RFID, or bypass official security features.

### 8.2 Connection Model

The v1 connector should support local network registration with:

- Printer IP address or hostname.
- Printer serial number or stable identifier, stored as a hash where possible.
- LAN access code or equivalent local credential stored as a secret.
- Optional manual model/family selection.

The connector may use locally available protocols exposed by Bambu printers where supported. Because Bambu firmware and local-access behavior can change, the connector must be capability-driven and fail gracefully.

FilamentBridge runs a lightweight MQTT connection server for Bambu LAN and VPN-LAN modes. This service is not a general-purpose MQTT broker and must not expose an unauthenticated public MQTT listener; it owns outbound TLS MQTT client sessions to the configured printer host on port 8883, subscribes only to the exact `device/<id>/report` topic, and publishes only the safe observational `device/<id>/request` push-all request when a snapshot is needed.

The MQTT connection server should coalesce concurrent requests for the same printer, cache successful sanitized snapshots only briefly, clear in-flight sessions on shutdown, and surface connection errors as printer telemetry warnings instead of blocking normal inventory or NFC workflows.

### 8.3 Compatibility Matrix

The implementation must maintain a dated compatibility matrix. Seed matrix as of 2026-05-15:

| Printer family | Material system target | V1 capability target | Notes |
| --- | --- | --- | --- |
| X1C / X1E | AMS, AMS 2 Pro, AMS HT where supported | `supported` or `read_only` | Prioritize slot observation and job usage review. |
| P1S / P1P | AMS, AMS 2 Pro, AMS HT where supported | `supported` or `read_only` | Prioritize common home AMS workflows. |
| P2S | AMS 2 Pro, AMS HT where supported | `supported` or `read_only` | Treat as a first-class modern P-series target. |
| A1 / A1 mini | AMS Lite, later AMS variants where supported | `read_only` or `manual_only` | Different spool handling and AMS Lite behavior must be represented. |
| H2D / H2S | AMS 2 Pro, AMS HT, external paths | `read_only` first | Larger-format and multi-path workflows need explicit testing. |
| X2D | AMS 2 Pro or current supported feeder paths | `manual_only` until verified | Newer model; refresh official docs before implementation. |
| H2C | AMS 2 Pro, AMS HT, multi-nozzle paths | `manual_only` until verified | Regional availability and multi-nozzle behavior require separate validation. |
| Unknown or future model | Unknown | `manual_only` | Allow inventory use without printer telemetry. |

Capability meanings:

- `supported`: connector can observe printer state, slot state, and completed-job usage with acceptance tests.
- `read_only`: connector can observe useful state but usage inference or slot details are incomplete.
- `manual_only`: user can create printer and slot records manually; no reliable telemetry is assumed.
- `unsupported`: app should not offer connection setup for this model.

### 8.4 AMS Slot Sync

The connector should attempt to observe:

- Printer online/offline state.
- Print state.
- Job identifier or file identifier where available.
- AMS unit count and slot count.
- Slot loaded/empty state.
- Slot material type.
- Slot color.
- Remaining percentage or other estimate if available.
- Active feeding slot.
- External spool path if exposed or user-configured.

The app must separate detected slot state from user-confirmed spool mapping.

### 8.5 Usage Events From Print Jobs

When a completed job can be associated with a slot and estimated filament usage:

1. Create a `UsageEvent` with `review_status = pending`.
2. Include job name or identifier if available.
3. Include printer, slot, mapped spool, estimated weight delta, and confidence.
4. Show the event in the web UI and mobile app review queue.
5. Apply it to spool remaining weight only after approval, edit, or configured auto-approval.
6. If estimated remaining filament is below the job estimate, show an explicit low-filament warning before approval or auto-approval.

If the job uses multiple slots, create one usage event per spool where usage can be separated. If usage cannot be separated, create one review item with a conflict warning.

### 8.6 Official Bambu RFID Boundary

FilamentBridge must include this boundary in user-facing settings and developer docs:

- Genuine Bambu RFID data may appear as printer-observed context.
- FilamentBridge-owned NFC companion tags are separate from Bambu RFID.
- The app must not generate tags intended to pass as official Bambu filament.
- The app must not instruct users to bypass Bambu signatures or firmware checks.

- Open smart-spool tag formats may be read or written only for app-owned/non-Bambu tags and only when the format does not claim official Bambu authenticity.
## 9. API Surface

The API may be REST, GraphQL, RPC, or a hybrid, but it must support the following behavior. Endpoint names below are normative if REST is chosen.

### 9.1 Authentication And Pairing

- `POST /api/auth/login`
- `POST /api/auth/logout`
- `POST /api/devices/pairing/start`
- `POST /api/devices/pairing/complete`
- `GET /api/devices`
- `POST /api/devices/{id}/revoke`

Requirements:

- First-run setup creates the owner account.
- iOS pairing must work on a home LAN without public internet.
- Tokens must be revocable.

### 9.2 Inventory

- `GET /api/spools`
- `POST /api/spools`
- `GET /api/spools/{id}`
- `PATCH /api/spools/{id}`
- `POST /api/spools/{id}/retire`
- `POST /api/spools/{id}/delete`
- `GET /api/catalog-items`
- `POST /api/catalog-items`
- `PATCH /api/catalog-items/{id}`
- `POST /api/catalog-items/{id}/delete`
- `POST /api/catalog/import`
- `GET /api/catalog/export`

Requirements:

- Mutations must enforce optimistic concurrency.
- Weight changes must be event-backed.
- User removals are soft deletes that preserve audit/export history.
- Catalog item deletion must be rejected while active spools still reference that catalog item.
- Spool deletion must retire active app-owned tag assignments and clear active printer slot mappings.

### 9.3 NFC Tags

- `POST /api/nfc/scan`
- `POST /api/nfc/assign`
- `POST /api/nfc/write-payload`
- `POST /api/nfc/verify`
- `POST /api/nfc/retire`

Requirements:

- `write-payload` returns a compact payload and signature/check value for the iOS app to write.
- `scan` accepts decoded payload, payload hash, tag UID hash, and scan metadata.
- The server marks stale tags when the spool has changed since the tag was last written.

### 9.4 Sync

- `POST /api/sync/events`
- `GET /api/sync/events`
- `POST /api/sync/events/{id}/resolve`

Requirements:

- Offline clients submit queued events in original local order.
- Server responses must include applied, rejected, and conflict results.
- Conflict responses must include enough context for a client to show a resolution UI.

### 9.5 Printers And Slots

- `GET /api/printers`
- `POST /api/printers`
- `PATCH /api/printers/{id}`
- `POST /api/printers/{id}/delete`
- `POST /api/printers/{id}/test-connection`
- `GET /api/printers/{id}/slots`
- `PATCH /api/printer-slots/{id}/mapping`
- `POST /api/printers/{id}/sync-now`

Requirements:

- Printer deletion must soft-delete active slots for that printer and preserve historical usage events.
- Test connection must report capability level and failure reason.
- Slot mapping must be user-confirmed.
- Manual-only printers must still support slot records.

### 9.6 Usage Review

- `GET /api/usage-events?review_status=pending`
- `POST /api/usage-events/{id}/approve`
- `POST /api/usage-events/{id}/edit-and-approve`
- `POST /api/usage-events/{id}/reject`
- `POST /api/usage-events/adjustment`

Requirements:

- Approval must update spool remaining weight atomically.
- Rejected and edited events remain in history.
- Events should expose estimated material cost when spool purchase price is available, without making cost required for weight accounting.

### 9.7 Labels And Lookup

- `GET /api/labels/templates`
- `POST /api/labels/templates`
- `PATCH /api/labels/templates/{id}`
- `POST /api/labels/render`
- `GET /api/spools/lookup?code={short_code_or_label_code}`

Requirements:

- Rendered labels must support at least QR codes and human-readable short codes.
- Label rendering must not call a cloud service.
- Lookup by short code or label code must require authentication and return the same spool authorization checks as `GET /api/spools/{id}`.

## 10. Sync And Conflict Rules

### 10.1 Mobile Offline Behavior

- The iOS app must keep a local queue of scans, manual edits, and tag write intents.
- The app must show when data is offline, pending sync, synced, or conflicted.
- The app may display tag snapshot data offline.
- The app must not claim a tag rewrite is authoritative until the server confirms it.

### 10.2 Server Reconciliation

- The server applies events only if the incoming entity version matches or can be safely merged.
- Manual user edits take priority over printer-observed data.
- Printer-observed data creates pending events or warnings.
- Tag snapshot data never overwrites newer server data automatically.

### 10.3 Conflict Examples

- A tag says a spool has 650 g remaining, but the server has an approved event showing 590 g.
- A mobile device rewrites a tag while another client retires the spool.
- A printer slot reports PLA blue, but the user mapped the slot to PETG black.
- A completed job uses a slot with no mapped spool.

Each conflict must be visible and resolvable without losing the original event.

## 11. User Interface Requirements

### 11.1 Web UI

Required screens:

- First-run setup.
- Dashboard with inventory health, printer status, and pending reviews.
- Spool list with filters by material, color, status, location, and printer slot.
- Spool detail with tag status, weight history, usage events, and notes.
- Catalog management.
- Printer setup and connection test.
- AMS/slot mapping view.
- Usage event review queue.
- NFC tag audit view.
- Label template and print/export view.
- Backup/export settings.
- Security and device settings.

### 11.2 iOS App

Required screens:

- Server pairing.
- Scan tag.
- Assign blank tag.
- Spool summary.
- Manual weight adjustment.
- Rewrite stale tag.
- Offline queue.
- Conflict review basics.

Required NFC states:

- Blank tag detected.
- App-owned valid tag detected.
- App-owned stale tag detected.
- Foreign or unknown tag detected.
- Invalid signature/check detected.
- Write succeeded.
- Write failed.
- QR/barcode label scan found a spool.
- QR/barcode label scan did not match any active spool.

## 12. Deployment And Operations

### 12.1 Docker Compose

V1 must support Docker Compose on a home LAN. The deployment should include:

- Server/API container.
- Web UI container or server-bundled web assets.
- Database container or documented external database.
- Background worker process if separate.
- Persistent volumes for database, uploads/imports, and backups.

### 12.2 Configuration

Required configuration:

- Base URL for LAN access.
- Optional Tailscale/private network URL.
- Database location.
- Secret key material location.
- Backup location.
- Printer connector enabled/disabled.
- MQTT connection server enabled/disabled with the printer connector.
- Allowed origins for web and mobile clients.

### 12.3 Backup And Restore

The system must document and test:

- Full database backup.
- Signing key backup.
- Restore to a fresh instance.
- Behavior when restoring without signing keys.
- Export of inventory to a portable file.

### 12.4 Network Model

Supported:

- Same-LAN web and mobile access.
- Private remote access through Tailscale or equivalent.
- Optional reverse proxy for advanced users.

Not required for v1:

- Public HTTPS onboarding.
- Multi-tenant hosting.
- Cloud relay.

## 13. Security And Privacy

- Store printer access codes and app secrets encrypted at rest or in a documented secret store.
- Never log raw printer access codes, auth tokens, signing private keys, or full tag UID values.
- Use salted hashes for tag UIDs and printer serials unless raw values are explicitly needed.
- Require authentication for web and API access after first-run setup.
- Support device revocation.
- Bind mobile pairing to an authenticated user.
- Keep all default operation local-first and cloud-independent.
- Document that FilamentBridge signing is local authenticity only.

## 14. Slicer Integration

V1 should include basic Bambu Studio and Orca Slicer alignment without making slicer integration a launch blocker.

Required:

- Store Bambu Studio and Orca preset names on catalog items.
- Import and export catalog data in a documented local format.
- Store flow ratio, pressure advance, max volumetric speed, shrinkage, support/soluble flags, and nozzle requirement metadata when users maintain those values locally.
- Allow users to manually copy preset names and material settings.

Later:

- Parse slicer preset files.
- Export presets directly.
- Import job metadata for usage review.
- Import/export calibration-relevant filament profile metadata where the format is documented and locally accessible.
- Match printed job material assignments to spool records with higher confidence.

## 15. Acceptance Tests

### 15.1 NFC

- Assign a blank NFC tag to a spool from the iOS app.
- Scan the tag and display spool identity, material, color, and remaining weight.
- Update spool data on the server and mark the tag as stale on next scan.
- Rewrite the stale tag from the iOS app.
- Detect a foreign tag and require explicit confirmation before overwrite.
- Verify an app-owned tag signature/check value.

### 15.2 Offline Sync

- Pair the iOS app on LAN.
- Disconnect from the server.
- Scan a valid tag and create a manual weight adjustment.
- Reconnect.
- Submit queued events.
- Confirm the server applies, rejects, or flags conflicts without silent data loss.

### 15.3 Inventory

- Create catalog item.
- Create spool from catalog item.
- Manually adjust remaining weight.
- Retire spool.
- Export inventory.
- Restore inventory into a fresh instance.

### 15.4 Bambu AMS Companion Sync

- Register a Bambu printer with local access details.
- Test connection and report capability level.
- Detect or manually create AMS/external slots.
- Map a slot to a FilamentBridge spool.
- Show slot state in the web UI.
- Detect a completed job where telemetry is available.
- Create a pending usage event.
- Approve the usage event and update remaining spool weight.
- Warn before approval or auto-approval when estimated usage exceeds the mapped spool's remaining weight.

### 15.5 Boundary Tests

- Confirm there is no UI path that writes Bambu-format RFID tags.
- Confirm documentation states that Bambu RFID cloning/forging is out of scope.
- Confirm app-owned NFC tags remain separate companion tags.
- Confirm printer telemetry failures do not block normal inventory and NFC workflows.
- Confirm QR/barcode labels identify local spools but do not authenticate app-owned NFC payloads.

### 15.6 Deployment

- Start the app with Docker Compose on a clean machine.
- Complete first-run setup.
- Pair an iOS client over LAN.
- Access the web UI through a Tailscale/private network URL.
- Back up and restore the database and signing keys.

## 16. Implementation Defaults

Because this specification is framework-neutral, implementation agents must choose concrete technologies separately. The following defaults should guide those choices:

- Prefer boring, self-hostable components.
- Prefer a relational database for inventory, event history, and sync consistency.
- Keep the API documented and client-independent.
- Keep mobile NFC logic native enough to support low-level read/write needs.
- Keep Bambu connector logic isolated behind capability interfaces.
- Keep printer protocol assumptions replaceable.
- Keep all source files and docs publish-safe by default.

## 17. Open Questions For Implementation

These questions should be resolved before app code begins:

- Which backend framework and database will be used?
- Which iOS framework will be used for NFC and local queueing?
- Should the first web UI be server-rendered, SPA, or hybrid?
- Which exact Bambu local protocol library or implementation will be used, if any?
- What is the final byte-level NFC payload layout?
- What encryption or secret-storage mechanism will be used for a Docker Compose home deployment?
- What import/export format should be used for catalog and inventory portability?

## 18. Source Anchors

Official and primary references:

- TigerTag memory layout: https://doc.tigertag.io/docs/format/layout/
- TigerTag NTAG213 notes: https://doc.tigertag.io/docs/getting-started/ntag213/
- Apple Core NFC: https://developer.apple.com/documentation/corenfc
- MDN Web NFC API: https://developer.mozilla.org/en-US/docs/Web/API/Web_NFC_API
- Bambu Lab AMS comparison: https://bambulab.com/en-us/compare/ams
- Bambu Lab P2S official store page: https://us.store.bambulab.com/products/p2s
- Bambu Lab P1S official store page: https://us.store.bambulab.com/en/products/p1s
- Bambu Lab X1C official store page: https://us.store.bambulab.com/products/x1-carbon
- Bambu Lab A1 official store page: https://us.store.bambulab.com/products/A1/
- Bambu Lab H2D official store page: https://us.store.bambulab.com/collections/3d-printer/products/h2d
- Bambu Lab H2S official store page: https://us.store.bambulab.com/products/h2s
- Bambu Lab X2D announcement: https://blog.bambulab.com/xcellence-made-simple-bambu-lab-presents-the-x2d/

- Bambu Handy App Store listing: https://apps.apple.com/us/app/bambu-handy/id1625671285

Unofficial implementation and research references:

- PrintHQ Bambu LAN notes: https://printhq.io/docs/printers/bambu-lab
- Bambu RFID Tag Guide: https://github.com/Bambu-Research-Group/RFID-Tag-Guide
- Spoolman: https://github.com/Donkie/Spoolman
- OctoPrint-FilamentManager: https://github.com/OllisGit/OctoPrint-FilamentManager
- SimplyPrint label generator: https://help.simplyprint.io/en/article/the-filament-label-generator-feature-organize-your-filament-inventory-fh6shk/
- SimplyPrint spool assignment: https://help.simplyprint.io/en/article/assigning-filament-spools-to-printers-1r66t1p/
- OpenPrintTag: https://openprinttag.org/
- Bambu Studio: https://github.com/bambulab/BambuStudio
- OrcaSlicer: https://github.com/OrcaSlicer/OrcaSlicer
- OrcaSlicer material settings: https://www.orcaslicer.com/wiki/material_settings/filament/material_basic_information
- OrcaSlicer calibration guide: https://www.orcaslicer.com/wiki/calibration_guide

Unofficial references are useful for feasibility research, but they are not vendor contracts. Any implementation based on them must be capability-gated, tested against real hardware, and documented as best-effort.
