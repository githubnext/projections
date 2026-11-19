import XCTest
import Ledger

final class LedgerTests: XCTestCase {
    func testRecord() async throws {
        let ledger = Ledger<[Entry]>()
        _ = try await ledger.record(Entry(amount: Amount(minorUnits: 100, currency: "EUR")))
    }
}
