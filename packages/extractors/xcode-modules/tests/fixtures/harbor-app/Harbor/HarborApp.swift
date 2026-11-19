import SwiftUI
import HarborKit
import Harbor_Widgets
import Telemetry

@main
struct HarborApp: App {
    @State private var schedule = Schedule()

    var body: some Scene {
        WindowGroup {
            BerthList(berths: schedule.berths.map(\.id))
                .onAppear { Telemetry.record("launch", value: 1) }
        }
    }
}
