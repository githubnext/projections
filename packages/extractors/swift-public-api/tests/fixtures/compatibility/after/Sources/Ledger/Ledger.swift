import Foundation
@_exported import LedgerCore

public protocol Account: AnyObject {
    var id: String { get }
    var owner: String { get }
    func post(_ entry: Entry) throws
}

extension Account {
    public func post(_ entry: Entry) throws {}
}

public enum EntryKind: String, CaseIterable, Sendable {
    case debit
    case credit
    case adjustment
}

public struct Entry: Sendable {
    public let amount: Amount
    public let kind: EntryKind
    public let memo: String?

    public init(amount: Amount, kind: EntryKind = .debit, memo: String? = nil) {
        self.amount = amount
        self.kind = kind
        self.memo = memo
    }
}

public class Ledger<Store: RangeReplaceableCollection> where Store.Element == Entry {
    public private(set) var entries: Store = Store()

    public init() {}

    @discardableResult
    public func record(_ entry: Entry) async throws -> Int {
        entries.append(entry)
        return entries.count
    }

    public func balance(in currency: String, asOf date: Date? = nil) -> Amount {
        entries.filter { $0.amount.currency == currency }.reduce(Amount(minorUnits: 0, currency: currency)) { $0 + $1.amount }
    }

    @available(*, deprecated, message: "Use record(_:)")
    public func add(_ entry: Entry) {
        entries.append(entry)
    }
}

extension Amount: CustomStringConvertible {
    public var description: String { "\(minorUnits) \(currency)" }
}

extension Amount: Comparable {
    public static func < (lhs: Amount, rhs: Amount) -> Bool { lhs.minorUnits < rhs.minorUnits }
}
