package main

// The api mode: every exported package-level declaration of the matched
// packages as api/v0, with the facts apidiff's compatibility rules inspect in
// the language-neutral terms of packages/schemas/src/domains.ts; the Go-only ones are in
// the contract's `native` (see the README). Internal and main packages aren't
// importable, so they are skipped.

import (
	"fmt"
	"go/token"
	"go/types"
	"path/filepath"
	"sort"
	"strings"
)

type apiEntity struct {
	ID         string         `json:"id"`
	Kind       string         `json:"kind"`
	Label      string         `json:"label"`
	Data       map[string]any `json:"data"`
	Evidence   []apiEvidence  `json:"evidence,omitempty"`
	Confidence string         `json:"confidence"`
}

type apiEvidence struct {
	Kind     string         `json:"kind"`
	Source   string         `json:"source"`
	Location map[string]int `json:"location"`
}

type apiRelationship struct {
	ID         string `json:"id"`
	Kind       string `json:"kind"`
	From       string `json:"from"`
	To         string `json:"to"`
	Confidence string `json:"confidence"`
}

type apiBuilder struct {
	program       *loaded
	root          string
	entities      []apiEntity
	relationships []apiRelationship
	sizes32       types.Sizes
	sizes64       types.Sizes
}

// importable reports whether other modules can import the package.
func importable(pkg *types.Package) bool {
	if pkg.Name() == "main" {
		return false
	}
	for _, segment := range strings.Split(pkg.Path(), "/") {
		if segment == "internal" {
			return false
		}
	}
	return true
}

func apiMode(program *loaded) (any, error) {
	root, err := filepath.Abs(program.Dir)
	if err != nil {
		return nil, err
	}
	builder := &apiBuilder{program: program, root: root, sizes32: types.SizesFor("gc", "386"), sizes64: types.SizesFor("gc", "amd64")}
	for _, pkg := range program.Packages {
		if importable(pkg) {
			builder.pkg(pkg)
		}
	}
	sort.Slice(builder.entities, func(i, j int) bool { return builder.entities[i].ID < builder.entities[j].ID })
	sort.Slice(builder.relationships, func(i, j int) bool { return builder.relationships[i].ID < builder.relationships[j].ID })
	return map[string]any{
		"protocolVersion": 0,
		"schema":          "api/v0",
		"entities":        builder.entities,
		"relationships":   builder.relationships,
		"metadata": map[string]any{
			"ecosystem": "go",
			"analysis":  "`go/types` exported package-level declarations, method sets and selectable fields of importable packages",
		},
	}, nil
}

func (b *apiBuilder) evidence(position token.Pos) []apiEvidence {
	if !position.IsValid() {
		return nil
	}
	location := b.program.Fset.Position(position)
	relative, err := filepath.Rel(b.root, location.Filename)
	if err != nil || strings.HasPrefix(relative, "..") {
		return nil
	}
	return []apiEvidence{{"source", filepath.ToSlash(relative), map[string]int{"line": location.Line}}}
}

func (b *apiBuilder) add(id, kind, label, signature string, contract map[string]any, position token.Pos, parent string) {
	b.entities = append(b.entities, apiEntity{id, kind, label, map[string]any{"signature": signature, "contract": contract}, b.evidence(position), "authoritative"})
	if parent != "" {
		b.relationships = append(b.relationships, apiRelationship{"contains:" + parent + "->" + id, "contains", parent, id, "authoritative"})
	}
}

func (b *apiBuilder) pkg(pkg *types.Package) {
	qualify := qualifier(pkg)
	packageID := "go:" + pkg.Path()
	b.add(packageID, "package", pkg.Path(), "package "+pkg.Name(), contract("package", "package", nil), token.NoPos, "")
	interfaces := []*types.Named{}
	for _, name := range pkg.Scope().Names() {
		if named, ok := pkg.Scope().Lookup(name).(*types.TypeName); ok && named.Exported() && !named.IsAlias() {
			if t, ok := named.Type().(*types.Named); ok {
				if iface, ok := t.Underlying().(*types.Interface); ok && iface.NumMethods() > 0 && t.TypeParams().Len() == 0 {
					interfaces = append(interfaces, t)
				}
			}
		}
	}
	for _, name := range pkg.Scope().Names() {
		object := pkg.Scope().Lookup(name)
		if !object.Exported() {
			continue
		}
		id := packageID + "." + name
		switch object := object.(type) {
		case *types.Const:
			typ := types.TypeString(object.Type(), qualify)
			shown := fmt.Sprintf("const %s %s = %s", name, typ, object.Val().String())
			if basic, ok := object.Type().(*types.Basic); ok && basic.Info()&types.IsUntyped != 0 {
				shown = fmt.Sprintf("const %s = %s", name, object.Val().String())
			}
			b.add(id, "constant", name, shown,
				contract("constant", "const", map[string]any{"type": typeRef(typ), "value": object.Val().ExactString()}), object.Pos(), packageID)
		case *types.Var:
			typ := types.TypeString(object.Type(), qualify)
			b.add(id, "variable", name, fmt.Sprintf("var %s %s", name, typ), contract("variable", "var", map[string]any{"type": typeRef(typ)}), object.Pos(), packageID)
		case *types.Func:
			signature := object.Type().(*types.Signature)
			b.add(id, "function", name, types.ObjectString(object, qualify),
				contract("function", "func", map[string]any{"type": typeRef(types.TypeString(unnamed(signature), qualify))}), object.Pos(), packageID)
		case *types.TypeName:
			b.typeName(object, id, packageID, qualify, interfaces)
		}
	}
}
