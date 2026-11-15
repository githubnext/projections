using System.Runtime.CompilerServices;
using System.Text.Json;

namespace Projections.Dotnet;

/// <summary>
/// The slim .NET extractor helper. It ships no third-party code: Roslyn comes from the
/// SDK that built the examined project, and dependency injection and EF Core come from
/// the examined application's own build output and shared frameworks.
/// </summary>
internal static class Program
{
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    public static async Task<int> Main()
    {
        var output = Console.Out;
        Console.SetOut(Console.Error);
        try
        {
            using var document = await JsonDocument.ParseAsync(Console.OpenStandardInput());
            var input = document.RootElement;
            if (input.GetProperty("protocolVersion").GetInt32() != 0)
                throw new InvalidOperationException("ExtractorRequest.protocolVersion must be 0");
            if (!input.GetProperty("capabilities").GetProperty("trusted").GetBoolean())
                throw new InvalidOperationException("Native extractors execute MSBuild/application code; pass --trust.");
            var definition = input.GetProperty("projection").GetProperty("definition");
            var options = definition.GetProperty("inputs");
            var repository = input.GetProperty("repository");
            // The definition's project is the root its inputs are relative to.
            var project = repository.TryGetProperty("project", out var named) ? named.GetString() ?? "" : "";
            var root = Path.GetFullPath(Path.Combine(repository.GetProperty("root").GetString()!, project));
            var extractor = definition.GetProperty("extractor").GetString();
            var graph = extractor switch
            {
                "dotnet-public-api" => PublicApi(root, options),
                "dotnet-di" or "efcore-schema" => await Composition.Collect(extractor, root, options, input),
                _ => throw new InvalidOperationException($"Unsupported extractor: {extractor}"),
            };
            graph.Entities.Sort((a, b) => StringComparer.Ordinal.Compare(a.Id, b.Id));
            graph.Relationships.Sort((a, b) => StringComparer.Ordinal.Compare(a.Id, b.Id));
            await output.WriteLineAsync(JsonSerializer.Serialize(graph, JsonOptions));
            return 0;
        }
        catch (Exception error)
        {
            await Console.Error.WriteLineAsync(error.ToString());
            return 1;
        }
    }

    /// <summary>Registers the SDK's Roslyn before any Roslyn type is touched.</summary>
    private static Graph PublicApi(string root, JsonElement options)
    {
        var build = ProjectBuild.FromEnvironment()
            ?? throw new InvalidOperationException("`PROJECTIONS_DOTNET_BUILD` must identify the project's build results");
        if (build.Arguments.Length == 0)
            throw new InvalidOperationException("The project build ran no C# compiler invocation. `dotnet-public-api` supports C# projects; select one `inputs.framework` for a multi-targeted project.");
        Toolchain.UseRoslyn(build.Property("RoslynTargetsPath"));
        return CollectPublicApi(root, options, build);
    }

    [MethodImpl(MethodImplOptions.NoInlining)]
    private static Graph CollectPublicApi(string root, JsonElement options, ProjectBuild build) =>
        Dotnet.PublicApi.Collect(root, options, build);

    internal static string Option(JsonElement options, string name, string? fallback = null) =>
        options.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String && !string.IsNullOrWhiteSpace(value.GetString())
            ? value.GetString()! : fallback ?? throw new InvalidOperationException($"inputs.{name} is required");

    /// <summary>
    /// Raw tool text (compiler diagnostics) as protocol prose: backticks and backslashes
    /// escaped, so it is never read as inline code.
    /// </summary>
    internal static string Escape(string text) => text.Replace("\\", "\\\\").Replace("`", "\\`");

    /// <summary>Text as an inline code span of protocol prose.</summary>
    internal static string Code(string text) => "`" + Escape(text) + "`";

    internal static string Within(string root, string relative)
    {
        var resolved = Path.GetFullPath(Path.Combine(root, relative));
        if (Path.IsPathRooted(relative) || !resolved.StartsWith(root.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar, StringComparison.Ordinal))
            throw new InvalidOperationException($"Input path must stay inside its root: {relative}");
        return resolved;
    }
}

internal sealed class Graph(string schema)
{
    public int ProtocolVersion => 0;
    public string Schema { get; } = schema;
    public List<Node> Entities { get; } = [];
    public List<Edge> Relationships { get; } = [];
    public Dictionary<string, object?> Metadata { get; } = [];
    public Node Add(string id, string kind, string label, Dictionary<string, object?> data)
    {
        var node = new Node(id, kind, label, data);
        Entities.Add(node);
        return node;
    }
    public void Link(string kind, string from, string to) =>
        Relationships.Add(new($"edge:{kind}:{JsonSerializer.Serialize(new[] { from, to })}", kind, from, to, []));
    public void Link(string kind, string from, string to, string discriminator, Dictionary<string, object?> data, string confidence) =>
        Relationships.Add(new($"edge:{kind}:{JsonSerializer.Serialize(new[] { from, to, discriminator })}", kind, from, to, data) { Confidence = confidence });
}

internal sealed record Node(string Id, string Kind, string Label, Dictionary<string, object?> Data)
{
    public string Confidence => "authoritative";
    public Evidence[] Evidence { get; set; } = [];
}
internal sealed record Edge(string Id, string Kind, string From, string To, Dictionary<string, object?> Data)
{
    public string Confidence { get; init; } = "authoritative";
}
internal sealed record Evidence(string Kind, string Source, Location Location);
internal sealed record Location(int Line, int Column);
