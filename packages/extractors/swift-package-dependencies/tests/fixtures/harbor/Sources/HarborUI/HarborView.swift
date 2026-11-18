import Harbor

public struct HarborSummary {
    public let berths: Int

    public init(harbor: Harbor) {
        berths = harbor.schedule.berths.count
    }
}
