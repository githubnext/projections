import Foundation

public struct Berth: Hashable, Sendable {
    public let id: String
    public var length: Double

    public init(id: String, length: Double) {
        self.id = id
        self.length = length
    }
}
