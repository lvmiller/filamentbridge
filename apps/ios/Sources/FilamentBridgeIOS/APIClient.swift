import Foundation

@MainActor
final class FilamentBridgeAPIClient: ObservableObject {
    @Published var baseURL: URL
    @Published var token: String?

    private let session: URLSession
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder

    init(baseURL: URL = URL(string: "http://filamentbridge.local:3000")!, token: String? = nil, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.token = token
        self.session = session
        self.encoder = JSONEncoder()
        self.decoder = JSONDecoder()
    }

    func setupStatus() async throws -> SetupStatus {
        try await get("/api/setup/status")
    }

    func completePairing(code: String, deviceName: String) async throws -> AuthSession {
        let session: AuthSession = try await post("/api/devices/pairing/complete", body: ["pairing_code": code, "device_name": deviceName, "device_type": "ios"])
        token = session.token
        return session
    }

    func spools() async throws -> [Spool] { try await get("/api/spools") }

    func assignTag(spool: Spool, tagUid: String) async throws -> NfcTag {
        struct AssignResponse: Decodable { var tag: NfcTag; var spool: Spool }
        let response: AssignResponse = try await post("/api/nfc/assign", body: ["spool_id": spool.id, "tag_uid": tagUid, "expected_spool_version": spool.version] as [String : Any])
        return response.tag
    }

    func writePayload(tag: NfcTag, spool: Spool, force: Bool) async throws -> NfcWritePayloadResult {
        try await post("/api/nfc/write-payload", body: ["tag_id": tag.id, "spool_id": spool.id, "expected_spool_version": spool.version, "force_stale_rewrite": force] as [String : Any])
    }

    func scan(tagUid: String?, encodedPayload: String?) async throws -> NfcScanResult {
        try await post("/api/nfc/scan", body: ["tag_uid": tagUid ?? NSNull(), "encoded_payload": encodedPayload ?? NSNull()])
    }

    func manualAdjustment(spool: Spool, newWeight: Int, notes: String?) async throws -> Spool {
        struct AdjustmentResponse: Decodable { var spool: Spool }
        let response: AdjustmentResponse = try await post("/api/usage-events/adjustment", body: ["spool_id": spool.id, "expected_version": spool.version, "new_remaining_weight_g": newWeight, "notes": notes ?? NSNull()] as [String : Any])
        return response.spool
    }

    func submitOfflineQueue(_ items: [OfflineQueueItem], deviceId: String) async throws -> SyncSubmissionResult {
        struct Body: Encodable { var device_id: String; var events: [OfflineQueueItem] }
        return try await postEncodable("/api/sync/events", body: Body(device_id: deviceId, events: items))
    }

    private func get<T: Decodable>(_ path: String) async throws -> T {
        var request = URLRequest(url: baseURL.appendingPathComponent(path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))))
        request.httpMethod = "GET"
        addHeaders(&request)
        return try await send(request)
    }

    private func post<T: Decodable>(_ path: String, body: Any) async throws -> T {
        var request = URLRequest(url: baseURL.appendingPathComponent(path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))))
        request.httpMethod = "POST"
        addHeaders(&request)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        return try await send(request)
    }

    private func postEncodable<T: Decodable, Body: Encodable>(_ path: String, body: Body) async throws -> T {
        var request = URLRequest(url: baseURL.appendingPathComponent(path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))))
        request.httpMethod = "POST"
        addHeaders(&request)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try encoder.encode(body)
        return try await send(request)
    }

    private func addHeaders(_ request: inout URLRequest) {
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
    }

    private func send<T: Decodable>(_ request: URLRequest) async throws -> T {
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else { throw APIError.badStatus }
        return try decoder.decode(ApiEnvelope<T>.self, from: data).data
    }

    enum APIError: Error { case badStatus }
}
