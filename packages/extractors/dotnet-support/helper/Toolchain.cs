using System.Reflection;
using System.Runtime.Loader;
using System.Text.Json;

namespace Projections.Dotnet;

/// <summary>
/// What the project's own successful build reported: requested MSBuild properties and,
/// for the public API, the exact csc arguments.
/// </summary>
internal sealed record ProjectBuild(IReadOnlyDictionary<string, string> Properties, string[] Arguments)
{
    public string Property(string name) =>
        Properties.TryGetValue(name, out var value) && value.Length > 0
            ? value : throw new InvalidOperationException($"The project build did not report $({name})");

    /// <summary>The build results named by PROJECTIONS_DOTNET_BUILD, if a project was built.</summary>
    public static ProjectBuild? FromEnvironment() =>
        Environment.GetEnvironmentVariable("PROJECTIONS_DOTNET_BUILD") is { Length: > 0 } path ? Toolchain.ReadBuild(path) : null;
}

/// <summary>
/// Locates the tools the helper borrows instead of shipping: the selected SDK's Roslyn
/// and the examined application's own dependency graph.
/// </summary>
internal static class Toolchain
{
    /// <summary>
    /// Reads `dotnet build -getProperty:... [-getItem:CscCommandLineArgs]` output.
    /// </summary>
    public static ProjectBuild ReadBuild(string path)
    {
        const long limit = 256L * 1024 * 1024;
        if (new FileInfo(path).Length > limit)
            throw new InvalidOperationException($"MSBuild build results exceed {limit} bytes");
        var text = File.ReadAllText(path);
        // MSBuild prints the requested values as one JSON object after any other output.
        var start = text.StartsWith('{') ? 0 : text.IndexOf("\n{", StringComparison.Ordinal) is var line and >= 0 ? line + 1 : -1;
        if (start < 0)
            throw new InvalidOperationException("The project build did not report its MSBuild results");
        using var document = JsonDocument.Parse(text[start..]);
        var properties = document.RootElement.GetProperty("Properties").EnumerateObject()
            .ToDictionary(property => property.Name, property => property.Value.GetString() ?? "");
        var arguments = document.RootElement.TryGetProperty("Items", out var items) && items.TryGetProperty("CscCommandLineArgs", out var csc)
            ? csc.EnumerateArray().Select(item => item.GetProperty("Identity").GetString()!).ToArray()
            : [];
        return new(properties, arguments);
    }

    /// <summary>
    /// Resolves Roslyn from `$(RoslynTargetsPath)/bincore`: the compiler of the SDK the
    /// repository selected (global.json or the default SDK) that built the project.
    /// </summary>
    public static void UseRoslyn(string roslynTargetsPath)
    {
        var directory = Path.Combine(roslynTargetsPath, "bincore");
        var compiler = Path.Combine(directory, "Microsoft.CodeAnalysis.dll");
        if (!File.Exists(compiler) || !File.Exists(Path.Combine(directory, "Microsoft.CodeAnalysis.CSharp.dll")))
            throw new InvalidOperationException($"The selected .NET SDK has no Roslyn compiler at {directory}; .NET SDK 8.0 or newer is required.");
        var required = typeof(Toolchain).Assembly.GetReferencedAssemblies().Single(name => name.Name == "Microsoft.CodeAnalysis").Version!;
        var available = AssemblyName.GetAssemblyName(compiler).Version!;
        if (available < required)
            throw new InvalidOperationException($"The selected compiler ({compiler}) is Roslyn {available}; Roslyn {required} (.NET SDK 8.0.100) or newer is required.");
        AssemblyLoadContext.Default.Resolving += (context, name) =>
        {
            if (name.Name is null || !name.Name.StartsWith("Microsoft.CodeAnalysis", StringComparison.Ordinal)) return null;
            var candidate = string.IsNullOrEmpty(name.CultureName)
                ? Path.Combine(directory, name.Name + ".dll")
                : Path.Combine(directory, name.CultureName, name.Name + ".dll");
            return File.Exists(candidate) ? context.LoadFromAssemblyPath(candidate) : null;
        };
    }

