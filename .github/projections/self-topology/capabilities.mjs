// Self topology, part of extract.mjs: what production source does, by language. Each pattern matches a use, not a mention.

export const capabilityNames = {
  json: 'JSON parsing or writing',
  jsonValue: 'untyped JSON values (serde_json::Value)',
  serialization: 'serde models or hand-written serde (derives, impls, YAML, TOML)',
  fs: 'filesystem, directly',
  sdkFs: 'repository files through the extractor SDK (scope-mediated)',
  process: 'process execution, directly',
  sdkProcess: 'tools and helpers through the extractor SDK',
  network: 'network',
  dom: 'DOM',
  wasmHost: 'runs WebAssembly',
  wasmExport: 'exports a WebAssembly ABI',
  unsafe: 'unsafe code',
  clock: 'clock',
  random: 'randomness',
  environment: 'environment variables',
  stdio: 'standard input or output',
  messaging: 'postMessage messaging',
  dynamicCode: 'dynamic code (eval, new Function)',
}

export const patterns = {
  rust: {
    json: /\bserde_json\b|\bjson!\s*\(/u,
    jsonValue: /\bserde_json::(Value|Map)\b|use serde_json::\{[^}]*\b(Value|Map)\b|\bValue::(Object|Array|String|Null|Bool|Number)\b/u,
    serialization:
      /#\[derive\([^)]*\b(Serialize|Deserialize)\b|\bimpl(<[^>]*>)?\s+(serde::)?((de|ser)::)?(Serialize|Deserialize|DeserializeSeed|Visitor)(<[^>]*>)?\s+for\b|\bserde_yaml\b|\btoml::(from_str|to_string)|\bquick_xml\b|\bbincode\b|\bciborium\b/u,
    fs: /\bstd::fs\b|\bfs::(read|write|create_dir|remove|metadata|symlink_metadata|rename|copy|canonicalize|File|OpenOptions|hard_link)|\bFile::(open|create)\b|\btokio::fs\b/u,
    sdkFs: /\bcx\.(read_source|read_json|read_bytes|files|entry|is_dir|exists|input_exists)\(/u,
    process: /\bCommand::new\b|\bstd::process::Command\b/u,
    sdkProcess: /\bcx\.(run|helper)\(|\brun_helper\(/u,
    network: /\breqwest\b|\bureq\b|\bhyper\b|\bstd::net\b|\bTcp(Listener|Stream)\b|\bUdpSocket\b|\btiny_http\b|\baxum\b|\btokio::net\b/u,
    wasmHost: /\bwasmi::|\bwasmtime::|\bwasmer::/u,
    wasmExport: /#\[(unsafe\()?no_mangle\)?\]|\bextern\s+"C"\s+fn\b|\bwasm_bindgen\b/u,
    unsafe: /\bunsafe\s*(\{|fn\b|impl\b|extern\b)/u,
    clock: /\bSystemTime::now\b|\bInstant::now\b|\bchrono::|\bOffsetDateTime::now/u,
    random: /\brand::|\bgetrandom\b|\bUuid::new_v4\b|\bRandomState::new\b|\bthread_rng\b/u,
    environment: /\benv::var(s|_os)?\s*\(|\bstd::env::var/u,
    stdio: /\bstd::io::(stdin|stdout)\b|\bio::(stdin|stdout)\(\)/u,
  },
  javascript: {
    json: /\bJSON\.(parse|stringify)\s*\(/u,
    fs: /from\s+['"](node:)?fs(\/promises)?['"]|require\(\s*['"](node:)?fs(\/promises)?['"]|import\(\s*['"](node:)?fs/u,
    process: /from\s+['"](node:)?child_process['"]|require\(\s*['"](node:)?child_process['"]/u,
    network:
      /(^|[^.\w])fetch\s*\(|\bglobalThis\.fetch\b|from\s+['"](node:)?(http|https|http2|net|dgram|tls)['"]|\bnew\s+WebSocket\s*\(|\bXMLHttpRequest\b|\bnew\s+EventSource\s*\(|\bcreateServer\s*\(/u,
    // The DOM: the document's and the window's own members, React DOM, and the observers.
    dom: new RegExp(
      [
        /\bdocument\.(createElement|createElementNS|querySelector|querySelectorAll|getElementById|body|documentElement|head|addEventListener|defaultView|fonts|activeElement|visibilityState|hasFocus)\b/u,
        /\bwindow\.(addEventListener|location|parent|open|matchMedia|requestAnimationFrame|getComputedStyle|innerWidth|innerHeight|devicePixelRatio|scrollTo|getSelection)\b/u,
        /from\s+['"]react-dom(\/client)?['"]/u,
        /\bnew\s+(ResizeObserver|MutationObserver|IntersectionObserver)\b/u,
      ]
        .map(pattern => pattern.source)
        .join('|'),
    ),
    wasmHost: /\bWebAssembly\.(instantiate|compile|Module|Instance|validate|instantiateStreaming|compileStreaming)\b/u,
    clock: /\bDate\.now\s*\(|\bnew\s+Date\s*\(\s*\)|\bperformance\.now\s*\(/u,
    random: /\bMath\.random\s*\(|\brandomUUID\s*\(|\bgetRandomValues\s*\(|\brandomBytes\s*\(/u,
    environment: /\bprocess\.env\b|\bimport\.meta\.env\b/u,
    stdio: /\bprocess\.(stdin|stdout)\b/u,
    messaging: /\.postMessage\s*\(|\bonDidReceiveMessage\b|addEventListener\(\s*['"]message['"]|\bacquireVsCodeApi\s*\(|\bonmessage\s*=/u,
    dynamicCode: /\bnew\s+Function\s*\(|(^|[^.\w])eval\s*\(/u,
  },
  go: {
    json: /^\s*(import\s+)?(\w+\s+)?"encoding\/json"\s*\)?$/u,
    fs: /\bos\.(ReadFile|WriteFile|Open|Create|ReadDir|Stat|MkdirAll)\b/u,
    process: /^\s*(import\s+)?(\w+\s+)?"os\/exec"\s*\)?$/u,
    network: /^\s*(import\s+)?(\w+\s+)?"(net|net\/http)"\s*\)?$/u,
    unsafe: /^\s*(import\s+)?(\w+\s+)?"unsafe"\s*\)?$/u,
    clock: /\btime\.Now\(/u,
    random: /^\s*(import\s+)?(\w+\s+)?"(math\/rand|crypto\/rand)"\s*\)?$/u,
    environment: /\bos\.(Getenv|Environ|LookupEnv)\(/u,
    stdio: /\bos\.(Stdin|Stdout)\b/u,
  },
  python: {
    json: /^\s*import\s+json\b|^\s*from\s+json\s+import|\bjson\.(dumps|loads|dump|load)\(/u,
    fs: /\bopen\(|\bpathlib\b|\bos\.(listdir|walk|scandir)\(/u,
    process: /\bsubprocess\b|\bos\.system\(/u,
    network: /\burllib\b|\brequests\b|\bsocket\b|\bhttp\.client\b/u,
    clock: /\btime\.time\(|\bdatetime\.now\(/u,
    random: /^\s*import\s+random\b|\buuid\.uuid4\(/u,
    environment: /\bos\.environ\b|\bos\.getenv\(/u,
    stdio: /\bsys\.(stdin|stdout)\b/u,
  },
  java: {
    json: /com\.fasterxml\.jackson|\borg\.json\b|\bcom\.google\.gson\b|\bjakarta\.json\b/u,
    serialization: /\bimplements\s+Serializable\b/u,
    fs: /\bjava\.nio\.file\b|\bjava\.io\.File\b/u,
    process: /\bProcessBuilder\b|\bRuntime\.getRuntime\(\)\.exec\b/u,
    network: /\bjava\.net\.(URL|Socket|http)\b/u,
    clock: /\bSystem\.currentTimeMillis\(|\bInstant\.now\(/u,
    random: /\bjava\.util\.Random\b|\bUUID\.randomUUID\(/u,
    environment: /\bSystem\.getenv\(/u,
    stdio: /\bSystem\.(in|out)\b/u,
  },
  csharp: {
    json: /\bSystem\.Text\.Json\b|\bNewtonsoft\.Json\b|\bJsonSerializer\./u,
    fs: /\bSystem\.IO\b|\bFile\.(Read|Write|Open|Exists)/u,
    process: /\bSystem\.Diagnostics\.Process\b|\bProcess\.Start\(/u,
    network: /\bSystem\.Net\b|\bHttpClient\b/u,
    unsafe: /\bunsafe\s*\{|\bunsafe\s+(static|void|class|struct)\b/u,
    clock: /\bDateTime\.(Now|UtcNow)\b|\bStopwatch\b/u,
    random: /\bnew\s+Random\(|\bGuid\.NewGuid\(/u,
    environment: /\bEnvironment\.GetEnvironmentVariable\(/u,
    stdio: /\bConsole\.(In|Out|OpenStandardInput|OpenStandardOutput|ReadLine)\b/u,
  },
  shell: {
    process: /^\s*exec\s/u,
    environment: /\$\{?[A-Z_][A-Z0-9_]*\}?/u,
  },
}

// A file's module: its path without extension, `mod`, `index` or `lib` file names folded into their directory, and
// at most two segments deep (`src/runtime/process.rs` and `src/runtime.rs` are both `src/runtime`), so splitting a

// file into a directory changes nothing. Evidence keeps the file and line.
function moduleOf(relative) {
  const segments = relative.replace(/\.[^./]+$/u, '').split('/')
  if (segments.length > 1 && ['mod', 'index'].includes(segments.at(-1))) segments.pop()
  return segments.slice(0, 2).join('/')
}

/** Records each scanned unit's capabilities: the modules that use each, and each file's first use as evidence. */
export function scanCapabilities({units, unitFiles, linesOf}) {
  const MAX_EVIDENCE = 400
  for (const unit of units.values()) {
    if (!unit.scan) continue
    for (const entry of unitFiles.get(unit.id)) {
      if (entry.role !== 'source') continue
      const lines = linesOf(entry)
      for (const [capability, pattern] of Object.entries(patterns[entry.language] ?? {})) {
        const index = lines.findIndex(line => pattern.test(line))
        if (index < 0) continue
        ;(unit.capabilityFiles[capability] ??= []).push(moduleOf(entry.relative))
        if (unit.evidence.length < MAX_EVIDENCE) {
          unit.evidence.push({kind: `capability:${capability}`, source: entry.file, location: {line: index + 1}})
        }
      }
    }
  }
}
