// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "Telemetry",
    products: [.library(name: "Telemetry", targets: ["Telemetry"])],
    dependencies: [
        .package(url: "https://github.com/apple/swift-log.git", from: "1.5.0"),
    ],
    targets: [
        .target(name: "Telemetry", dependencies: [.product(name: "Logging", package: "swift-log")]),
    ]
)
