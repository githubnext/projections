@_exported import HarborCore
import Telemetry

public final class Harbor {
    public private(set) var schedule = Schedule()

    public init() {}

    public func dock(_ berth: Berth) {
        schedule.add(berth)
        Telemetry.record("dock", value: berth.length)
    }
}
