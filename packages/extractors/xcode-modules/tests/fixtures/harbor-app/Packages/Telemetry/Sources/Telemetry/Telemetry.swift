import Logging

public enum Telemetry {
    static let logger = Logger(label: "telemetry")

    public static func record(_ event: String, value: Double) {
        logger.info("\(event): \(value)")
    }
}
