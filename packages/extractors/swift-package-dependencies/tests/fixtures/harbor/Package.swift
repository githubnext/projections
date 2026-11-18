// swift-tools-version: 5.10
import PackageDescription

let strictConcurrency: [SwiftSetting] = [
    .enableUpcomingFeature("StrictConcurrency"),
]

let coreDependencies: [Target.Dependency] = [
    .product(name: "OrderedCollections", package: "swift-collections"),
    .product(name: "Logging", package: "swift-log"),
]

let package = Package(
    name: "Harbor",
    platforms: [.macOS(.v13), .iOS(.v16)],
    products: [
        .library(name: "Harbor", targets: ["Harbor"]),
        .library(name: "HarborUI", type: .dynamic, targets: ["HarborUI"]),
        .executable(name: "harbor", targets: ["HarborCLI"]),
    ],
    dependencies: [
        .package(url: "https://github.com/apple/swift-collections.git", from: "1.1.0"),
        .package(url: "https://github.com/apple/swift-argument-parser", .upToNextMinor(from: "1.5.0")),
        .package(url: "https://github.com/apple/swift-log.git", "1.5.0"..<"2.0.0"),
        .package(path: "Packages/Telemetry"),
    ],
    targets: [
        .target(name: "HarborCore", dependencies: coreDependencies),
        .target(
            name: "Harbor",
            dependencies: [
                "HarborCore",
                .product(name: "Telemetry", package: "Telemetry"),
            ]
        ),
        .target(name: "HarborUI", dependencies: ["Harbor"], path: "Sources/HarborUI"),
        .executableTarget(
            name: "HarborCLI",
            dependencies: [
                "Harbor",
                .product(name: "ArgumentParser", package: "swift-argument-parser"),
            ]
        ),
        .testTarget(name: "HarborTests", dependencies: ["Harbor", .target(name: "HarborCore", condition: .when(platforms: [.macOS, .linux]))]),
    ]
)

for target in package.targets where target.type != .test {
    target.swiftSettings = (target.swiftSettings ?? []) + strictConcurrency
}
