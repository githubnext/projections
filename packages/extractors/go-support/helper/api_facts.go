package main

// Facts of api mode declarations, in the terms of api/v0 contracts.

import (
	"go/token"
	"go/types"
	"strings"
)

// empty reports whether a fact means the same as an absent one: false, nil or empty.
func empty(value any) bool {
	switch value := value.(type) {
	case nil:
		return true
	case bool:
		return !value
	case []any:
		return len(value) == 0
	case []string:
		return len(value) == 0
	case map[string]any:
		return len(value) == 0
	}
	return false
}

// nonEmpty is facts without those that mean the same as absent ones, in `native` too.
func nonEmpty(facts map[string]any) map[string]any {
	kept := map[string]any{}
	for key, value := range facts {
		if native, ok := value.(map[string]any); ok && key == "native" {
			value = nonEmpty(native)
		}
		if !empty(value) {
			kept[key] = value
		}
	}
	return kept
}

// contract is a declaration's contract facts: its kind in api/v0 terms, Go's own word
// for it, who can use it (everyone: the API is only what is exported), and the other
// facts that aren't empty (`native` among them).
func contract(declaration, term string, other map[string]any) map[string]any {
	facts := nonEmpty(other)
	facts["declaration"] = declaration
	facts["term"] = term
	facts["visibility"] = "public"
	return facts
}

// typeRef is a type where values flow, as api/v0 writes it.
func typeRef(text string) map[string]any {
	return map[string]any{"text": text}
}

// qualifier writes other packages by name and the package itself unqualified.
func qualifier(pkg *types.Package) types.Qualifier {
	return func(other *types.Package) string {
		if other == pkg {
			return ""
		}
		return other.Name()
	}
}

// unnamed is a signature without parameter and result names, which don't
// affect compatibility, and without its receiver.
func unnamed(signature *types.Signature) *types.Signature {
	strip := func(tuple *types.Tuple) *types.Tuple {
		variables := make([]*types.Var, tuple.Len())
		for i := range variables {
			variables[i] = types.NewParam(token.NoPos, nil, "", tuple.At(i).Type())
		}
		return types.NewTuple(variables...)
	}
	var typeParams []*types.TypeParam
	for i := 0; i < signature.TypeParams().Len(); i++ {
		typeParams = append(typeParams, signature.TypeParams().At(i))
	}
	if len(typeParams) > 0 {
		// Type parameters are bound to the original signature; print them as written instead.
		return signature
	}
	return types.NewSignatureType(nil, nil, nil, strip(signature.Params()), strip(signature.Results()), signature.Variadic())
}

func typeParams(list *types.TypeParamList, qualify types.Qualifier) string {
	if list.Len() == 0 {
		return ""
	}
	params := make([]string, list.Len())
	for i := range params {
		param := list.At(i)
		params[i] = param.Obj().Name() + " " + types.TypeString(param.Constraint(), qualify)
	}
	return "[" + strings.Join(params, ", ") + "]"
}

// typeParamFacts is a type parameter list as api/v0 contract facts: each name and its constraint.
func typeParamFacts(list *types.TypeParamList, qualify types.Qualifier) []any {
	params := make([]any, list.Len())
	for i := range params {
		param := list.At(i)
		params[i] = map[string]any{"name": param.Obj().Name(), "constraints": []string{types.TypeString(param.Constraint(), qualify)}}
	}
	return params
}

func kindOf(t types.Type) string {
	switch t := t.(type) {
	case *types.Basic:
		return t.Name()
	case *types.Pointer:
		return "pointer"
	case *types.Slice:
		return "slice"
	case *types.Array:
		return "array"
	case *types.Map:
		return "map"
	case *types.Chan:
		return "chan"
	case *types.Signature:
		return "func"
	default:
		return "other"
	}
}

func family(basic *types.Basic) string {
	info := basic.Info()
	switch {
	case info&types.IsComplex != 0:
		return "complex"
	case info&types.IsFloat != 0:
		return "float"
	case info&types.IsUnsigned != 0:
		return "unsigned"
	default:
		return "signed"
	}
}

func direction(dir types.ChanDir) string {
	switch dir {
	case types.SendOnly:
		return "send"
	case types.RecvOnly:
		return "receive"
	default:
		return "both"
	}
}
