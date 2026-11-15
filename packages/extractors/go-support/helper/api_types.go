package main

// Type declarations in api mode: named types and aliases, their methods and fields.

import (
	"fmt"
	"go/types"
	"sort"
	"strings"
)

func (b *apiBuilder) typeName(object *types.TypeName, id, parent string, qualify types.Qualifier, interfaces []*types.Named) {
	name := object.Name()
	if object.IsAlias() {
		aliased := types.TypeString(types.Unalias(object.Type()), qualify)
		b.add(id, "type", name, fmt.Sprintf("type %s = %s", name, aliased),
			contract("alias", "type", map[string]any{"type": typeRef(aliased)}), object.Pos(), parent)
		return
	}
	named, ok := object.Type().(*types.Named)
	if !ok {
		return
	}
	underlying := named.Underlying()
	params := typeParams(named.TypeParams(), qualify)
	native := map[string]any{"comparable": types.Comparable(named)}
	facts := map[string]any{"typeParameters": typeParamFacts(named.TypeParams(), qualify), "native": native}
	declaration := "type"
	var signature string
	switch u := underlying.(type) {
	case *types.Struct:
		declaration = "struct"
		signature = fmt.Sprintf("type %s%s struct", name, params)
	case *types.Interface:
		declaration = "interface"
		// Only the package can implement an interface with unexported methods (others only by embedding).
		unexported := false
		for i := 0; i < u.NumMethods(); i++ {
			if !u.Method(i).Exported() {
				unexported = true
			}
		}
		facts["sealed"] = unexported
		signature = fmt.Sprintf("type %s%s interface", name, params)
	default:
		text := types.TypeString(underlying, qualify)
		native["underlying"] = kindOf(underlying)
		facts["underlying"] = text
		if basic, ok := underlying.(*types.Basic); ok && basic.Info()&types.IsNumeric != 0 {
			native["numeric"] = map[string]any{"family": family(basic), "size32": b.sizes32.Sizeof(basic), "size64": b.sizes64.Sizeof(basic)}
		}
		if channel, ok := underlying.(*types.Chan); ok {
			native["channel"] = map[string]any{"dir": direction(channel.Dir()), "elem": types.TypeString(channel.Elem(), qualify)}
		}
		signature = fmt.Sprintf("type %s%s %s", name, params, text)
	}
	if named.TypeParams().Len() == 0 {
		implements := []any{}
		for _, candidate := range interfaces {
			if candidate == named {
				continue
			}
			iface := candidate.Underlying().(*types.Interface)
			if types.Implements(named, iface) || types.Implements(types.NewPointer(named), iface) {
				implements = append(implements, map[string]any{"relation": "implements", "type": candidate.Obj().Name()})
			}
		}
		facts["supertypes"] = implements
	}
	b.add(id, "type", name, signature, contract(declaration, "type", facts), object.Pos(), parent)

	if iface, ok := underlying.(*types.Interface); ok {
		for i := 0; i < iface.NumMethods(); i++ {
			method := iface.Method(i)
			if !method.Exported() {
				continue
			}
			signature := method.Type().(*types.Signature)
			b.add(id+"."+method.Name(), "method", method.Name(), method.Name()+strings.TrimPrefix(types.TypeString(signature, qualify), "func"),
				contract("method", "method", map[string]any{"type": typeRef(types.TypeString(unnamed(signature), qualify)), "abstract": true}), method.Pos(), id)
		}
		return
	}
	values := types.NewMethodSet(named)
	pointers := types.NewMethodSet(types.NewPointer(named))
	for i := 0; i < pointers.Len(); i++ {
		selection := pointers.At(i)
		method := selection.Obj().(*types.Func)
		if !method.Exported() {
			continue
		}
		receiver := "pointer"
		if values.Lookup(method.Pkg(), method.Name()) != nil {
			receiver = "value"
		}
		signature := method.Type().(*types.Signature)
		shown := types.TypeString(signature, qualify)
		prefix := "*" + name
		if receiver == "value" {
			prefix = name
		}
		b.add(id+"."+method.Name(), "method", method.Name(), fmt.Sprintf("func (%s) %s%s", prefix, method.Name(), strings.TrimPrefix(shown, "func")),
			contract("method", "method", map[string]any{"type": typeRef(types.TypeString(unnamed(signature), qualify)),
				"native": map[string]any{"receiver": receiver, "promoted": len(selection.Index()) > 1}}),
			method.Pos(), id)
	}
	if structure, ok := underlying.(*types.Struct); ok {
		b.fields(named, structure, id, qualify)
	}
}

// fields adds every exported field a selector can reach: top-level fields,
// and fields promoted through embedded structs.
func (b *apiBuilder) fields(named *types.Named, structure *types.Struct, id string, qualify types.Qualifier) {
	names := map[string]bool{}
	var collect func(*types.Struct, int)
	collect = func(s *types.Struct, depth int) {
		for i := 0; i < s.NumFields(); i++ {
			field := s.Field(i)
			names[field.Name()] = true
			if field.Embedded() && depth < 8 {
				embedded := field.Type()
				if pointer, ok := embedded.(*types.Pointer); ok {
					embedded = pointer.Elem()
				}
				if inner, ok := embedded.Underlying().(*types.Struct); ok {
					collect(inner, depth+1)
				}
			}
		}
	}
	collect(structure, 0)
	sorted := make([]string, 0, len(names))
	for name := range names {
		sorted = append(sorted, name)
	}
	sort.Strings(sorted)
	for _, name := range sorted {
		object, index, _ := types.LookupFieldOrMethod(named, true, named.Obj().Pkg(), name)
		field, ok := object.(*types.Var)
		if !ok || !field.IsField() || !field.Exported() {
			continue
		}
		typ := types.TypeString(field.Type(), qualify)
		signature := fmt.Sprintf("%s %s", name, typ)
		if field.Embedded() {
			signature = typ
		}
		b.add(id+"."+name, "field", name, signature,
			contract("field", "field", map[string]any{"type": typeRef(typ),
				"native": map[string]any{"embedded": field.Embedded(), "promoted": len(index) > 1}}), field.Pos(), id)
	}
}
