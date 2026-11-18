import ArgumentParser
import Harbor

@main
struct HarborCommand: ParsableCommand {
    @Option var berth: String = "A1"

    func run() {
        Harbor().dock(Berth(id: berth, length: 40))
    }
}
