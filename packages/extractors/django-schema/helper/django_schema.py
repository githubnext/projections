#!/usr/bin/env python3
"""Read CollectorInput JSON from stdin and emit an initialized Django model graph."""
import contextlib
import json
import os
import sys

# The sibling modules are imported before the repository joins sys.path, so its modules
# cannot shadow them, and without writing bytecode into the verified helper directory.
sys.dont_write_bytecode, _write_bytecode = True, sys.dont_write_bytecode
from projections_django_graph import Graph, add_model, add_relations  # noqa: E402
sys.dont_write_bytecode = _write_bytecode


def collect(request):
    if type(request.get("protocolVersion")) is not int or request["protocolVersion"] != 0:
        raise ValueError("ExtractorRequest protocolVersion must be 0")
    if not request.get("capabilities", {}).get("trusted"):
        raise PermissionError("Django model initialization executes repository code; pass --trust")
    inputs = request["projection"]["definition"].get("inputs", {})
    if "env" in inputs:
        raise ValueError("Use execution.environment with per-invocation values, not inputs.env")
    settings = inputs.get("settings") or os.environ.get("DJANGO_SETTINGS_MODULE")
    if not isinstance(settings, str) or not settings.strip():
        raise ValueError("Provide inputs.settings or explicit DJANGO_SETTINGS_MODULE")
    os.environ["DJANGO_SETTINGS_MODULE"] = settings
    # The definition's project, which holds the Django project, is the import root.
    root = os.path.join(request["repository"]["root"], request["repository"].get("project") or "")
    sys.path.insert(0, os.path.abspath(root))
    import django
    from django.db.backends.base.base import BaseDatabaseWrapper

    def no_database(*args, **kwargs):
        raise RuntimeError("Schema collection forbids database access, including during Django initialization")

    # Fail closed if application initialization or a custom field requests an ORM connection.
    BaseDatabaseWrapper.ensure_connection = no_database
    BaseDatabaseWrapper.connect = no_database
    BaseDatabaseWrapper.cursor = no_database
    BaseDatabaseWrapper.chunked_cursor = no_database
    django.setup()
    from django.apps import apps
    from django.db import connections
    alias = inputs.get("database", "default")
    connection = connections[alias]
    models = [model for model in apps.get_models(include_auto_created=True) if not model._meta.proxy and not model._meta.swapped]
    graph = Graph()
    for model in models:
        add_model(graph, model, connection)
    for model in models:
        add_relations(graph, model, models)
    return {
        "protocolVersion": 0, "schema": "database/v0",
        "entities": sorted(graph.nodes, key=lambda item: item["id"]),
        "relationships": sorted(graph.edges, key=lambda item: item["id"]),
        "metadata": {
            "framework": "django", "frameworkVersion": django.get_version(), "pythonVersion": sys.version.split()[0],
            "authority": "django.setup / apps.get_models / Model._meta", "settings": settings,
            "backend": connection.settings_dict["ENGINE"],
            "limitations": [
                "Desired initialized model registry, not live database state or migration history; no SQL is executed.",
                "ORM connection/cursor access is blocked, including startup hooks. Trusted repository code can still perform arbitrary non-ORM side effects.",
                "Abstract/proxy/swapped models have no separate table; unmanaged and auto-created many-to-many tables are included.",
                "Database types are backend field metadata; routers, backend feature support, generated SQL names, and migration-only objects are not inferred.",
                "onDelete describes Django ORM behavior, not a database ON DELETE action. Defaults are serialized, never evaluated.",
                "Constraint expressions use Django deconstruction, retaining framework field references; unsupported opaque values fail rather than use memory-address repr.",
            ],
        },
    }


def main():
    request = json.load(sys.stdin)
    with contextlib.redirect_stdout(sys.stderr):
        state = collect(request)
    json.dump(state, sys.stdout, sort_keys=True, ensure_ascii=False, allow_nan=False)
    sys.stdout.write("\n")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(type(error).__name__ + ": " + str(error), file=sys.stderr)
        sys.exit(1)
