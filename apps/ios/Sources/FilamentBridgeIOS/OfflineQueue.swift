import Foundation

@MainActor
final class OfflineQueueStore: ObservableObject {
    @Published private(set) var items: [OfflineQueueItem] = []
    @Published private(set) var conflicts: [SyncSubmissionResult.Conflict] = []

    private let fileURL: URL

    init(fileURL: URL = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("offline-queue.json")) {
        self.fileURL = fileURL
        load()
    }

    func enqueueManualAdjustment(spool: Spool, newWeight: Int, notes: String?) {
        items.append(OfflineQueueItem(
            id: UUID().uuidString,
            entityType: "spool",
            entityId: spool.id,
            eventType: "manual_adjustment",
            entityVersion: spool.version,
            localCreatedAt: ISO8601DateFormatter().string(from: Date()),
            payload: ["expected_version": String(spool.version), "new_remaining_weight_g": String(newWeight), "notes": notes ?? ""]
        ))
        save()
    }

    func enqueueTagRewriteIntent(tag: NfcTag, spool: Spool) {
        items.append(OfflineQueueItem(
            id: UUID().uuidString,
            entityType: "nfc_tag",
            entityId: tag.id,
            eventType: "rewrite_intent",
            entityVersion: tag.version,
            localCreatedAt: ISO8601DateFormatter().string(from: Date()),
            payload: ["spool_id": spool.id, "spool_version": String(spool.version)]
        ))
        save()
    }

    func sync(client: FilamentBridgeAPIClient, deviceId: String) async throws {
        guard !items.isEmpty else { return }
        let result = try await client.submitOfflineQueue(items, deviceId: deviceId)
        let appliedIds = Set(result.applied.map(\.id))
        let rejectedIds = Set(result.rejected.map(\.id))
        conflicts = result.conflicts
        items.removeAll { appliedIds.contains($0.id) || rejectedIds.contains($0.id) }
        save()
    }

    func remove(_ item: OfflineQueueItem) {
        items.removeAll { $0.id == item.id }
        save()
    }

    private func load() {
        guard let data = try? Data(contentsOf: fileURL), let decoded = try? JSONDecoder().decode([OfflineQueueItem].self, from: data) else { return }
        items = decoded
    }

    private func save() {
        if let data = try? JSONEncoder().encode(items) {
            try? data.write(to: fileURL, options: [.atomic])
        }
    }
}
