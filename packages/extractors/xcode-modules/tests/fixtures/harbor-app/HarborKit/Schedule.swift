import Foundation
import OrderedCollections
#if DEBUG
import os
#endif

public struct Schedule {
    public private(set) var berths: OrderedSet<Berth> = []

    public init() {}

    public mutating func add(_ berth: Berth) {
        berths.append(berth)
    }
}
