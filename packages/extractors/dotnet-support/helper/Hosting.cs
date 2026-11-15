using System.Collections;
using System.Diagnostics;
using System.Reflection;

namespace Projections.Dotnet;

/// <summary>
/// Finds an application's .NET host the way `dotnet ef` (HostFactoryResolver) does, so
/// conventional applications need no adapter: public static `BuildWebHost`,
/// `CreateWebHostBuilder` or `CreateHostBuilder(string[] args)` on the entry point's
/// type, or else the entry point itself (minimal hosting), stopped through the
/// "Microsoft.Extensions.Hosting" diagnostic events when it builds its host. This runs
/// application startup code. A host is never started: service collections are captured
/// while the host is being built, before any service provider exists, and a built host
/// is abandoned before it runs.
/// </summary>
internal static class Hosting
{
    private const string HostBuilder = "Microsoft.Extensions.Hosting.IHostBuilder";
    private const string WebHostBuilder = "Microsoft.AspNetCore.Hosting.IWebHostBuilder";

    /// <summary>The arguments a conventional host is created with.</summary>
    public static string[] Arguments(Assembly application) =>
        // The host would otherwise take its application name from the helper's entry assembly.
        [$"--applicationName={application.GetName().Name}"];

    /// <summary>For `dotnet-di`: the host's complete IServiceCollection.</summary>
    public static IEnumerable ServiceCollection(Assembly application, string[] args)
    {
        var program = application.EntryPoint?.DeclaringType
            ?? throw new InvalidOperationException($"{application.GetName().Name} has no entry point, so it has no conventional host. Configure inputs.factoryType and inputs.factoryMethod.");
        var result = new TaskCompletionSource<object?>(TaskCreationOptions.RunContinuationsAsynchronously);
        if (Factory(program, "BuildWebHost") is not null)
            throw new InvalidOperationException("BuildWebHost builds the host before its service collection can be read; use CreateWebHostBuilder, CreateHostBuilder or minimal hosting, or configure inputs.factoryType and inputs.factoryMethod.");
        if (Factory(program, "CreateWebHostBuilder") is { } createWebHostBuilder)
        {
            var builder = Create(createWebHostBuilder, args);
            Configure(builder, WebHostBuilder, nameof(WebHostServices), result);
            return (IEnumerable)Captured(result, () => Call(builder, WebHostBuilder, "Build"))!;
        }
        if (Factory(program, "CreateHostBuilder") is { } createHostBuilder)
        {
            var builder = Create(createHostBuilder, args);
            Configure(builder, HostBuilder, nameof(HostServices), result);
            return (IEnumerable)Captured(result, () => Call(builder, HostBuilder, "Build"))!;
        }
        return (IEnumerable?)RunEntryPoint(application, args, building: true, result)
            ?? throw new InvalidOperationException($"The entry point of {application.GetName().Name} completed without building a .NET host. Configure inputs.factoryType and inputs.factoryMethod.");
    }

    /// <summary>For `efcore-schema`: the built, never started host and its services, if the application has a host.</summary>
    public static (object Host, IServiceProvider Services)? Services(Assembly application, string[] args)
    {
        var program = application.EntryPoint?.DeclaringType;
        if (program is null) return null;
        object? host;
        if (Factory(program, "BuildWebHost") is { } buildWebHost) host = Create(buildWebHost, args);
        else if (Factory(program, "CreateWebHostBuilder") is { } createWebHostBuilder) host = Call(Create(createWebHostBuilder, args), WebHostBuilder, "Build");
        else if (Factory(program, "CreateHostBuilder") is { } createHostBuilder) host = Call(Create(createHostBuilder, args), HostBuilder, "Build");
        else host = RunEntryPoint(application, args, building: false, new(TaskCreationOptions.RunContinuationsAsynchronously));
        if (host is null) return null;
        var services = host.GetType().GetInterfaces()
            .Select(item => item.GetProperty("Services", BindingFlags.Public | BindingFlags.Instance))
            .FirstOrDefault(item => item?.PropertyType == typeof(IServiceProvider))?.GetValue(host) as IServiceProvider
            ?? throw new InvalidOperationException($"{host.GetType()} has no service provider");
        return (host, services);
    }

