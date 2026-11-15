using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;

namespace Projections.Dotnet;

/// <summary>The api/v0 contract facts of each public symbol.</summary>
internal static partial class PublicApi
{
    /// <summary>Types as compatibility compares them: without nullable reference annotations, which only produce warnings.</summary>
    private static readonly SymbolDisplayFormat ContractTypeFormat = SymbolDisplayFormat.FullyQualifiedFormat
        .WithGlobalNamespaceStyle(SymbolDisplayGlobalNamespaceStyle.Omitted)
        .WithGenericsOptions(SymbolDisplayGenericsOptions.IncludeTypeParameters)
        .WithMiscellaneousOptions(SymbolDisplayMiscellaneousOptions.EscapeKeywordIdentifiers);

    private static string ContractType(ITypeSymbol type) => type.ToDisplayString(ContractTypeFormat);

    private static string RefPrefix(RefKind kind) => kind switch
    {
        RefKind.Ref => "ref ",
        RefKind.RefReadOnly => "ref readonly ",
        _ => "",
    };

    private static string Literal(object? value) =>
        SymbolDisplay.FormatPrimitive(value!, quoteStrings: true, useHexadecimalNumbers: false) ?? "null";

    /// <summary>ApiCompat's IsEffectivelySealed: sealed, static, or a class no one outside the assembly can construct.</summary>
    private static bool EffectivelySealed(INamedTypeSymbol type) =>
        type.IsSealed || type.IsStatic ||
        (type.TypeKind == TypeKind.Class && !type.InstanceConstructors.Any(Exported));

    private static object[] TypeParameters(IEnumerable<ITypeParameterSymbol> parameters) =>
        parameters.Select(parameter =>
        {
            var constraints = new List<string>();
            if (parameter.HasUnmanagedTypeConstraint) constraints.Add("unmanaged");
            else if (parameter.HasValueTypeConstraint) constraints.Add("struct");
            if (parameter.HasReferenceTypeConstraint) constraints.Add("class");
            if (parameter.HasNotNullConstraint) constraints.Add("notnull");
            if (parameter.HasConstructorConstraint) constraints.Add("new()");
            constraints.AddRange(parameter.ConstraintTypes.Select(ContractType).Order(StringComparer.Ordinal));
            return (object)new Dictionary<string, object?> { ["name"] = parameter.Name, ["constraints"] = constraints };
        }).ToArray();

    /// <summary>A type where values flow, as api/v0 writes it: its text.</summary>
    private static Dictionary<string, object?> TypeRef(string text) => new() { ["text"] = text };

    /// <summary>Who can use a symbol: public, or protected (protected internal too: only its assembly adds to that).</summary>
    private static string Visibility(Accessibility accessibility) => accessibility == Accessibility.Public ? "public" : "protected";

    /// <summary>Sets a fact unless it is false, absent or empty, which mean the same.</summary>
    private static void Put(Dictionary<string, object?> facts, string key, object? value)
    {
        if (value is null or false || value is System.Collections.ICollection { Count: 0 }) return;
        facts[key] = value;
    }

    private static string[] AttributesOf(IEnumerable<AttributeData> attributes) =>
        attributes.Select(attribute => attribute.ToString()!).Order(StringComparer.Ordinal).ToArray();

    private static object[] Parameters(IEnumerable<IParameterSymbol> parameters) =>
        parameters.Select(parameter =>
        {
            var fact = new Dictionary<string, object?>
            {
                ["name"] = parameter.Name,
                ["type"] = TypeRef(ContractType(parameter.Type)),
                ["optional"] = parameter.IsOptional,
                ["variadic"] = parameter.IsParams,
            };
            if (parameter.HasExplicitDefaultValue) fact["default"] = Literal(parameter.ExplicitDefaultValue);
            fact["passing"] = parameter.RefKind switch
            {
                RefKind.None => "value",
                RefKind.Ref => "ref",
                RefKind.Out => "out",
                RefKind.In => "in",
                _ => "ref readonly",
            };
            Put(fact, "attributes", AttributesOf(parameter.GetAttributes()));
            return (object)fact;
        }).ToArray();

