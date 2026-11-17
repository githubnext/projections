import XCTest
@testable import Harbor

final class HarborTests: XCTestCase {
    func testDock() {
        let harbor = Harbor()
        harbor.dock(Berth(id: "A1", length: 40))
        XCTAssertEqual(harbor.schedule.berths.count, 1)
    }
}