    private static MethodInfo? Factory(Type program, string name) =>
        program.GetMethod(name, BindingFlags.Public | BindingFlags.Static, [typeof(string[])]);

    private static object Create(MethodInfo factory, string[] args) =>
        Unwrapped(() => factory.Invoke(null, [args])) ?? throw new InvalidOperationException($"{factory.DeclaringType}.{factory.Name} returned null");

    private static object? Call(object target, string interfaceName, string method)
    {
        var declaring = target.GetType().GetInterfaces().FirstOrDefault(item => item.FullName == interfaceName)
            ?? throw new InvalidOperationException($"{target.GetType()} does not implement {interfaceName}");
        return Unwrapped(() => declaring.GetMethod(method, Type.EmptyTypes)!.Invoke(target, null));
    }

    private static object? Unwrapped(Func<object?> call)
    {
        try { return call(); }
        catch (TargetInvocationException error) when (error.InnerException is not null)
        {
            System.Runtime.ExceptionServices.ExceptionDispatchInfo.Capture(error.InnerException).Throw();
            throw;
        }
    }

    /// <summary>Runs a build that our callback aborts once it has recorded the result.</summary>
    private static object? Captured(TaskCompletionSource<object?> result, Func<object?> build)
    {
        try { build(); }
        catch (Exception) when (result.Task.IsCompleted) { }
        return result.Task.IsCompleted ? result.Task.Result
            : throw new InvalidOperationException("The host was built without configuring its services");
    }

    /// <summary>
    /// Appends a ConfigureServices callback, which runs after every registration the
    /// application made, including Startup classes of generic hosts.
    /// </summary>
    private static void Configure(object builder, string interfaceName, string capture, TaskCompletionSource<object?> result)
    {
        var declaring = builder.GetType().GetInterfaces().First(item => item.FullName == interfaceName);
        var configure = declaring.GetMethods().First(method => method.Name == "ConfigureServices"
            && method.GetParameters() is [{ ParameterType: var parameter }]
            && parameter.GetGenericArguments().Length == (interfaceName == HostBuilder ? 2 : 1));
        var types = configure.GetParameters()[0].ParameterType.GetGenericArguments();
        var callback = typeof(Hosting).GetMethod(capture, BindingFlags.NonPublic | BindingFlags.Static)!.MakeGenericMethod(types).Invoke(null, [result]);
        Unwrapped(() => configure.Invoke(builder, [callback]));
    }

    private static Action<TContext, TServices> HostServices<TContext, TServices>(TaskCompletionSource<object?> result) =>
        (_, services) =>
        {
            result.TrySetResult(services);
            throw Abort();
        };

    /// <summary>
    /// A WebHostBuilder runs Startup.ConfigureServices after its own ConfigureServices
    /// callbacks, on a copy of the collection, so the registered IStartup is wrapped to
    /// capture the copy once Startup has configured it.
    /// </summary>
    private static Action<TServices> WebHostServices<TServices>(TaskCompletionSource<object?> result) =>
        services =>
        {
            var descriptors = ((IEnumerable)services!).Cast<object>().ToList();
            var index = descriptors.FindIndex(item => Read<Type>(item, "ServiceType").FullName == "Microsoft.AspNetCore.Hosting.IStartup");
            if (index < 0)
            {
                result.TrySetResult(services);
                throw Abort();
            }
            var original = descriptors[index];
            var descriptorType = original.GetType();
            var startup = Read<Type>(original, "ServiceType");
            Func<IServiceProvider, object> factory = provider => StartupProxy.Create(startup, Resolve(original, provider), result);
            var replacement = Activator.CreateInstance(descriptorType, startup, factory, Read<object>(original, "Lifetime"))!;
            typeof(IList<>).MakeGenericType(descriptorType).GetProperty("Item")!.SetValue(services, replacement, [index]);
        };

    private static T Read<T>(object target, string property) => (T)target.GetType().GetProperty(property)!.GetValue(target)!;

