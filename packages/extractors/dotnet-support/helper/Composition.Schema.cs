using System.Globalization;
using System.Reflection;
using System.Text.Json;
using static Projections.Dotnet.Program;

namespace Projections.Dotnet;

/// <summary>The relational model graph (`efcore-schema`) of a DbContext or IModel.</summary>
internal static partial class Composition
{
    /// <summary>The design-time model of a DbContext, or a supplied IModel.</summary>
    private static object Model(object value)
    {
        if (Implements(value, Metadata + "IModel")) return value;
        var context = value.GetType();
        while (context is not null && context.FullName != "Microsoft.EntityFrameworkCore.DbContext") context = context.BaseType;
        if (context is null) throw new InvalidOperationException("Factory must return DbContext or an initialized relational IModel");
        // context.GetService<IDesignTimeModel>().Model, with the application's EF Core.
        var designTimeModel = context.Assembly.GetType(Metadata + "IDesignTimeModel");
        var getService = context.Assembly.GetType("Microsoft.EntityFrameworkCore.Infrastructure.AccessorExtensions")?
            .GetMethods(BindingFlags.Public | BindingFlags.Static).SingleOrDefault(method => method.Name == "GetService" && method.IsGenericMethodDefinition);
        if (designTimeModel is null || getService is null)
            return context.GetProperty("Model")!.GetValue(value)!;
        var service = getService.MakeGenericMethod(designTimeModel).Invoke(null, [value])!;
        return Get(service, designTimeModel.FullName!, "Model")!;
    }

