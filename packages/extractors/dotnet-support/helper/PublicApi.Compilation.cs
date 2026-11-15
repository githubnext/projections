using System.Collections.Concurrent;
using System.Collections.Immutable;
using System.Reflection;
using System.Runtime.Loader;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.Diagnostics;
using Microsoft.CodeAnalysis.Text;
using static Projections.Dotnet.Program;

namespace Projections.Dotnet;

/// <summary>Replays the project's own compiler invocation as a Roslyn compilation.</summary>
internal static partial class PublicApi
{
    /// <summary>
    /// Builds the same compilation csc built: sources, references, defines, language
    /// version, nullable context, warning options, analyzer config and source generators.
    /// Failed generators or compiler errors fail extraction instead of producing a partial API.
    /// </summary>
    private static Compilation Compile(ProjectBuild build)
    {
        var arguments = CSharpCommandLineParser.Default.Parse(build.Arguments, build.Property("MSBuildProjectDirectory"), sdkDirectory: null);
        var argumentErrors = arguments.Errors.Where(item => item.Severity == DiagnosticSeverity.Error).ToArray();
        if (argumentErrors.Length != 0)
            throw new InvalidOperationException("Compiler arguments are invalid:\n" + string.Join("\n", argumentErrors.Select(item => Escape(item.ToString()))));

        var configs = arguments.AnalyzerConfigPaths
            .Select(path => AnalyzerConfig.Parse(SourceText.From(File.ReadAllText(path)), path)).ToArray();
        var configSet = AnalyzerConfigSet.Create(configs);
        var trees = arguments.SourceFiles.Select(file =>
        {
            using var stream = File.OpenRead(file.Path);
            var text = SourceText.From(stream, arguments.Encoding, arguments.ChecksumAlgorithm);
            return CSharpSyntaxTree.ParseText(text, arguments.ParseOptions, file.Path);
        }).ToArray();
        var references = arguments.MetadataReferences.Select(reference =>
        {
            var path = Path.GetFullPath(reference.Reference, arguments.BaseDirectory!);
            if (!File.Exists(path)) throw new FileNotFoundException("Compiler reference is missing", path);
            return (MetadataReference)MetadataReference.CreateFromFile(path, reference.Properties);
        }).ToArray();
        var options = arguments.CompilationOptions.WithSyntaxTreeOptionsProvider(new TreeOptions(configSet));
        if (options.CryptoKeyFile is not null)
            options = options.WithStrongNameProvider(new DesktopStrongNameProvider(arguments.KeyFileSearchPaths));
        Compilation compilation = CSharpCompilation.Create(arguments.CompilationName, trees, references, options);

        var loader = new AnalyzerLoader();
        var generators = arguments.AnalyzerReferences
            .SelectMany(reference => new AnalyzerFileReference(Path.GetFullPath(reference.FilePath, arguments.BaseDirectory!), loader).GetGenerators(LanguageNames.CSharp))
            .ToArray();
        if (generators.Length != 0)
        {
            var additional = arguments.AdditionalFiles.Select(file => (AdditionalText)new AdditionalFile(file.Path)).ToImmutableArray();
            var driver = CSharpGeneratorDriver.Create(generators, additional, (CSharpParseOptions)arguments.ParseOptions, new ConfigOptions(configSet));
            driver.RunGeneratorsAndUpdateCompilation(compilation, out compilation, out var generatorDiagnostics);
            // CS8784/CS8785: a generator failed to initialize or run, so its output is missing.
            var failures = generatorDiagnostics.Where(item => item.Severity == DiagnosticSeverity.Error || item.Id is "CS8784" or "CS8785").ToArray();
            if (failures.Length != 0)
                throw new InvalidOperationException("Source generation failed:\n" + string.Join("\n", failures.Select(item => Escape(item.ToString()))));
        }
        var errors = compilation.GetDiagnostics().Where(item => item.Severity == DiagnosticSeverity.Error).ToArray();
        if (errors.Length != 0) throw new InvalidOperationException("Compilation failed:\n" + string.Join("\n", errors.Select(item => Escape(item.ToString()))));
        return compilation;
    }

    /// <summary>Applies .editorconfig/.globalconfig diagnostic severities, as csc does.</summary>
    private sealed class TreeOptions(AnalyzerConfigSet configs) : SyntaxTreeOptionsProvider
    {
        // Roslyn asks from several threads at once while it gathers diagnostics.
        private readonly ConcurrentDictionary<string, AnalyzerConfigOptionsResult> cache = new();

