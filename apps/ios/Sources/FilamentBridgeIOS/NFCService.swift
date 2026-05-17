import Foundation
import CoreNFC

@MainActor
final class NFCService: NSObject, ObservableObject, NFCTagReaderSessionDelegate {
    @Published var state: String = "idle"
    @Published var lastUID: String?
    @Published var lastPayload: String?
    @Published var pendingWritePayload: Data?

    private var session: NFCTagReaderSession?

    func beginScan() {
        state = "scanning"
        let session = NFCTagReaderSession(pollingOption: [.iso14443], delegate: self, queue: nil)
        session.alertMessage = "Hold iPhone near a FilamentBridge companion NFC tag."
        self.session = session
        session.begin()
    }

    func beginWrite(encodedPayload: String) throws {
        pendingWritePayload = try FilamentBridgeNFCCodec.decodeBase64Url(encodedPayload)
        state = "waiting_to_write"
        beginScan()
    }

    nonisolated func tagReaderSessionDidBecomeActive(_ session: NFCTagReaderSession) {}

    nonisolated func tagReaderSession(_ session: NFCTagReaderSession, didInvalidateWithError error: Error) {
        Task { @MainActor in self.state = "failed: \(error.localizedDescription)" }
    }

    nonisolated func tagReaderSession(_ session: NFCTagReaderSession, didDetect tags: [NFCTag]) {
        guard let first = tags.first else { return }
        session.connect(to: first) { error in
            if let error {
                session.invalidate(errorMessage: error.localizedDescription)
                return
            }
            Task { @MainActor in
                switch first {
                case .miFare(let tag):
                    self.lastUID = tag.identifier.map { String(format: "%02x", $0) }.joined()
                    if let pending = self.pendingWritePayload {
                        self.writeType2Payload(pending, to: tag, session: session)
                    } else {
                        self.readType2Payload(from: tag, session: session)
                    }
                default:
                    self.state = "foreign"
                    session.invalidate(errorMessage: "Unsupported tag type. FilamentBridge targets NTAG213-compatible NFC Forum Type 2 companion tags.")
                }
            }
        }
    }

    private func readType2Payload(from tag: NFCMiFareTag, session: NFCTagReaderSession) {
        readPageSequence(startPage: 4, chunks: 9, from: tag, accumulated: Data()) { [weak self] result in
            guard let self else { return }
            switch result {
            case .success(let data):
                let payload = data.prefix(FilamentBridgeNFCCodec.payloadBytes)
                self.lastPayload = FilamentBridgeNFCCodec.encodeBase64Url(Data(payload))
                self.state = FilamentBridgeNFCCodec.classify(Data(payload))
                session.alertMessage = "Tag read."
                session.invalidate()
            case .failure(let error):
                self.state = "read_failed"
                session.invalidate(errorMessage: error.localizedDescription)
            }
        }
    }

    private func writeType2Payload(_ payload: Data, to tag: NFCMiFareTag, session: NFCTagReaderSession) {
        guard payload.count == FilamentBridgeNFCCodec.payloadBytes else {
            session.invalidate(errorMessage: "Invalid FilamentBridge payload length.")
            return
        }
        writePages(payload, startPage: 4, to: tag) { [weak self] result in
            switch result {
            case .success:
                self?.state = "write_succeeded"
                session.alertMessage = "FilamentBridge companion tag written."
                session.invalidate()
            case .failure(let error):
                self?.state = "write_failed"
                session.invalidate(errorMessage: error.localizedDescription)
            }
        }
    }

    private func readPage(_ page: UInt8, from tag: NFCMiFareTag, completion: @escaping (Result<Data, Error>) -> Void) {
        let command = Data([0x30, page])
        tag.sendMiFareCommand(commandPacket: command) { data, error in
            if let error { completion(.failure(error)) } else { completion(.success(data)) }
        }
    }

    private func writePages(_ payload: Data, startPage: UInt8, to tag: NFCMiFareTag, completion: @escaping (Result<Void, Error>) -> Void) {
        let pages = stride(from: 0, to: payload.count, by: 4).map { payload[$0..<min($0 + 4, payload.count)] }
        writePageSequence(Array(pages), index: 0, page: startPage, to: tag, completion: completion)
    }
    private func readPageSequence(startPage: UInt8, chunks: Int, from tag: NFCMiFareTag, accumulated: Data, completion: @escaping (Result<Data, Error>) -> Void) {
        if chunks == 0 { completion(.success(accumulated)); return }
        readPage(startPage, from: tag) { [weak self] result in
            switch result {
            case .success(let data):
                self?.readPageSequence(startPage: startPage + 4, chunks: chunks - 1, from: tag, accumulated: accumulated + data, completion: completion)
            case .failure(let error):
                completion(.failure(error))
            }
        }
    }

    private func writePageSequence(_ pages: [Data.SubSequence], index: Int, page: UInt8, to tag: NFCMiFareTag, completion: @escaping (Result<Void, Error>) -> Void) {
        if index == pages.count { completion(.success(())); return }
        var pageData = Data(pages[index])
        while pageData.count < 4 { pageData.append(0) }
        let command = Data([0xA2, page]) + pageData
        tag.sendMiFareCommand(commandPacket: command) { [weak self] _, error in
            if let error { completion(.failure(error)); return }
            self?.writePageSequence(pages, index: index + 1, page: page + 1, to: tag, completion: completion)
        }
    }
}
