import OrderedCollections
import Logging

public struct Berth: Hashable, Sendable {
    public let id: String
    public var length: Double

    public init(id: String, length: Double) {
        self.id = id
        self.length = length
    }
}

public struct Schedule {
    public private(set) var berths: OrderedSet<Berth> = []
    let logger = Logger(label: "harbor.schedule")

    public init() {}

    public mutating func add(_ berth: Berth) {
        berths.append(berth)
        logger.debug("Added berth \(berth.id)")
    }
}
