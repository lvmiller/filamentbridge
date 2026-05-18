import Foundation

let officialRfidBoundary = "FilamentBridge writes only FilamentBridge-owned companion NFC tags. It does not clone, forge, emulate, modify, or bypass official Bambu RFID tags or signatures."

struct SetupStatus: Codable, Equatable {
    var configured: Bool
    var instanceId: String?
    var boundary: String

    enum CodingKeys: String, CodingKey {
        case configured
        case instanceId = "instance_id"
        case boundary
    }
}

struct AuthSession: Codable, Equatable {
    var token: String
    var user: User
    var device: Device
}

struct User: Codable, Equatable, Identifiable {
    var id: String
    var email: String
    var displayName: String
    var role: String

    enum CodingKeys: String, CodingKey {
        case id, email, role
        case displayName = "display_name"
    }
}

struct Device: Codable, Equatable, Identifiable {
    var id: String
    var userId: String
    var deviceType: String
    var name: String
    var pairedAt: String
    var lastSeenAt: String?
    var trusted: Bool
    var revokedAt: String?

    enum CodingKeys: String, CodingKey {
        case id, name, trusted
        case userId = "user_id"
        case deviceType = "device_type"
        case pairedAt = "paired_at"
        case lastSeenAt = "last_seen_at"
        case revokedAt = "revoked_at"
    }
}

struct Spool: Codable, Equatable, Identifiable {
    var id: String
    var displayName: String
    var materialType: String
    var colorHex: String
    var remainingFilamentWeightG: Int
    var version: Int
    var status: String
    var activeTagId: String?
    var shortCode: String?

    enum CodingKeys: String, CodingKey {
        case id, version, status
        case displayName = "display_name"
        case materialType = "material_type"
        case colorHex = "color_hex"
        case remainingFilamentWeightG = "remaining_filament_weight_g"
        case activeTagId = "active_tag_id"
        case shortCode = "short_code"
    }
}

struct NfcTag: Codable, Equatable, Identifiable {
    var id: String
    var assignedSpoolId: String?
    var status: String
    var lastPayloadHash: String?
    var writeCount: Int
    var version: Int

    enum CodingKeys: String, CodingKey {
        case id, status, version
        case assignedSpoolId = "assigned_spool_id"
        case lastPayloadHash = "last_payload_hash"
        case writeCount = "write_count"
    }
}

struct NfcScanResult: Codable, Equatable {
    var classification: String
    var tag: NfcTag?
    var spool: Spool?
    var decoded: DecodedNfcPayload?
    var message: String
}

struct NfcWritePayloadResult: Codable, Equatable {
    var tag: NfcTag
    var spool: Spool
    var encodedPayload: String
    var payloadHash: String
    var publicKeyId: String
    var writeCount: Int
    var boundary: String

    enum CodingKeys: String, CodingKey {
        case tag, spool, boundary
        case encodedPayload = "encoded_payload"
        case payloadHash = "payload_hash"
        case publicKeyId = "public_key_id"
        case writeCount = "write_count"
    }
}

struct SyncSubmissionResult: Codable, Equatable {
    struct Rejected: Codable, Equatable { var id: String; var reason: String }
    struct Conflict: Codable, Equatable { var id: String; var reason: String }
    var applied: [SyncEvent]
    var rejected: [Rejected]
    var conflicts: [Conflict]
}

struct SyncEvent: Codable, Equatable, Identifiable {
    var id: String
    var entityType: String
    var entityId: String
    var eventType: String
    var status: String

    enum CodingKeys: String, CodingKey {
        case id, status
        case entityType = "entity_type"
        case entityId = "entity_id"
        case eventType = "event_type"
    }
}

struct OfflineQueueItem: Codable, Equatable, Identifiable {
    var id: String
    var entityType: String
    var entityId: String
    var eventType: String
    var entityVersion: Int
    var localCreatedAt: String
    var payload: [String: String]

    enum CodingKeys: String, CodingKey {
        case id, payload
        case entityType = "entity_type"
        case entityId = "entity_id"
        case eventType = "event_type"
        case entityVersion = "entity_version"
        case localCreatedAt = "local_created_at"
    }
}

struct ApiEnvelope<T: Decodable>: Decodable {
    var data: T
}