    private static Graph Schema(object value)
    {
        var model = Model(value);
        var relational = AppDomain.CurrentDomain.GetAssemblies().FirstOrDefault(item => item.GetName().Name == "Microsoft.EntityFrameworkCore.Relational")
            ?? Assembly.Load(new AssemblyName("Microsoft.EntityFrameworkCore.Relational"));
        var getRelationalModel = relational.GetType("Microsoft.EntityFrameworkCore.RelationalModelExtensions")?
            .GetMethods(BindingFlags.Public | BindingFlags.Static)
            .FirstOrDefault(method => method.Name == "GetRelationalModel" && method.GetParameters() is [{ ParameterType: var parameter }] && parameter.IsInstanceOfType(model))
            ?? throw new InvalidOperationException($"{relational.GetName()} does not provide GetRelationalModel; EF Core 6 or newer with a relational provider is required");
        var relationalModel = getRelationalModel.Invoke(null, [model])!;

        object? Table(object table, string name, bool required = true) => Get(table, Metadata + "ITable", name, required);
        object? Column(object column, string name) => Get(column, Metadata + "IColumn", name);
        string Name(object item, string interfaceName) => (string)Get(item, Metadata + interfaceName, "Name")!;
        string[] ColumnNames(object item, string interfaceName) =>
            Items(Get(item, Metadata + interfaceName, "Columns")).Select(column => Name(column, "IColumn")).ToArray();

        var graph = new Graph("database/v0");
        string TableId(object table) => $"table:{JsonSerializer.Serialize(new[] { (string?)Table(table, "Schema"), Name(table, "ITable") })}";
        string ColumnId(object table, string name) => TableId(table) + ":column:" + JsonSerializer.Serialize(name);
        var tables = Items(Get(relationalModel, Metadata + "IRelationalModel", "Tables")).ToArray();
        foreach (var table in tables)
        {
            var id = TableId(table);
            var name = Name(table, "ITable");
            var schema = (string?)Table(table, "Schema");
            graph.Add(id, "table", schema is null ? name : $"{schema}.{name}",
                new() { ["name"] = name, ["schema"] = schema, ["comment"] = Table(table, "Comment") });
            foreach (var column in Items(Table(table, "Columns")))
            {
                var columnName = Name(column, "IColumn");
                var columnId = ColumnId(table, columnName);
                var defaultValue = Column(column, "DefaultValue");
                graph.Add(columnId, "column", columnName, new()
                {
                    // EF Core's store type is already the database's own type name.
                    ["type"] = Column(column, "StoreType"), ["databaseType"] = Column(column, "StoreType"), ["nullable"] = Column(column, "IsNullable"),
                    ["maxLength"] = Column(column, "MaxLength"), ["precision"] = Column(column, "Precision"), ["scale"] = Column(column, "Scale"),
                    ["unicode"] = Column(column, "IsUnicode"), ["fixedLength"] = Column(column, "IsFixedLength"),
                    ["defaultValue"] = defaultValue is null or DBNull ? null : Convert.ToString(defaultValue, CultureInfo.InvariantCulture),
                    ["defaultValueSql"] = Column(column, "DefaultValueSql"), ["computedColumnSql"] = Column(column, "ComputedColumnSql"),
                    ["stored"] = Column(column, "IsStored"), ["collation"] = Column(column, "Collation"), ["comment"] = Column(column, "Comment"),
                    ["valueGeneration"] = Items(Column(column, "PropertyMappings"))
                        .Select(mapping => Get(Get(mapping, Metadata + "IColumnMapping", "Property")!, Metadata + "IProperty", "ValueGenerated")!.ToString()!)
                        .Distinct().Order(StringComparer.Ordinal).ToArray()
                });
                graph.Link("contains", id, columnId);
            }
            var primaryKey = Table(table, "PrimaryKey");
            foreach (var constraint in Items(Table(table, "UniqueConstraints")))
            {
                var constraintName = Name(constraint, "IUniqueConstraint");
                var constraintId = id + ":key:" + JsonSerializer.Serialize(constraintName);
                var columns = ColumnNames(constraint, "IUniqueConstraint");
                graph.Add(constraintId, ReferenceEquals(constraint, primaryKey) ? "primary-key" : "unique-key", constraintName,
                    new() { ["columns"] = columns });
                graph.Link("constraint", id, constraintId);
                foreach (var column in columns) graph.Link("key-column", constraintId, ColumnId(table, column));
            }
            foreach (var index in Items(Table(table, "Indexes")))
            {
                var indexName = Name(index, "ITableIndex");
                var indexId = id + ":index:" + JsonSerializer.Serialize(indexName);
                var columns = ColumnNames(index, "ITableIndex");
                graph.Add(indexId, "index", indexName, new()
                {
                    ["columns"] = columns,
                    ["unique"] = Get(index, Metadata + "ITableIndex", "IsUnique"),
                    ["filter"] = Get(index, Metadata + "ITableIndex", "Filter"),
                    ["descending"] = Get(index, Metadata + "ITableIndex", "IsDescending"),
                });
                graph.Link("index", id, indexId);
                foreach (var column in columns) graph.Link("index-column", indexId, ColumnId(table, column));
            }
            foreach (var check in Items(Table(table, "CheckConstraints")))
            {
                var checkName = (string)Get(check, Metadata + "ICheckConstraint", "Name")!;
                var checkId = id + ":check:" + JsonSerializer.Serialize(checkName);
                graph.Add(checkId, "check-constraint", checkName, new() { ["sql"] = Get(check, Metadata + "ICheckConstraint", "Sql") });
                graph.Link("constraint", id, checkId);
            }
        }
        foreach (var table in tables)
        {
            foreach (var foreignKey in Items(Table(table, "ForeignKeyConstraints")))
            {
                var name = Name(foreignKey, "IForeignKeyConstraint");
                var id = TableId(table) + ":foreign-key:" + JsonSerializer.Serialize(name);
                graph.Relationships.Add(new(id, "relation", TableId(table), TableId(Get(foreignKey, Metadata + "IForeignKeyConstraint", "PrincipalTable")!), new()
                {
                    ["columns"] = ColumnNames(foreignKey, "IForeignKeyConstraint"),
                    ["principalColumns"] = Items(Get(foreignKey, Metadata + "IForeignKeyConstraint", "PrincipalColumns")).Select(column => Name(column, "IColumn")).ToArray(),
                    ["onDelete"] = Get(foreignKey, Metadata + "IForeignKeyConstraint", "OnDeleteAction")!.ToString(), ["name"] = name
                }));
            }
        }
        graph.Metadata["limitations"] = new[] { "Relational IModel, not a live database inspection; views, sequences and provider-specific annotations are not represented." };
        return graph;
    }
}
