import SwiftUI

public struct BerthList: View {
    let berths: [String]

    public init(berths: [String]) {
        self.berths = berths
    }

    public var body: some View {
        List(berths, id: \.self) { Text($0) }
    }
}
