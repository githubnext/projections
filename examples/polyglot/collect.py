import json
import pathlib
import sys

request = json.load(sys.stdin)
if type(request.get("protocolVersion")) is not int or request["protocolVersion"] != 0 or request.get("capabilities", {}).get("trusted") is not True:
    raise PermissionError("Review both revisions and explicitly authorize execution")
services = json.loads((pathlib.Path(request["repository"]["root"]) / "services.json").read_text())["services"]
if not isinstance(services, list):
    raise ValueError("services must be an array")
evidence = [{"kind": "declared-service-catalog", "source": "services.json"}]
entities = []
relationships = []
for service in services:
    name = service["name"]
    if not isinstance(name, str) or not isinstance(service["language"], str):
        raise ValueError("Each service needs a name and language")
    entities.append({
        "id": "service:" + name, "kind": "service", "label": name,
        "data": {"language": service["language"]}, "confidence": "authoritative", "evidence": evidence,
    })
    if not isinstance(service["dependencies"], list):
        raise ValueError("dependencies must be string arrays")
    for dependency in service["dependencies"]:
        if not isinstance(dependency, str):
            raise ValueError("dependencies must be string arrays")
        relationships.append({
            "id": "dependency:" + json.dumps([name, dependency], ensure_ascii=False, separators=(",", ":")),
            "kind": "depends-on", "from": "service:" + name, "to": "service:" + dependency,
            "confidence": "authoritative", "evidence": evidence,
        })
json.dump({
    "protocolVersion": 0, "schema": "architecture/v0", "entities": entities, "relationships": relationships,
    "metadata": {"authority": "Declared service catalog, not runtime topology discovery."},
}, sys.stdout, ensure_ascii=False, allow_nan=False)
