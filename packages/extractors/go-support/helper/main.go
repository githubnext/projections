// Command helper loads and type-checks Go packages for the Go extractors, using
// only the Go standard library and the go command of the examined project's own
// toolchain.
//
//	helper <mode> -dir <repository> [patterns...]
//
// Each mode turns the loaded program into one JSON document on stdout; add a
// mode by adding an entry to modes. Failures go to stderr and exit nonzero.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"sort"
	"strings"
)

// modes maps a mode argument to the function that writes its output.
var modes = map[string]func(*loaded) (any, error){
	"packages": packagesMode,
	"api":      apiMode,
}

func fail(err error) { fmt.Fprintln(os.Stderr, err); os.Exit(1) }

func main() {
	names := make([]string, 0, len(modes))
	for name := range modes {
		names = append(names, name)
	}
	sort.Strings(names)
	if len(os.Args) < 2 || modes[os.Args[1]] == nil {
		fail(fmt.Errorf("usage: helper <%s> -dir <repository> [patterns...]", strings.Join(names, "|")))
	}
	mode := modes[os.Args[1]]
	flags := flag.NewFlagSet(os.Args[1], flag.ExitOnError)
	dir := flags.String("dir", ".", "repository to type-check")
	flags.Parse(os.Args[2:])
	patterns := flags.Args()
	if len(patterns) == 0 {
		patterns = []string{"./..."}
	}
	program, err := load(*dir, patterns)
	if err != nil {
		fail(err)
	}
	output, err := mode(program)
	if err != nil {
		fail(err)
	}
	if err := json.NewEncoder(os.Stdout).Encode(output); err != nil {
		fail(err)
	}
}

// packagesMode reports the matched packages and their package-scope names: a
// smoke test of loading and type checking that extractors can build on.
func packagesMode(program *loaded) (any, error) {
	type pkg struct {
		Path  string   `json:"path"`
		Names []string `json:"names"`
	}
	packages := []pkg{}
	for _, typed := range program.Packages {
		packages = append(packages, pkg{typed.Path(), typed.Scope().Names()})
	}
	sort.Slice(packages, func(i, j int) bool { return packages[i].Path < packages[j].Path })
	return map[string]any{"packages": packages}, nil
}