    /// <summary>
    /// Loads an application assembly into the default context and resolves its
    /// dependencies the way the application itself would run: packages from its
    /// `.deps.json`/output directory and shared frameworks named by its
    /// `.runtimeconfig.json` (for example Microsoft.AspNetCore.App).
    /// </summary>
    public static Assembly LoadApplication(string assemblyPath)
    {
        var resolver = new AssemblyDependencyResolver(assemblyPath);
        var frameworks = SharedFrameworks(Path.ChangeExtension(assemblyPath, ".runtimeconfig.json"));
        AssemblyLoadContext.Default.Resolving += (context, name) =>
        {
            var resolved = resolver.ResolveAssemblyToPath(name)
                ?? frameworks.Select(directory => Path.Combine(directory, name.Name + ".dll")).FirstOrDefault(File.Exists);
            return resolved is null ? null : context.LoadFromAssemblyPath(resolved);
        };
        AssemblyLoadContext.Default.ResolvingUnmanagedDll += (_, name) =>
        {
            var resolved = resolver.ResolveUnmanagedDllToPath(name);
            return resolved is null ? IntPtr.Zero : System.Runtime.InteropServices.NativeLibrary.Load(resolved);
        };
        return AssemblyLoadContext.Default.LoadFromAssemblyPath(assemblyPath);
    }

    /// <summary>
    /// The application assembly and the assemblies of the projects it references (deps.json
    /// libraries of type "project"), where design-time conventions are looked up.
    /// </summary>
    public static IEnumerable<Assembly> ApplicationAssemblies(Assembly application, string assemblyPath)
    {
        yield return application;
        var deps = Path.ChangeExtension(assemblyPath, ".deps.json");
        if (!File.Exists(deps)) yield break;
        using var document = JsonDocument.Parse(File.ReadAllText(deps));
        var libraries = document.RootElement.GetProperty("libraries");
        var names = new SortedSet<string>(StringComparer.Ordinal);
        foreach (var target in document.RootElement.GetProperty("targets").EnumerateObject())
            foreach (var library in target.Value.EnumerateObject())
                if (libraries.TryGetProperty(library.Name, out var description) && description.GetProperty("type").GetString() == "project"
                    && library.Value.TryGetProperty("runtime", out var runtime))
                    foreach (var file in runtime.EnumerateObject()) names.Add(Path.GetFileNameWithoutExtension(file.Name));
        names.Remove(application.GetName().Name!);
        foreach (var name in names) yield return Assembly.Load(new AssemblyName(name));
    }

    /// <summary>
    /// Installed directories of the non-default shared frameworks an application
    /// references: the newest installed patch of the requested major version, or else
    /// the newest later version, as framework roll-forward would choose.
    /// </summary>
    private static string[] SharedFrameworks(string runtimeConfig)
    {
        if (!File.Exists(runtimeConfig)) return [];
        using var document = JsonDocument.Parse(File.ReadAllText(runtimeConfig));
        var options = document.RootElement.GetProperty("runtimeOptions");
        var references = new List<JsonElement>();
        if (options.TryGetProperty("framework", out var single)) references.Add(single);
        if (options.TryGetProperty("frameworks", out var many)) references.AddRange(many.EnumerateArray());
        // shared/Microsoft.NETCore.App/<version>/ -> the dotnet root
        var shared = Path.GetFullPath(Path.Combine(System.Runtime.InteropServices.RuntimeEnvironment.GetRuntimeDirectory(), "..", ".."));
        var directories = new List<string>();
        foreach (var reference in references)
        {
            var name = reference.GetProperty("name").GetString()!;
            if (name == "Microsoft.NETCore.App" || !Version.TryParse(reference.GetProperty("version").GetString(), out var requested)) continue;
            var installed = Directory.Exists(Path.Combine(shared, name))
                ? Directory.GetDirectories(Path.Combine(shared, name))
                    .Select(path => (Path: path, Version: Version.TryParse(Path.GetFileName(path).Split('-')[0], out var version) ? version : null))
                    .Where(item => item.Version is not null && item.Version >= requested).ToArray()
                : [];
            var chosen = installed.Where(item => item.Version!.Major == requested.Major).OrderByDescending(item => item.Version).FirstOrDefault();
            if (chosen.Path is null) chosen = installed.OrderByDescending(item => item.Version).FirstOrDefault();
            if (chosen.Path is null)
                throw new InvalidOperationException($"The application requires shared framework {name} {requested}, which is not installed in {shared}");
            directories.Add(chosen.Path);
        }
        return [.. directories];
    }
}
