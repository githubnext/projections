import XCTest
@testable import Harbor
@testable import HarborKit

final class HarborTests: XCTestCase {
    func testAdd() {
        var schedule = Schedule()
        schedule.add(Berth(id: "A1", length: 40))
        XCTAssertEqual(schedule.berths.count, 1)
    }
}