    private static object Resolve(object descriptor, IServiceProvider provider)
    {
        var type = descriptor.GetType();
        if (type.GetProperty("ImplementationInstance")!.GetValue(descriptor) is { } instance) return instance;
        if (type.GetProperty("ImplementationFactory")!.GetValue(descriptor) is Delegate factory)
            return Unwrapped(() => factory.DynamicInvoke(provider))!;
        var implementation = (Type)type.GetProperty("ImplementationType")!.GetValue(descriptor)!;
        var activator = type.Assembly.GetType("Microsoft.Extensions.DependencyInjection.ActivatorUtilities")!
            .GetMethod("CreateInstance", [typeof(IServiceProvider), typeof(Type), typeof(object[])])!;
        return Unwrapped(() => activator.Invoke(null, [provider, implementation, Array.Empty<object>()]))!;
    }

    /// <summary>Stops the application: the hosting library's own HostAbortedException when it has one.</summary>
    private static Exception Abort()
    {
        var aborted = AppDomain.CurrentDomain.GetAssemblies()
            .Select(assembly => assembly.GetType("Microsoft.Extensions.Hosting.HostAbortedException", throwOnError: false))
            .FirstOrDefault(type => type is not null);
        const string message = "Projections stopped the application after capturing its host; the host was not started.";
        return aborted is null ? new OperationCanceledException(message) : (Exception)Activator.CreateInstance(aborted, message)!;
    }

    /// <summary>
    /// Minimal hosting: runs the entry point and stops it from within the host's own
    /// HostBuilding (to capture services) or HostBuilt (to take the host) event.
    /// Returns null when the entry point completes without building a host.
    /// </summary>
    private static object? RunEntryPoint(Assembly application, string[] args, bool building, TaskCompletionSource<object?> result)
    {
        using var subscription = DiagnosticListener.AllListeners.Subscribe(new Observer<DiagnosticListener>(listener =>
        {
            if (listener.Name != "Microsoft.Extensions.Hosting") return;
            listener.Subscribe(new Observer<KeyValuePair<string, object?>>(pair =>
            {
                if (result.Task.IsCompleted || pair.Value is null) return;
                if (building && pair.Key == "HostBuilding") Configure(pair.Value, HostBuilder, nameof(HostServices), result);
                else if (!building && pair.Key == "HostBuilt")
                {
                    result.TrySetResult(pair.Value);
                    throw Abort();
                }
            }));
        }));
        var thread = new Thread(() =>
        {
            try
            {
                var entry = application.EntryPoint!;
                var value = Unwrapped(() => entry.Invoke(null, entry.GetParameters().Length == 0 ? null : [args]));
                if (value is Task task) task.GetAwaiter().GetResult();
                result.TrySetResult(null);
            }
            catch (Exception error)
            {
                // The application may also catch and log the abort; the result was recorded first.
                result.TrySetException(error);
            }
        }) { IsBackground = true, Name = $"{application.GetName().Name} entry point" };
        thread.Start();
        return result.Task.GetAwaiter().GetResult();
    }

    private sealed class Observer<T>(Action<T> next) : IObserver<T>
    {
        public void OnCompleted() { }
        public void OnError(Exception error) { }
        public void OnNext(T value) => next(value);
    }

    /// <summary>Forwards IStartup and captures the collection Startup.ConfigureServices filled.</summary>
    public class StartupProxy : DispatchProxy
    {
        private object inner = null!;
        private TaskCompletionSource<object?> result = null!;

        public static object Create(Type startup, object inner, TaskCompletionSource<object?> result)
        {
            var proxy = (StartupProxy)typeof(DispatchProxy).GetMethods(BindingFlags.Public | BindingFlags.Static)
                .Single(method => method.Name == nameof(DispatchProxy.Create) && method.IsGenericMethodDefinition)
                .MakeGenericMethod(startup, typeof(StartupProxy)).Invoke(null, null)!;
            proxy.inner = inner;
            proxy.result = result;
            return proxy;
        }

        protected override object? Invoke(MethodInfo? method, object?[]? args)
        {
            var value = Unwrapped(() => method!.Invoke(inner, args));
            if (method!.Name != "ConfigureServices") return value;
            result.TrySetResult(args![0]);
            throw Abort();
        }
    }
}
