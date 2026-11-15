"""The database/v0 graph of the initialized Django model registry: tables, columns, constraints and relations."""
from projections_django_values import identity, serialize, stable, symbol


def table_id(model):
    return identity("table", model._meta.db_table)


def column_id(model, field):
    return identity("column", table_id(model), field.column)


def columns(model, names):
    return [model._meta.get_field(name.lstrip("-")).column for name in names]


class Graph:
    def __init__(self):
        self.nodes, self.edges = [], []
        self.node_ids, self.edge_ids = set(), set()

    def node(self, kind, key, label, data, model):
        if key in self.node_ids:
            raise ValueError("Ambiguous database identity " + key)
        self.node_ids.add(key)
        self.nodes.append({"id": key, "kind": kind, "label": label, "data": data,
                           "confidence": "authoritative",
                           "evidence": [{"kind": "django-meta", "source": model._meta.label}]})

    def edge(self, kind, source, target, discriminator=""):
        key = identity(kind, source, target, discriminator)
        if key not in self.edge_ids:
            self.edge_ids.add(key)
            self.edges.append({"id": key, "kind": kind, "from": source, "to": target, "confidence": "authoritative"})

    def constraint(self, model, kind, fields, name=None, options=None):
        table = table_id(model)
        key = identity("constraint", table, kind, name or stable(fields))
        data = {"table": table, "type": kind, "columns": fields, "databaseName": name, **(options or {})}
        self.node("constraint", key, name or kind + " (" + ", ".join(fields) + ")", data, model)
        self.edge("contains", table, key)
        for column in fields:
            if column:
                self.edge("constrains", key, identity("column", table, column))
        return key


def add_model(graph, model, connection):
    """The table of a model, its columns, and its keys, indexes and constraints."""
    from django.db.models import NOT_PROVIDED
    opts = model._meta
    table = table_id(model)
    graph.node("table", table, opts.db_table, {
        "managed": opts.managed, "autoCreated": bool(opts.auto_created),
        "tablespace": opts.db_tablespace or None,
        "comment": getattr(opts, "db_table_comment", "") or None,
    }, model)
    for field in opts.local_fields:
        if not field.column:
            continue
        params = field.db_parameters(connection)
        data = {
            "table": table, "type": field.get_internal_type(),
            "databaseType": params.get("type"), "nullable": field.null,
            "primaryKey": field.primary_key, "unique": field.unique,
            "maxLength": field.max_length, "autoCreated": field.auto_created,
            "hasDefault": field.has_default(),
            "default": serialize(field.default) if field.has_default() else None,
            "dbDefault": serialize(field.db_default) if getattr(field, "db_default", NOT_PROVIDED) is not NOT_PROVIDED else None,
            "precision": getattr(field, "max_digits", None),
            "scale": getattr(field, "decimal_places", None),
            "autoNow": getattr(field, "auto_now", False),
            "autoNowAdd": getattr(field, "auto_now_add", False),
            "comment": getattr(field, "db_comment", None),
            "collation": params.get("collation"), "check": params.get("check"),
            "tablespace": field.db_tablespace or None,
            "generated": serialize(field.expression) if getattr(field, "generated", False) else None,
            "persisted": getattr(field, "db_persist", None),
        }
        key = column_id(model, field)
        graph.node("column", key, field.column, serialize(data), model)
        graph.edge("contains", table, key)
        if field.primary_key:
            graph.constraint(model, "primary-key", [field.column])
        elif field.unique:
            graph.constraint(model, "unique", [field.column])
        if field.db_index and not field.unique:
            graph.constraint(model, "index", [field.column])
    # Django 5.2 CompositePrimaryKey has no physical column of its own.
    if getattr(opts.pk, "field_names", None):
        graph.constraint(model, "primary-key", columns(model, opts.pk.field_names))
    for group in opts.unique_together:
        graph.constraint(model, "unique", columns(model, group))
    for group in getattr(opts, "index_together", ()):
        graph.constraint(model, "index", columns(model, group))
    for index in opts.indexes:
        _, args, kwargs = index.deconstruct()
        kwargs.pop("name", None)
        kwargs.pop("fields", None)
        graph.constraint(model, "index", columns(model, index.fields), index.name, {
            "definition": serialize({"class": symbol(type(index)), "args": args, "options": kwargs}),
            "orders": ["desc" if name.startswith("-") else "asc" for name in index.fields],
        })
    for item in opts.constraints:
        _, args, kwargs = item.deconstruct()
        kwargs.pop("name", None)
        kwargs.pop("fields", None)
        fields = columns(model, getattr(item, "fields", ()))
        kind = "unique" if item.__class__.__name__ == "UniqueConstraint" else "check" if item.__class__.__name__ == "CheckConstraint" else "constraint"
        graph.constraint(model, kind, fields, item.name, {
            "definition": serialize({"class": symbol(type(item)), "args": args, "options": kwargs}),
        })


def add_relations(graph, model, models):
    """The foreign keys and ORM-only relations of a model to other tables."""
    for field in model._meta.local_fields:
        if not field.is_relation or not field.many_to_one and not field.one_to_one:
            continue
        pairs = field.related_fields
        target = pairs[0][1].model if pairs else field.remote_field.model
        if target not in models:
            raise ValueError("Relation target missing from Django registry: " + str(target))
        from_columns = [local.column for local, _ in pairs]
        to_columns = [remote.column for _, remote in pairs]
        enforced = getattr(field, "db_constraint", False)
        kind = "foreign-key" if enforced else "relation"
        key = graph.constraint(model, kind, from_columns, options={
            "target": table_id(target), "references": to_columns, "databaseConstraint": enforced,
            "onDelete": serialize(field.remote_field.on_delete),
        })
        graph.edge("references", key, table_id(target))
        for local, remote in pairs:
            graph.edge(kind, column_id(local.model, local), column_id(remote.model, remote), key)