        private AnalyzerConfigOptionsResult For(SyntaxTree tree) =>
            cache.GetOrAdd(tree.FilePath, configs.GetOptionsForSourcePath);

        public override GeneratedKind IsGenerated(SyntaxTree tree, CancellationToken cancellationToken) =>
            For(tree).AnalyzerOptions.TryGetValue("generated_code", out var value) && bool.TryParse(value, out var generated)
                ? generated ? GeneratedKind.MarkedGenerated : GeneratedKind.NotGenerated
                : GeneratedKind.Unknown;

        public override bool TryGetDiagnosticValue(SyntaxTree tree, string diagnosticId, CancellationToken cancellationToken, out ReportDiagnostic severity) =>
            For(tree).TreeOptions.TryGetValue(diagnosticId, out severity);

        public override bool TryGetGlobalDiagnosticValue(string diagnosticId, CancellationToken cancellationToken, out ReportDiagnostic severity) =>
            configs.GlobalConfigOptions.TreeOptions.TryGetValue(diagnosticId, out severity);
    }

    /// <summary>Analyzer config options for source generators, including MSBuild's build_property values.</summary>
    private sealed class ConfigOptions(AnalyzerConfigSet configs) : AnalyzerConfigOptionsProvider
    {
        public override AnalyzerConfigOptions GlobalOptions { get; } = new Options(configs.GlobalConfigOptions.AnalyzerOptions);
        public override AnalyzerConfigOptions GetOptions(SyntaxTree tree) => new Options(configs.GetOptionsForSourcePath(tree.FilePath).AnalyzerOptions);
        public override AnalyzerConfigOptions GetOptions(AdditionalText textFile) => new Options(configs.GetOptionsForSourcePath(textFile.Path).AnalyzerOptions);

        private sealed class Options(ImmutableDictionary<string, string> values) : AnalyzerConfigOptions
        {
            public override bool TryGetValue(string key, [System.Diagnostics.CodeAnalysis.NotNullWhen(true)] out string? value) =>
                values.TryGetValue(key, out value);
            public override IEnumerable<string> Keys => values.Keys;
        }
    }

    private sealed class AdditionalFile(string path) : AdditionalText
    {
        public override string Path { get; } = path;
        public override SourceText? GetText(CancellationToken cancellationToken = default) =>
            File.Exists(Path) ? SourceText.From(File.ReadAllText(Path)) : null;
    }

    /// <summary>
    /// Loads analyzer and generator assemblies one context per directory, as the compiler
    /// does. The compiler's own assemblies and the shared framework are unified with the
    /// helper's, so generators see the same Roslyn types.
    /// </summary>
    private sealed class AnalyzerLoader : IAnalyzerAssemblyLoader
    {
        private readonly Dictionary<string, DirectoryContext> contexts = new(StringComparer.Ordinal);

        public void AddDependencyLocation(string fullPath) { }

        public Assembly LoadFromPath(string fullPath)
        {
            var directory = System.IO.Path.GetDirectoryName(fullPath)!;
            if (!contexts.TryGetValue(directory, out var context)) contexts[directory] = context = new DirectoryContext(directory);
            return context.LoadFromAssemblyPath(fullPath);
        }

        private sealed class DirectoryContext(string directory) : AssemblyLoadContext($"Analyzers: {directory}")
        {
            private static readonly HashSet<string> Platform = ((AppContext.GetData("TRUSTED_PLATFORM_ASSEMBLIES") as string) ?? "")
                .Split(System.IO.Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries)
                .Select(System.IO.Path.GetFileNameWithoutExtension).ToHashSet(StringComparer.OrdinalIgnoreCase)!;

            protected override Assembly? Load(AssemblyName name)
            {
                if (name.Name is null || IsCompiler(name.Name) || Platform.Contains(name.Name)) return null;
                var candidate = System.IO.Path.Combine(directory, name.Name + ".dll");
                return File.Exists(candidate) ? LoadFromAssemblyPath(candidate) : null;
            }

            private static bool IsCompiler(string name) => name is "Microsoft.CodeAnalysis" or "Microsoft.CodeAnalysis.CSharp" or "Microsoft.CodeAnalysis.VisualBasic";
        }
    }
}
