import SwiftUI
import UIKit

@main
struct FilamentBridgeApp: App {
    @StateObject private var client = FilamentBridgeAPIClient()
    @StateObject private var nfc = NFCService()
    @StateObject private var queue = OfflineQueueStore()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(client)
                .environmentObject(nfc)
                .environmentObject(queue)
        }
    }
}

struct RootView: View {
    @EnvironmentObject private var client: FilamentBridgeAPIClient
    @State private var session: AuthSession?
    @State private var spools: [Spool] = []
    @State private var selectedSpool: Spool?
    @State private var statusText = ""

    var body: some View {
        NavigationStack {
            List {
                Section("Boundary") { Text(officialRfidBoundary).font(.footnote) }
                if session == nil {
                    PairingView(session: $session)
                } else {
                    NavigationLink("Scan tag") { ScanTagView(spools: $spools) }
                    NavigationLink("Scan label") { LabelLookupView(selectedSpool: $selectedSpool) }
                    NavigationLink("Assign blank tag") { AssignTagView(spools: $spools) }
                    NavigationLink("Spool summary") { SpoolSummaryView(spools: $spools, selectedSpool: $selectedSpool) }
                    NavigationLink("Manual weight adjustment") { ManualAdjustmentView(spool: $selectedSpool) }
                    NavigationLink("Rewrite stale tag") { StaleRewriteView(spool: $selectedSpool) }
                    NavigationLink("Offline queue") { OfflineQueueView(deviceId: session?.device.id ?? "") }
                    NavigationLink("Conflict review") { ConflictReviewView() }
                }
            }
            .navigationTitle("FilamentBridge")
            .toolbar { Button("Refresh") { Task { await refresh() } } }
            .task { await refresh() }
        }
    }

    private func refresh() async {
        do {
            spools = try await client.spools()
            selectedSpool = selectedSpool ?? spools.first
            statusText = "Loaded"
        } catch {
            statusText = error.localizedDescription
        }
    }
}

struct PairingView: View {
    @EnvironmentObject private var client: FilamentBridgeAPIClient
    @Binding var session: AuthSession?
    @State private var baseURL = "http://filamentbridge.local:3000"
    @State private var pairingCode = ""
    @State private var message = "Pair over the same LAN; no public internet is required."

    var body: some View {
        Section("Server pairing") {
            TextField("Server URL", text: $baseURL).textInputAutocapitalization(.never).keyboardType(.URL)
            TextField("Pairing code", text: $pairingCode).textInputAutocapitalization(.characters)
            Button("Complete pairing") {
                Task {
                    do {
                        client.baseURL = URL(string: baseURL)!
                        session = try await client.completePairing(code: pairingCode, deviceName: UIDevice.current.name)
                        message = "Paired"
                    } catch { message = error.localizedDescription }
                }
            }
            Text(message).font(.footnote)
        }
    }
}

struct ScanTagView: View {
    @EnvironmentObject private var client: FilamentBridgeAPIClient
    @EnvironmentObject private var nfc: NFCService
    @Binding var spools: [Spool]
    @State private var result: NfcScanResult?

    var body: some View {
        Form {
            Text("Blank, app-owned valid, stale, foreign, and invalid signature states are handled by the server.")
            Button("Scan companion tag") { nfc.beginScan() }
            if let uid = nfc.lastUID { Text("UID hash source: \(uid)") }
            if let payload = nfc.lastPayload {
                Button("Submit scan") {
                    Task { result = try? await client.scan(tagUid: nfc.lastUID, encodedPayload: payload) }
                }
            }
            if let result { Text(result.message); if let spool = result.spool { Text("\(spool.displayName): \(spool.remainingFilamentWeightG) g") } }
        }.navigationTitle("Scan tag")
    }
}

struct LabelLookupView: View {
    @EnvironmentObject private var client: FilamentBridgeAPIClient
    @Binding var selectedSpool: Spool?
    @State private var code = ""
    @State private var message = "QR/barcode label scan found a spool or reported no active match. Enter the short code printed on a local label."

    var body: some View {
        Form {
            TextField("Short code or label code", text: $code).textInputAutocapitalization(.characters)
            Button("Lookup label") {
                Task {
                    do {
                        let spool = try await client.lookupSpool(code: code)
                        selectedSpool = spool
                        message = "Found \(spool.displayName)"
                    } catch {
                        message = "QR/barcode label scan did not match any active spool."
                    }
                }
            }
            Text(message).font(.footnote)
        }.navigationTitle("Scan label")
    }
}

