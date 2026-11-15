package main

// Package loading shared by every mode.
//
// `go list -export -compiled -deps` resolves the packages and builds export data
// for their dependencies. The matched packages, and any dependency that imports
// one, are type-checked from source with go/types; everything else is imported
// from that export data, so each package has one identity.

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"go/ast"
	"go/importer"
	"go/parser"
	"go/token"
	"go/types"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// listed is the subset of `go list -json` output the helper uses.
type listed struct {
	ImportPath      string
	Dir             string
	Export          string
	CompiledGoFiles []string
	Imports         []string
	ImportMap       map[string]string
	DepOnly         bool
	Incomplete      bool
	Error           *struct{ Err string }
	DepsErrors      []*struct{ Err string }
	Module          *struct{ GoVersion string }
}

// loaded is the type-checked program: the packages the patterns matched, in
// `go list` order, the file set their positions refer to, and the directory
// the patterns were resolved in.
type loaded struct {
	Dir      string
	Fset     *token.FileSet
	Packages []*types.Package
	Sizes    types.Sizes
}

func goCommand(dir string, args ...string) ([]byte, error) {
	command := exec.Command("go", args...)
	command.Dir = dir
	var stderr bytes.Buffer
	command.Stderr = &stderr
	output, err := command.Output()
	if err != nil {
		return nil, fmt.Errorf("go %s: %v\n%s", strings.Join(args, " "), err, strings.TrimSpace(stderr.String()))
	}
	return output, nil
}

func list(dir string, patterns []string) ([]*listed, error) {
	args := append([]string{"list", "-e", "-json", "-export", "-compiled", "-deps", "--"}, patterns...)
	output, err := goCommand(dir, args...)
	if err != nil {
		return nil, err
	}
	var packages []*listed
	decoder := json.NewDecoder(bytes.NewReader(output))
	for {
		pkg := new(listed)
		if err := decoder.Decode(pkg); errors.Is(err, io.EOF) {
			return packages, nil
		} else if err != nil {
			return nil, fmt.Errorf("go list output: %w", err)
		}
		packages = append(packages, pkg)
	}
}

// load lists and type-checks the packages that patterns match in dir. Load or
// type errors fail rather than producing a partial program.
func load(dir string, patterns []string) (*loaded, error) {
	packages, err := list(dir, patterns)
	if err != nil {
		return nil, err
	}
	var problems []string
	matched := 0
	for _, pkg := range packages {
		if pkg.Error != nil {
			problems = append(problems, fmt.Sprintf("%s: %s", pkg.ImportPath, pkg.Error.Err))
		}
		for _, dependency := range pkg.DepsErrors {
			problems = append(problems, fmt.Sprintf("%s: %s", pkg.ImportPath, dependency.Err))
		}
		if !pkg.DepOnly {
			matched++
		}
	}
	if len(problems) > 0 {
		return nil, fmt.Errorf("Go package loading/type checking failed:\n%s", strings.Join(problems, "\n"))
	}
	if matched == 0 {
		return nil, fmt.Errorf("Go package patterns matched no packages")
	}
	goarch, err := goCommand(dir, "env", "GOARCH")
	if err != nil {
		return nil, err
	}
	sizes := types.SizesFor("gc", strings.TrimSpace(string(goarch)))

	exports := map[string]string{}
	for _, pkg := range packages {
		exports[pkg.ImportPath] = pkg.Export
	}
	fset := token.NewFileSet()
	fromExport := importer.ForCompiler(fset, "gc", func(path string) (io.ReadCloser, error) {
		file, ok := exports[path]
		if !ok || file == "" {
			return nil, fmt.Errorf("no export data for %s", path)
		}
		return os.Open(file)
	})
	// `go list -deps` lists dependencies before their dependents.
	checked := map[string]*types.Package{}
	fromSource := map[string]bool{}
	result := &loaded{Dir: dir, Fset: fset, Sizes: sizes}
	for _, pkg := range packages {
		source := !pkg.DepOnly
		for _, imported := range pkg.Imports {
			source = source || fromSource[imported]
		}
		if !source {
			continue
		}
		fromSource[pkg.ImportPath] = true
		typed, err := check(fset, pkg, sizes, func(path string) (*types.Package, error) {
			if mapped, ok := pkg.ImportMap[path]; ok {
				path = mapped
			}
			if path == "unsafe" {
				return types.Unsafe, nil
			}
			if local, ok := checked[path]; ok {
				return local, nil
			}
			return fromExport.Import(path)
		})
		if err != nil {
			return nil, err
		}
		checked[pkg.ImportPath] = typed
		if !pkg.DepOnly {
			result.Packages = append(result.Packages, typed)
		}
	}
	return result, nil
}

type importerFunc func(path string) (*types.Package, error)

func (f importerFunc) Import(path string) (*types.Package, error) { return f(path) }

func check(fset *token.FileSet, pkg *listed, sizes types.Sizes, imports importerFunc) (*types.Package, error) {
	var files []*ast.File
	for _, name := range pkg.CompiledGoFiles {
		if !filepath.IsAbs(name) {
			name = filepath.Join(pkg.Dir, name)
		}
		file, err := parser.ParseFile(fset, name, nil, parser.SkipObjectResolution)
		if err != nil {
			return nil, fmt.Errorf("Go package loading/type checking failed:\n%v", err)
		}
		files = append(files, file)
	}
	var problems []string
	config := types.Config{
		Importer: imports,
		Sizes:    sizes,
		Error:    func(err error) { problems = append(problems, err.Error()) },
	}
	if pkg.Module != nil && pkg.Module.GoVersion != "" {
		config.GoVersion = "go" + pkg.Module.GoVersion
	}
	checked, _ := config.Check(pkg.ImportPath, fset, files, nil)
	if len(problems) > 0 {
		return nil, fmt.Errorf("Go package loading/type checking failed:\n%s", strings.Join(problems, "\n"))
	}
	return checked, nil
}
