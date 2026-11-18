public struct Amount: Hashable, Sendable {
    public var minorUnits: Int64
    public let currency: String

    public init(minorUnits: Int64, currency: String) {
        self.minorUnits = minorUnits
        self.currency = currency
    }

    public static func + (lhs: Amount, rhs: Amount) -> Amount {
        Amount(minorUnits: lhs.minorUnits + rhs.minorUnits, currency: lhs.currency)
    }

    public static func - (lhs: Amount, rhs: Amount) -> Amount {
        Amount(minorUnits: lhs.minorUnits - rhs.minorUnits, currency: lhs.currency)
    }
}