    /// <summary>
    /// The api/v0 contract facts ApiCompat's rules inspect, read from Roslyn: accessibility,
    /// modifiers, the whole base-type chain, implemented interfaces, member types, parameters,
    /// accessors, constraints, constant values and attributes, in the language-neutral terms of
    /// <c>packages/schemas/src/domains.ts</c>. The <c>virtual</c>, <c>override</c> and <c>sealed</c>
    /// modifiers are in <c>native</c>. See docs/models/api-compatibility.md.
    /// </summary>
    private static Dictionary<string, object?> Contract(ISymbol symbol)
    {
        var contract = new Dictionary<string, object?>();
        var native = new Dictionary<string, object?>();
        if (symbol is INamedTypeSymbol type)
        {
            var term = type.TypeKind == TypeKind.Delegate ? "delegate"
                : type.IsRecord ? (type.IsValueType ? "record struct" : "record class")
                : type.TypeKind.ToString().ToLowerInvariant();
            contract["declaration"] = type.TypeKind switch
            {
                TypeKind.Class => "class",
                TypeKind.Struct => "struct",
                TypeKind.Interface => "interface",
                TypeKind.Enum => "enum",
                _ => "type",
            };
            contract["term"] = term;
            contract["visibility"] = Visibility(type.DeclaredAccessibility);
            Put(contract, "static", type.IsStatic);
            Put(contract, "abstract", type.IsAbstract && type.TypeKind != TypeKind.Interface);
            Put(contract, "sealed", EffectivelySealed(type));
            Put(contract, "underlying", type.EnumUnderlyingType is { } underlying ? ContractType(underlying) : null);
            Put(contract, "attributes", AttributesOf(type.GetAttributes()));
            Put(contract, "typeParameters", TypeParameters(type.TypeParameters));
            var supertypes = new List<object>();
            if (type.TypeKind == TypeKind.Class)
                for (var baseType = type.BaseType; baseType is { SpecialType: not SpecialType.System_Object }; baseType = baseType.BaseType)
                    supertypes.Add(new Dictionary<string, object?> { ["relation"] = "extends", ["type"] = ContractType(baseType) });
            supertypes.AddRange(type.AllInterfaces.Where(Exported).Select(ContractType).Order(StringComparer.Ordinal)
                .Select(item => new Dictionary<string, object?> { ["relation"] = "implements", ["type"] = item }));
            Put(contract, "supertypes", supertypes);
            Put(native, "sealed", type.IsSealed);
            Put(contract, "native", native);
            return contract;
        }
        var (declaration, kind) = symbol switch
        {
            IMethodSymbol { MethodKind: MethodKind.Constructor } => ("constructor", "constructor"),
            IMethodSymbol => ("method", "method"),
            IPropertySymbol => ("property", "property"),
            IEventSymbol => ("event", "event"),
            IFieldSymbol { ContainingType.TypeKind: TypeKind.Enum } => ("variant", "enum member"),
            IFieldSymbol { HasConstantValue: true } => ("constant", "const"),
            _ => ("field", "field"),
        };
        contract["declaration"] = declaration;
        contract["term"] = kind;
        contract["visibility"] = Visibility(symbol.DeclaredAccessibility);
        Put(contract, "static", symbol.IsStatic);
        Put(contract, "abstract", symbol.IsAbstract);
        Put(contract, "attributes", AttributesOf(symbol.GetAttributes()));
        switch (symbol)
        {
            case IMethodSymbol method:
                var signature = new Dictionary<string, object?>
                {
                    ["parameters"] = Parameters(method.Parameters),
                    ["returns"] = TypeRef(RefPrefix(method.RefKind) + ContractType(method.ReturnType)),
                };
                Put(signature, "returnAttributes", AttributesOf(method.GetReturnTypeAttributes()));
                Put(signature, "typeParameters", TypeParameters(method.TypeParameters));
                contract["signatures"] = new object[] { signature };
                break;
            case IPropertySymbol property:
                var propertyType = TypeRef(RefPrefix(property.RefKind) + ContractType(property.Type));
                contract["type"] = propertyType;
                Put(contract, "required", property.IsRequired);
                if (property.Parameters.Length > 0)
                    contract["signatures"] = new object[] { new Dictionary<string, object?> { ["parameters"] = Parameters(property.Parameters), ["returns"] = propertyType } };
                var access = new Dictionary<string, object?>();
                if (property.GetMethod is { } getter && Exported(getter)) access["read"] = Visibility(getter.DeclaredAccessibility);
                if (property.SetMethod is { } setter && Exported(setter)) access[setter.IsInitOnly ? "init" : "write"] = Visibility(setter.DeclaredAccessibility);
                contract["access"] = access;
                break;
            case IFieldSymbol field:
                contract["type"] = TypeRef(ContractType(field.Type));
                Put(contract, "readonly", field.IsReadOnly);
                Put(contract, "required", field.IsRequired);
                if (field.HasConstantValue) contract["value"] = Literal(field.ConstantValue);
                break;
            case IEventSymbol @event:
                contract["type"] = TypeRef(ContractType(@event.Type));
                break;
        }
        Put(native, "virtual", symbol.IsVirtual);
        Put(native, "override", symbol.IsOverride);
        Put(native, "sealed", symbol.IsSealed);
        Put(contract, "native", native);
        return contract;
    }
}
