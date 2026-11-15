using System.Text.Json;
using Microsoft.CodeAnalysis;
using static Projections.Dotnet.Program;

namespace Projections.Dotnet;

/// <summary>
/// The public API of one C# project, read from a Roslyn compilation that replays the
/// exact compiler arguments of the project's own successful build. Roslyn is the
/// SDK's (see <see cref="Toolchain.UseRoslyn"/>); this class is the only one that uses it.
/// </summary>
internal static partial class PublicApi
{
    private static bool Exported(ISymbol symbol) =>
        symbol.DeclaredAccessibility is Accessibility.Public or Accessibility.Protected or Accessibility.ProtectedOrInternal;

    private static string SymbolId(ISymbol symbol) =>
        $"api:{symbol.ContainingAssembly.Identity.Name}:{symbol.GetDocumentationCommentId() ?? throw new InvalidOperationException($"Symbol has no semantic ID: {Code(symbol.ToString()!)}")}";

    public static Graph Collect(string root, JsonElement options, ProjectBuild build)
    {
        var compilation = Compile(build);
        var graph = new Graph("api/v0");
        var assemblyId = $"api:{compilation.AssemblyName}";
        graph.Add(assemblyId, "assembly", compilation.AssemblyName!, new() { ["signature"] = $"assembly {compilation.AssemblyName}" });
        void VisitType(INamedTypeSymbol type, string parent)
        {
            if (!Exported(type)) return;
            var id = SymbolId(type);
            AddSymbol(type, id, "type", parent);
            foreach (var member in type.GetMembers())
            {
                if (member is INamedTypeSymbol nested) { VisitType(nested, id); continue; }
                if (!Exported(member)) continue;
                if (member is IMethodSymbol method && method.MethodKind is not (MethodKind.Ordinary or MethodKind.Constructor or MethodKind.UserDefinedOperator or MethodKind.Conversion or MethodKind.Destructor)) continue;
                if (member is not (IMethodSymbol or IPropertySymbol or IFieldSymbol or IEventSymbol)) continue;
                AddSymbol(member, SymbolId(member), member.Kind.ToString().ToLowerInvariant(), id);
            }
        }
        void AddSymbol(ISymbol symbol, string id, string kind, string parent)
        {
            var data = new Dictionary<string, object?> { ["signature"] = Signature(symbol), ["contract"] = Contract(symbol) };
            var node = graph.Add(id, kind, symbol.MetadataName, data);
            node.Evidence = symbol.Locations.Where(location => location.IsInSource).Select(location =>
            {
                var span = location.GetLineSpan();
                return new Evidence("source", EvidencePath(root, span.Path), new(span.StartLinePosition.Line + 1, span.StartLinePosition.Character + 1));
            }).ToArray();
            graph.Link("contains", parent, id);
        }
        void VisitNamespace(INamespaceSymbol ns)
        {
            foreach (var type in ns.GetTypeMembers()) VisitType(type, assemblyId);
            foreach (var child in ns.GetNamespaceMembers()) VisitNamespace(child);
        }
        VisitNamespace(compilation.Assembly.GlobalNamespace);
        graph.Metadata["project"] = Option(options, "project");
        graph.Metadata["ecosystem"] = "dotnet";
        return graph;
    }

    /// <summary>Repository-relative evidence; generated sources keep their generator-relative path.</summary>
    private static string EvidencePath(string root, string path) =>
        (Path.IsPathRooted(path) ? Path.GetRelativePath(root, path) : path).Replace('\\', '/');
}
