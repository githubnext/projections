using System.Reflection;
using System.Text.Json;
using static Projections.Dotnet.Program;

namespace Projections.Dotnet;

/// <summary>Finds and creates the application's DbContext for `efcore-schema`.</summary>
internal static partial class Composition
{
    /// <summary>
    /// Creates the DbContext the way `dotnet ef` finds one: an
    /// IDesignTimeDbContextFactory&lt;T&gt; in the application takes precedence (and no
    /// host is built); otherwise a context registered in the application's host
    /// (AddDbContext); otherwise a context type with a public parameterless constructor.
    /// `inputs.context` selects one of several by full or simple type name.
    /// </summary>
    private static object CreateContext(Assembly application, string assemblyPath, JsonElement options, string[] args, List<object> owned)
    {
        var requested = options.TryGetProperty("context", out _) ? Option(options, "context") : null;
        var types = Toolchain.ApplicationAssemblies(application, assemblyPath).SelectMany(LoadableTypes).ToArray();
        var factories = types
            .Where(type => type is { IsClass: true, IsAbstract: false, ContainsGenericParameters: false } && type.GetConstructor(Type.EmptyTypes) is not null)
            .SelectMany(type => type.GetInterfaces()
                .Where(item => item.IsGenericType && item.GetGenericTypeDefinition().FullName == "Microsoft.EntityFrameworkCore.Design.IDesignTimeDbContextFactory`1")
                .Select(item => (Context: item.GetGenericArguments()[0], Factory: type, Interface: item)))
            .ToArray();
        if (SelectContext(factories.Select(item => item.Context), requested, "IDesignTimeDbContextFactory implementations") is { } produced)
        {
            var (_, factoryType, factoryInterface) = factories.First(item => item.Context == produced);
            var factory = Activator.CreateInstance(factoryType)!;
            return Invoke(() => factoryInterface.GetMethod("CreateDbContext")!.Invoke(factory, [Array.Empty<string>()]))
                ?? throw new InvalidOperationException($"{factoryType}.CreateDbContext returned null");
        }

        if (Hosting.Services(application, args) is var (host, services))
        {
            owned.Add(host);
            // Contexts and their options are scoped services.
            var scopeFactoryType = AppDomain.CurrentDomain.GetAssemblies().Select(item => item.GetType(Di + "IServiceScopeFactory", throwOnError: false)).First(item => item is not null)!;
            var scope = Invoke(() => scopeFactoryType.GetMethod("CreateScope")!.Invoke(services.GetService(scopeFactoryType), null))!;
            owned.Add(scope);
            var provider = (IServiceProvider)scope.GetType().GetInterfaces().Select(item => item.GetProperty("ServiceProvider")).First(item => item is not null)!.GetValue(scope)!;
            var optionsType = AppDomain.CurrentDomain.GetAssemblies().Select(item => item.GetType("Microsoft.EntityFrameworkCore.DbContextOptions", throwOnError: false)).FirstOrDefault(item => item is not null);
            var registered = optionsType is null ? [] : Items(provider.GetService(typeof(IEnumerable<>).MakeGenericType(optionsType)))
                .Select(item => (Type)item.GetType().GetProperty("ContextType")!.GetValue(item)!).ToArray();
            if (SelectContext(registered, requested, "contexts registered in the application's host") is { } registeredContext)
                return provider.GetService(registeredContext) ?? throw new InvalidOperationException($"The application's host cannot create {registeredContext}");
        }

        var constructible = types.Where(type => type is { IsClass: true, IsAbstract: false, ContainsGenericParameters: false }
            && IsDbContext(type) && type.GetConstructor(Type.EmptyTypes) is not null);
        if (SelectContext(constructible, requested, "DbContext types with a public parameterless constructor") is { } plain)
            return Activator.CreateInstance(plain)!;
        throw new InvalidOperationException(requested is null
            ? "No DbContext was found. Add an IDesignTimeDbContextFactory<T>, register the context in the application's host with AddDbContext, or configure inputs.factoryType and inputs.factoryMethod."
            : $"No DbContext named {requested} was found through a design-time factory, the application's host or a parameterless constructor.");
    }

    /// <summary>
    /// The single candidate, or the one named by inputs.context. More than one
    /// candidate without inputs.context fails, as `dotnet ef` does.
    /// </summary>
    private static Type? SelectContext(IEnumerable<Type> candidates, string? requested, string source)
    {
        var distinct = candidates.Distinct().OrderBy(type => type.FullName, StringComparer.Ordinal).ToArray();
        var matching = requested is null ? distinct : distinct.Where(type => type.FullName == requested || type.Name == requested).ToArray();
        if (matching.Length > 1)
            throw new InvalidOperationException($"More than one DbContext was found among {source}: {string.Join(", ", matching.Select(type => type.FullName))}. Set inputs.context to one of them.");
        return matching.Length == 1 ? matching[0] : null;
    }

    private static bool IsDbContext(Type? type)
    {
        for (; type is not null; type = type.BaseType) if (type.FullName == "Microsoft.EntityFrameworkCore.DbContext") return true;
        return false;
    }

    private static IEnumerable<Type> LoadableTypes(Assembly assembly)
    {
        try { return assembly.GetTypes(); }
        catch (ReflectionTypeLoadException error) { return error.Types.OfType<Type>(); }
    }
}
