import Foundation

struct DecodedNfcPayload: Codable, Equatable {
    var version: UInt8
    var layout: UInt8
    var instanceRef: String
    var tagRef: String
    var spoolRef: String
    var materialType: String
    var diameterMm: Double
    var colorHex: String
    var remainingWeightG: Int
    var nozzleTempMinC: Int
    var nozzleTempMaxC: Int
    var dryingTempC: Int
    var dryingTimeMinutes: Int
    var writtenAtEpochSeconds: UInt32
    var publicKeyIdRef: String
    var payloadHash: String
    var signature: String

    enum CodingKeys: String, CodingKey {
        case version, layout, signature
        case instanceRef = "instance_ref"
        case tagRef = "tag_ref"
        case spoolRef = "spool_ref"
        case materialType = "material_type"
        case diameterMm = "diameter_mm"
        case colorHex = "color_hex"
        case remainingWeightG = "remaining_weight_g"
        case nozzleTempMinC = "nozzle_temp_min_c"
        case nozzleTempMaxC = "nozzle_temp_max_c"
        case dryingTempC = "drying_temp_c"
        case dryingTimeMinutes = "drying_time_minutes"
        case writtenAtEpochSeconds = "written_at_epoch_seconds"
        case publicKeyIdRef = "public_key_id_ref"
        case payloadHash = "payload_hash"
    }
}

enum FilamentBridgeNFCCodec {
    static let payloadBytes = 144
    static let signatureOffset = 69
    static let signatureLength = 64
    static let payloadHashOffset = 53
    static let payloadHashLength = 16

    static func classify(_ data: Data?) -> String {
        guard let data, !data.isEmpty, data.contains(where: { $0 != 0 }) else { return "blank" }
        guard data.count == payloadBytes else { return "foreign" }
        if data[0] == 0x46 && data[1] == 0x42 {
            return data[2] == 1 && data[3] == 1 ? "filamentbridge" : "invalid"
        }
        return "foreign"
    }

    static func decodeBase64Url(_ encoded: String) throws -> Data {
        var value = encoded.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        while value.count % 4 != 0 { value.append("=") }
        guard let data = Data(base64Encoded: value) else { throw CodecError.invalidBase64 }
        return data
    }

    static func encodeBase64Url(_ data: Data) -> String {
        data.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }

    static func decode(_ data: Data) throws -> DecodedNfcPayload {
        guard data.count == payloadBytes else { throw CodecError.invalidLength }
        guard data[0] == 0x46 && data[1] == 0x42 else { throw CodecError.foreignPayload }
        return DecodedNfcPayload(
            version: data[2],
            layout: data[3],
            instanceRef: hex(data[4..<12]),
            tagRef: hex(data[12..<20]),
            spoolRef: hex(data[20..<28]),
            materialType: materialName(code: data[28]),
            diameterMm: Double(littleEndianUInt16(data, offset: 29)) / 100.0,
            colorHex: String(format: "#%02x%02x%02x", data[31], data[32], data[33]),
            remainingWeightG: Int(littleEndianUInt16(data, offset: 34)),
            nozzleTempMinC: Int(data[36]),
            nozzleTempMaxC: Int(data[37]),
            dryingTempC: Int(data[38]),
            dryingTimeMinutes: Int(littleEndianUInt16(data, offset: 39)),
            writtenAtEpochSeconds: littleEndianUInt32(data, offset: 41),
            publicKeyIdRef: hex(data[45..<53]),
            payloadHash: hex(data[payloadHashOffset..<(payloadHashOffset + payloadHashLength)]),
            signature: hex(data[signatureOffset..<(signatureOffset + signatureLength)])
        )
    }

    private static func littleEndianUInt16(_ data: Data, offset: Int) -> UInt16 {
        UInt16(data[offset]) | (UInt16(data[offset + 1]) << 8)
    }

    private static func littleEndianUInt32(_ data: Data, offset: Int) -> UInt32 {
        UInt32(data[offset]) | (UInt32(data[offset + 1]) << 8) | (UInt32(data[offset + 2]) << 16) | (UInt32(data[offset + 3]) << 24)
    }

    private static func hex(_ bytes: Data.SubSequence) -> String {
        bytes.map { String(format: "%02x", $0) }.joined()
    }

    private static func materialName(code: UInt8) -> String {
        switch code {
        case 1: return "PLA"
        case 2: return "PETG"
        case 3: return "ABS"
        case 4: return "ASA"
        case 5: return "TPU"
        case 6: return "PA"
        case 7: return "PC"
        case 8: return "PVA"
        case 9: return "SUPPORT"
        default: return "OTHER"
        }
    }

    enum CodecError: Error { case invalidBase64, invalidLength, foreignPayload }
}
