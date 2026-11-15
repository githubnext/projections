using System.Collections;
using System.Reflection;
using System.Text.Json;
using static Projections.Dotnet.Program;

namespace Projections.Dotnet;

/// <summary>
/// Service composition (`dotnet-di`) and relational models (`efcore-schema`) produced by
/// an application factory. Microsoft.Extensions.DependencyInjection and EF Core are the
/// application's own versions, loaded from its build output and shared frameworks; they
/// are read by reflection, so no version is pinned or shipped here.
/// </summary>
internal static partial class Composition
{
    private const string Di = "Microsoft.Extensions.DependencyInjection.";
    private const string Metadata = "Microsoft.EntityFrameworkCore.Metadata.";

    public static async Task<Graph> Collect(string extractor, string root, JsonElement options, JsonElement input)
    {
        var build = ProjectBuild.FromEnvironment();
        string assemblyPath;
        if (options.TryGetProperty("assembly", out _))
        {
            var assemblyRoot = build is null ? root : Environment.GetEnvironmentVariable("PROJECTIONS_DOTNET_ARTIFACTS")
                ?? throw new InvalidOperationException("Build artifacts directory is required");
            assemblyPath = Within(assemblyRoot, Option(options, "assembly"));
        }
        else assemblyPath = build?.Property("TargetPath") ?? throw new InvalidOperationException("inputs.assembly is required without inputs.project");
        if (!File.Exists(assemblyPath)) throw new FileNotFoundException("Configured application assembly was not built. inputs.assembly is relative to --artifacts-path when inputs.project is set.", assemblyPath);
        var application = Toolchain.LoadApplication(assemblyPath);
        var owned = new List<object>();
        try
        {
            object value;
            if (options.TryGetProperty("factoryType", out _) || options.TryGetProperty("factoryMethod", out _))
                value = await InvokeFactory(application, options, input);
            else
            {
                // Conventions run the application's own startup, as `dotnet ef` does: from the
                // project directory, in the Development environment unless configured otherwise.
                UseEnvironment(options);
                Directory.SetCurrentDirectory(build?.Property("MSBuildProjectDirectory") ?? Path.GetDirectoryName(assemblyPath)!);
                var args = Hosting.Arguments(application);
                value = extractor == "dotnet-di"
                    ? Hosting.ServiceCollection(application, args)
                    : CreateContext(application, assemblyPath, options, args, owned);
            }
            owned.Add(value);
            return extractor == "dotnet-di"
                ? DependencyInjection(Implements(value, Di + "IServiceCollection")
                    ? (IEnumerable)value : throw new InvalidOperationException("Factory must return IServiceCollection"))
                : Schema(value);
        }
        finally
        {
            owned.Reverse();
            foreach (var item in owned)
            {
                if (item is IAsyncDisposable asyncDisposable) await asyncDisposable.DisposeAsync();
                else if (item is IDisposable disposable) disposable.Dispose();
            }
        }
    }

    private static void UseEnvironment(JsonElement options)
    {
        var configured = options.TryGetProperty("environment", out _) ? Option(options, "environment") : null;
        var environment = configured ?? Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT")
            ?? Environment.GetEnvironmentVariable("DOTNET_ENVIRONMENT") ?? "Development";
        foreach (var name in new[] { "ASPNETCORE_ENVIRONMENT", "DOTNET_ENVIRONMENT" })
            if (configured is not null || Environment.GetEnvironmentVariable(name) is null) Environment.SetEnvironmentVariable(name, environment);
    }

    private static async Task<object> InvokeFactory(Assembly assembly, JsonElement options, JsonElement input)
    {
        var type = assembly.GetType(Option(options, "factoryType"), throwOnError: true)!;
        var candidates = type.GetMethods(BindingFlags.Public | BindingFlags.Static)
            .Where(method => method.Name == Option(options, "factoryMethod") && !method.ContainsGenericParameters)
            .Where(method => method.GetParameters().Length == 0 || method.GetParameters() is [{ ParameterType: var parameter }] && parameter == typeof(JsonElement)).ToArray();
        if (candidates.Length != 1) throw new InvalidOperationException("Factory must identify exactly one public static method accepting no arguments or a JsonElement CollectorInput");
        var factory = candidates[0];
        object? value;
        try
        {
            value = factory.Invoke(null, factory.GetParameters().Length == 0 ? null : [input]);
            if (value is Task task)
            {
                await task;
                value = task.GetType().GetProperty("Result")?.GetValue(task);
            }
        }
        catch (TargetInvocationException error) when (error.InnerException is not null)
        {
            System.Runtime.ExceptionServices.ExceptionDispatchInfo.Capture(error.InnerException).Throw();
            throw;
        }
        return value ?? throw new InvalidOperationException("Factory returned null");
    }

    private static object? Invoke(Func<object?> call)
    {
        try { return call(); }
        catch (TargetInvocationException error) when (error.InnerException is not null)
        {
            System.Runtime.ExceptionServices.ExceptionDispatchInfo.Capture(error.InnerException).Throw();
            throw;
        }
    }

    private static bool Implements(object value, string interfaceName) =>
        value.GetType().GetInterfaces().Any(item => item.FullName == interfaceName);

    /// <summary>Reads a property declared by a named interface (or its base interfaces) of the value.</summary>
    private static object? Get(object target, string interfaceName, string property, bool required = true)
    {
        var declaring = target.GetType().GetInterfaces().FirstOrDefault(item => item.FullName == interfaceName)
            ?? throw new InvalidOperationException($"{target.GetType()} does not implement {interfaceName}");
        var member = new[] { declaring }.Concat(declaring.GetInterfaces())
            .Select(item => item.GetProperty(property, BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly))
            .FirstOrDefault(item => item is not null);
        if (member is null)
        {
            if (!required) return null;
            throw new InvalidOperationException($"{declaring.Assembly.GetName()} does not provide {interfaceName}.{property}");
        }
        return member.GetValue(target);
    }

    private static IEnumerable<object> Items(object? value) => value is IEnumerable items ? items.Cast<object>() : [];
}
