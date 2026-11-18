// swift-tools-version: 5.9
import PackageDescription

var targets: [Target] = [
    .target(name: "Port"),
]

#if os(Linux)
targets.append(.target(name: "PortLinux", dependencies: ["Port"]))
#endif

let package = Package(
    name: "Port",
    products: [.library(name: "Port", targets: ["Port"])],
    targets: targets
)
