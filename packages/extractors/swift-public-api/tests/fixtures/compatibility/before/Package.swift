// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "Ledger",
    products: [
        .library(name: "Ledger", targets: ["Ledger"]),
    ],
    targets: [
        .target(name: "LedgerCore"),
        .target(name: "Ledger", dependencies: ["LedgerCore"]),
        .testTarget(name: "LedgerTests", dependencies: ["Ledger"]),
    ]
)
