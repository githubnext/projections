"""Stable identities and JSON values for Django schema metadata, never memory-address reprs."""
import datetime
import decimal
import enum
import functools
import json
import math
import pathlib
import uuid
from urllib.parse import quote


def identity(kind, *parts):
    return kind + ":" + "/".join(quote(str(part), safe="~()*!.'-") for part in parts)


def symbol(value):
    module = getattr(value, "__module__", None)
    name = getattr(value, "__qualname__", None)
    if module and name and "<lambda>" not in name and "<locals>" not in name:
        return module + "." + name
    raise TypeError("Cannot stably serialize callable; use an importable named function")


def serialize(value):
    if value is None or isinstance(value, (str, bool, int)):
        return value
    if isinstance(value, float):
        if not math.isfinite(value):
            raise TypeError("Non-finite schema value")
        return value
    if isinstance(value, enum.Enum):
        return {"enum": symbol(type(value)), "value": serialize(value.value)}
    if isinstance(value, (decimal.Decimal, uuid.UUID, pathlib.PurePath)):
        return {"type": symbol(type(value)), "value": str(value)}
    if isinstance(value, (datetime.datetime, datetime.date, datetime.time)):
        return {"type": symbol(type(value)), "value": value.isoformat()}
    if isinstance(value, datetime.timedelta):
        return {"type": "datetime.timedelta", "days": value.days, "seconds": value.seconds, "microseconds": value.microseconds}
    if isinstance(value, bytes):
        return {"bytes": value.hex()}
    if isinstance(value, dict):
        if any(not isinstance(key, str) for key in value):
            raise TypeError("Schema mappings must have string keys")
        return {key: serialize(item) for key, item in sorted(value.items())}
    if isinstance(value, (list, tuple)):
        return [serialize(item) for item in value]
    if isinstance(value, (set, frozenset)):
        return sorted((serialize(item) for item in value), key=stable)
    if isinstance(value, functools.partial):
        return {"partial": serialize(value.func), "args": serialize(value.args), "kwargs": serialize(value.keywords)}
    if isinstance(value, type):
        return {"class": symbol(value)}
    if hasattr(value, "deconstruct"):
        result = value.deconstruct()
        if len(result) == 4:
            _, name, args, kwargs = result
        else:
            name, args, kwargs = result
        return {"expression": name, "args": serialize(args), "kwargs": serialize(kwargs)}
    if callable(value):
        return {"callable": symbol(value)}
    raise TypeError("Unsupported stable schema metadata type: " + symbol(type(value)))


def stable(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
