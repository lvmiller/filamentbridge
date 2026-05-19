# FilamentBridge

FilamentBridge is a self-hosted, local-first filament inventory system for Bambu Lab printer workflows. It tracks filament catalog entries, physical spools, companion NFC tags, QR/barcode labels, printer/AMS slot mappings, usage review events, device pairing, exports, and backups.

FilamentBridge is not a Bambu RFID cloning tool:

> FilamentBridge writes only FilamentBridge-owned companion NFC tags. It does not clone, forge, emulate, modify, or bypass official Bambu RFID tags or signatures.

## Repository status

This repository is an early v0.1 implementation of the product described in [`SPEC.md`](./SPEC.md). The core stack is present:

- Fastify API server with Swagger UI.
- SQLite-backed repository using Node's `node:sqlite` API.
- React/Vite web UI for inventory, catalog, printer setup, usage review, NFC audit, labels, backups, and device security.
- SwiftUI iOS package for LAN pairing, NFC scan/write flows, label lookup, manual adjustments, stale tag rewrites, offline queueing, and conflict review.
- Shared TypeScript schemas, invariants, API types, NFC payload layout helpers, and a small fetch client.
- Crypto helpers for local instance identity, Ed25519 NFC payload signatures, salted hashes, token generation, and encrypted local secrets.
- Bambu LAN MQTT connector that observes printer reports and strips RFID-adjacent fields from captured data.

## Source layout

```text
.
├── apps/
│   ├── server/              # Fastify API and static web serving
│   ├── web/                 # React/Vite admin UI
│   └── ios/                 # Swift Package for the iOS app
├── packages/
│   ├── shared/              # Zod schemas, shared types, NFC layout, API client
│   ├── crypto/              # Signing, hashing, local secret encryption
│   ├── db/                  # SQLite schema and repository
│   └── printer-connector/   # Bambu LAN MQTT/manual connector layer
├── tests/                   # Cross-cutting boundary, iOS layout, and smoke tests
├── tools/                   # Utility checks
├── scripts/                 # Build helpers
├── docker-compose.yml       # Self-hosted local deployment
├── Dockerfile               # Production container image
└── SPEC.md                  # Product and architecture specification
```

## Requirements

- Node.js 24 or newer.
- npm.
- Docker and Docker Compose for containerized deployment.
- Swift 5.10 / iOS 17-compatible tooling for the iOS package.

## Local development

Install dependencies:

```sh
npm ci
```

Start the API server:

```sh
npm run dev
```

Start the web UI in another terminal:

```sh
npm run dev:web
```

Open <http://localhost:5173>. The Vite dev server proxies `/api` and `/health` to the Fastify server on `127.0.0.1:3000`.

On first run, create the owner account from the web UI. The server creates runtime data under `./runtime` unless overridden with environment variables.

## Docker deployment

Create a local environment file and set a real application secret:

```sh
cp .env.example .env
```

Then start the service:

```sh
docker compose up --build
```

Open <http://localhost:3000>.

The compose file persists state in named volumes:

- `filamentbridge-data` for the SQLite database.
- `filamentbridge-keys` for NFC signing keys.
- `filamentbridge-backups` for backup files.

## Configuration

Common server environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `FILAMENTBRIDGE_HOST` | `0.0.0.0` | Server bind host. |
| `FILAMENTBRIDGE_PORT` / `PORT` | `3000` | Server port. |
| `FILAMENTBRIDGE_DATA_DIR` | `./runtime` | Base directory for default runtime paths. |
| `FILAMENTBRIDGE_DATABASE_PATH` | `./runtime/filamentbridge.sqlite` | SQLite database path. |
| `FILAMENTBRIDGE_KEY_DIR` | `./runtime/keys` | NFC signing-key directory. |
| `FILAMENTBRIDGE_BACKUP_DIR` | `./runtime/backups` | Backup output directory. |
| `FILAMENTBRIDGE_WEB_DIST` | `./apps/web/dist` | Built web app directory served by the API server. |
| `FILAMENTBRIDGE_APP_SECRET` | `dev-only-change-me` | Cookie signing and local secret encryption material. Change this for any persistent install. |
| `FILAMENTBRIDGE_ALLOWED_ORIGINS` | `http://localhost:5173` | Comma-separated CORS allowlist. |
| `FILAMENTBRIDGE_PRINTER_CONNECTOR_ENABLED` | `true` | Set to `false` to force the manual/mock connector. |
| `FILAMENTBRIDGE_BAMBU_MQTT_INSECURE_TLS` | `false` | Allows insecure Bambu MQTT TLS when explicitly set to `true`. |

See [`.env.example`](./.env.example) for a starting point.

## Available scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Run the Fastify server from TypeScript. |
| `npm run dev:web` | Run the Vite web UI with API proxying. |
| `npm run build` | Bundle the server and build the web UI. |
| `npm run build:web` | Build only the web UI. |
| `npm run start` | Run the built server bundle. |
| `npm run typecheck` | Type-check the TypeScript workspace. |
| `npm run lint` | Alias for `typecheck`. |
| `npm run test` | Run Vitest tests. |
| `npm run check:ios` | Validate required iOS source files and Core NFC markers. |
| `npm run smoke:docker` | Run the Docker smoke test script. |

## API and workflows

The server exposes `/health`; most application routes live under `/api` for setup, auth, device pairing, catalog, spool, label, usage-event, NFC, sync, printer, export, backup, restore, and boundary operations. Swagger UI is registered at `/docs`.

Primary workflows currently covered by code:

1. Create an owner account.
2. Create catalog items and spools.
3. Assign app-owned NFC companion tags to spools.
4. Generate and verify signed NFC payloads.
5. Scan blank, foreign, invalid, retired, stale, or valid tags.
6. Create QR/barcode label templates and render local SVG labels.
7. Register Bambu printers for LAN/VPN-LAN observational MQTT or manual mode.
8. Sync observed printer slots and create pending usage events.
9. Review, approve, edit, reject, or manually create usage events.
10. Pair iOS devices and submit offline sync events.
11. Export inventory or create/restore backups including signing keys.

## iOS app

The iOS code lives in `apps/ios` as a Swift Package named `FilamentBridgeIOS` targeting iOS 17. It contains:

- `FilamentBridgeApp.swift` for SwiftUI screens and navigation.
- `APIClient.swift` for authenticated API calls.
- `NFCService.swift` for Core NFC Type 2 tag scan/write operations.
- `NFCCodec.swift` for local NFC payload classification/encoding/decoding.
- `OfflineQueue.swift` for local manual-adjustment queueing and sync.
- `Models.swift` for API DTOs.

The web UI can create an iOS pairing code from **Security/devices**. The iOS app completes pairing against the local server URL and then uses bearer authentication for API calls.

## Data and security notes

- The server is authoritative for mutable state; NFC tags are signed portable snapshots and identity carriers.
- Official Bambu RFID data is not written, cloned, emulated, modified, or bypassed.
- Tag UIDs and printer serials are salted before storage by default.
- LAN access codes are stored as encrypted local secret references.
- Remaining filament changes are recorded through usage events or manual adjustments.
- Optimistic concurrency uses entity `version` fields and `expected_version` inputs.
- Backups can include both database export data and NFC signing keys; protect them accordingly.

## Testing

Run all tests:

```sh
npm run test
```

Run the TypeScript checker:

```sh
npm run typecheck
```

Validate iOS source layout:

```sh
npm run check:ios
```

Run the Docker smoke test:

```sh
npm run smoke:docker
```