struct AssignTagView: View {
    @EnvironmentObject private var client: FilamentBridgeAPIClient
    @EnvironmentObject private var nfc: NFCService
    @Binding var spools: [Spool]
    @State private var selectedSpoolId = ""
    @State private var message = ""

    var body: some View {
        Form {
            Picker("Spool", selection: $selectedSpoolId) { ForEach(spools) { spool in Text(spool.displayName).tag(spool.id) } }
            Button("Detect blank tag") { nfc.beginScan() }
            Button("Assign detected blank companion tag") {
                Task {
                    guard let spool = spools.first(where: { $0.id == selectedSpoolId || selectedSpoolId.isEmpty }), let uid = nfc.lastUID else { return }
                    do { _ = try await client.assignTag(spool: spool, tagUid: uid); message = "Assigned" } catch { message = error.localizedDescription }
                }
            }
            Text(message)
        }.navigationTitle("Assign tag")
    }
}

struct SpoolSummaryView: View {
    @Binding var spools: [Spool]
    @Binding var selectedSpool: Spool?

    var body: some View {
        List(spools) { spool in
            Button {
                selectedSpool = spool
            } label: {
                VStack(alignment: .leading) {
                    Text(spool.displayName).font(.headline)
                    Text("\(spool.materialType) · \(spool.remainingFilamentWeightG) g · \(spool.status)")
                }
            }
        }.navigationTitle("Spool summary")
    }
}

struct ManualAdjustmentView: View {
    @EnvironmentObject private var client: FilamentBridgeAPIClient
    @EnvironmentObject private var queue: OfflineQueueStore
    @Binding var spool: Spool?
    @State private var grams = ""
    @State private var message = ""

    var body: some View {
        Form {
            if let spool {
                Text(spool.displayName)
                TextField("Remaining grams", text: $grams).keyboardType(.numberPad)
                Button("Submit now") {
                    Task { do { _ = try await client.manualAdjustment(spool: spool, newWeight: Int(grams) ?? spool.remainingFilamentWeightG, notes: "iOS manual adjustment"); message = "Applied" } catch { queue.enqueueManualAdjustment(spool: spool, newWeight: Int(grams) ?? spool.remainingFilamentWeightG, notes: "Queued offline"); message = "Queued offline" } }
                }
            } else { Text("Select a spool first.") }
            Text(message)
        }.navigationTitle("Manual adjustment")
    }
}

struct StaleRewriteView: View {
    @EnvironmentObject private var client: FilamentBridgeAPIClient
    @EnvironmentObject private var nfc: NFCService
    @Binding var spool: Spool?
    @State private var tag: NfcTag?
    @State private var message = ""

    var body: some View {
        Form {
            Text("Rewrite requires explicit user action. Foreign tags warn before overwrite.")
            Button("Scan stale tag") { nfc.beginScan() }
            Button("Generate and write refreshed payload") {
                Task {
                    guard let tag, let spool else { message = "Scan a known stale tag first"; return }
                    do { let payload = try await client.writePayload(tag: tag, spool: spool, force: true); try nfc.beginWrite(encodedPayload: payload.encodedPayload); message = "Ready to write" } catch { message = error.localizedDescription }
                }
            }
            Text(message)
        }.navigationTitle("Rewrite stale tag")
    }
}

struct OfflineQueueView: View {
    @EnvironmentObject private var client: FilamentBridgeAPIClient
    @EnvironmentObject private var queue: OfflineQueueStore
    var deviceId: String

    var body: some View {
        List {
            ForEach(queue.items) { item in Text("\(item.eventType) · \(item.entityId)") }
            Button("Sync queue") { Task { try? await queue.sync(client: client, deviceId: deviceId) } }
        }.navigationTitle("Offline queue")
    }
}

struct ConflictReviewView: View {
    @EnvironmentObject private var queue: OfflineQueueStore

    var body: some View {
        List(queue.conflicts, id: \.id) { conflict in
            VStack(alignment: .leading) { Text(conflict.id).font(.headline); Text(conflict.reason) }
        }.navigationTitle("Conflict review")
    }
}
