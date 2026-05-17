// swift-tools-version: 5.10
import PackageDescription

let package = Package(
    name: "FilamentBridgeIOS",
    defaultLocalization: "en",
    platforms: [.iOS(.v17)],
    products: [
        .library(name: "FilamentBridgeIOS", targets: ["FilamentBridgeIOS"])
    ],
    targets: [
        .target(name: "FilamentBridgeIOS", path: "Sources/FilamentBridgeIOS")
    ]
)
