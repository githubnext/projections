using Microsoft.CodeAnalysis;

namespace Projections.Dotnet;

/// <summary>The C# signature each api/v0 entity displays.</summary>
internal static partial class PublicApi
{
    private static readonly SymbolDisplayFormat SignatureFormat = new(
        globalNamespaceStyle: SymbolDisplayGlobalNamespaceStyle.Omitted,
        typeQualificationStyle: SymbolDisplayTypeQualificationStyle.NameAndContainingTypesAndNamespaces,
        genericsOptions: SymbolDisplayGenericsOptions.IncludeTypeParameters | SymbolDisplayGenericsOptions.IncludeTypeConstraints | SymbolDisplayGenericsOptions.IncludeVariance,
        memberOptions: SymbolDisplayMemberOptions.IncludeAccessibility | SymbolDisplayMemberOptions.IncludeModifiers |
                       SymbolDisplayMemberOptions.IncludeType | SymbolDisplayMemberOptions.IncludeParameters |
                       SymbolDisplayMemberOptions.IncludeContainingType | SymbolDisplayMemberOptions.IncludeConstantValue |
                       SymbolDisplayMemberOptions.IncludeRef,
        delegateStyle: SymbolDisplayDelegateStyle.NameAndSignature,
        extensionMethodStyle: SymbolDisplayExtensionMethodStyle.StaticMethod,
        parameterOptions: SymbolDisplayParameterOptions.IncludeType | SymbolDisplayParameterOptions.IncludeName |
                          SymbolDisplayParameterOptions.IncludeDefaultValue | SymbolDisplayParameterOptions.IncludeParamsRefOut |
                          SymbolDisplayParameterOptions.IncludeExtensionThis,
        propertyStyle: SymbolDisplayPropertyStyle.NameOnly,
        kindOptions: SymbolDisplayKindOptions.IncludeTypeKeyword,
        miscellaneousOptions: SymbolDisplayMiscellaneousOptions.EscapeKeywordIdentifiers |
                              SymbolDisplayMiscellaneousOptions.IncludeNullableReferenceTypeModifier);

    private static readonly SymbolDisplayFormat TypeReferenceFormat = SymbolDisplayFormat.FullyQualifiedFormat
        .WithGlobalNamespaceStyle(SymbolDisplayGlobalNamespaceStyle.Omitted)
        .WithGenericsOptions(SymbolDisplayGenericsOptions.IncludeTypeParameters | SymbolDisplayGenericsOptions.IncludeVariance)
        .WithMiscellaneousOptions(SymbolDisplayMiscellaneousOptions.EscapeKeywordIdentifiers | SymbolDisplayMiscellaneousOptions.IncludeNullableReferenceTypeModifier);

    private static string TypeSignature(INamedTypeSymbol type)
    {
        var modifiers = new List<string> { AccessibilityText(type.DeclaredAccessibility) };
        if (type.TypeKind == TypeKind.Delegate) return string.Join(" ", modifiers) + " " + type.ToDisplayString(SignatureFormat);
        if (type.IsStatic) modifiers.Add("static");
        else if (type.TypeKind == TypeKind.Class)
        {
            if (type.IsAbstract) modifiers.Add("abstract");
            if (type.IsSealed) modifiers.Add("sealed");
        }
        if (type.IsReadOnly) modifiers.Add("readonly");
        if (type.IsRefLikeType) modifiers.Add("ref");
        modifiers.Add(type.IsRecord ? (type.IsValueType ? "record struct" : "record class") : type.TypeKind.ToString().ToLowerInvariant());
        modifiers.Add(type.ToDisplayString(TypeReferenceFormat));
        var signature = string.Join(" ", modifiers);
        var bases = new List<string>();
        if (type.TypeKind == TypeKind.Enum) bases.Add(type.EnumUnderlyingType!.ToDisplayString(TypeReferenceFormat));
        if (type.BaseType is { SpecialType: not SpecialType.System_Object } baseType && type.TypeKind == TypeKind.Class)
            bases.Add(baseType.ToDisplayString(TypeReferenceFormat));
        bases.AddRange(type.Interfaces.Select(item => item.ToDisplayString(TypeReferenceFormat)).Order(StringComparer.Ordinal));
        if (bases.Count > 0) signature += " : " + string.Join(", ", bases);
        foreach (var parameter in type.TypeParameters)
        {
            var constraints = new List<string>();
            if (parameter.HasUnmanagedTypeConstraint) constraints.Add("unmanaged");
            else if (parameter.HasValueTypeConstraint) constraints.Add("struct");
            else if (parameter.HasReferenceTypeConstraint) constraints.Add(parameter.ReferenceTypeConstraintNullableAnnotation == NullableAnnotation.Annotated ? "class?" : "class");
            if (parameter.HasNotNullConstraint) constraints.Add("notnull");
            constraints.AddRange(parameter.ConstraintTypes.Select(item => item.ToDisplayString(TypeReferenceFormat)));
            if (parameter.HasConstructorConstraint) constraints.Add("new()");
            if (constraints.Count > 0) signature += $" where {parameter.Name} : " + string.Join(", ", constraints);
        }
        return signature;
    }

    private static string Signature(ISymbol symbol)
    {
        if (symbol is INamedTypeSymbol type) return TypeSignature(type);
        var signature = symbol.ToDisplayString(SignatureFormat);
        if (symbol is IPropertySymbol property)
        {
            var accessors = new List<string>();
            if (property.GetMethod is { } getter && Exported(getter))
                accessors.Add((getter.DeclaredAccessibility == property.DeclaredAccessibility ? "" : AccessibilityText(getter.DeclaredAccessibility) + " ") + "get;");
            if (property.SetMethod is { } setter && Exported(setter))
                accessors.Add((setter.DeclaredAccessibility == property.DeclaredAccessibility ? "" : AccessibilityText(setter.DeclaredAccessibility) + " ") + (setter.IsInitOnly ? "init;" : "set;"));
            signature += " { " + string.Join(" ", accessors) + " }";
            if (property.IsRequired) signature = "required " + signature;
        }
        return signature;
    }

    private static string AccessibilityText(Accessibility accessibility) =>
        accessibility == Accessibility.ProtectedOrInternal ? "protected internal" : accessibility.ToString().ToLowerInvariant();
}
