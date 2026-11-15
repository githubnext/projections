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
    json: /\bserde_json\b|\bjson!\s*\(/,
    jsonValue: /\bserde_json::(Value|Map)\b|use serde_json::\{[^}]*\b(Value|Map)\b|\bValue::(Object|Array|String|Null|Bool|Number)\b/,
    serialization:
      /#\[derive\([^)]*\b(Serialize|Deserialize)\b|\bimpl(<[^>]*>)?\s+(serde::)?((de|ser)::)?(Serialize|Deserialize|DeserializeSeed|Visitor)\b(<[^>]*>)?\s+for\b|\bserde_yaml\b|\btoml::(from_str|to_string)|\bquick_xml\b|\bbincode\b|\bciborium\b/,
    fs: /\bstd::fs\b|\bfs::(read|write|create_dir|remove|metadata|symlink_metadata|rename|copy|canonicalize|read_dir|File|OpenOptions|hard_link)|\bFile::(open|create)\b|\btokio::fs\b/,
    sdkFs: /\bcx\.(read_source|read_json|read_bytes|files|entry|is_dir|exists|input_exists)\(/,
    process: /\bCommand::new\b|\bstd::process::Command\b/,
    sdkProcess: /\bcx\.(run|helper)\(|\brun_helper\(/,
    network: /\breqwest\b|\bureq\b|\bhyper\b|\bstd::net\b|\bTcp(Listener|Stream)\b|\bUdpSocket\b|\btiny_http\b|\baxum\b|\btokio::net\b/,
    wasmHost: /\bwasmi::|\bwasmtime::|\bwasmer::/,
    wasmExport: /#\[(unsafe\()?no_mangle\)?\]|\bextern\s+"C"\s+fn\b|\bwasm_bindgen\b/,
    unsafe: /\bunsafe\s*(\{|fn\b|impl\b|extern\b)/,
    clock: /\bSystemTime::now\b|\bInstant::now\b|\bchrono::|\bOffsetDateTime::now/,
    random: /\brand::|\bgetrandom\b|\bUuid::new_v4\b|\bRandomState::new\b|\bthread_rng\b/,
    environment: /\benv::var(s|_os)?\s*\(|\bstd::env::var/,
    stdio: /\bstd::io::(stdin|stdout)\b|\bio::(stdin|stdout)\(\)/,
  },
  javascript: {
    json: /\bJSON\.(parse|stringify)\s*\(/,
    fs: /from\s+['"](node:)?fs(\/promises)?['"]|require\(\s*['"](node:)?fs(\/promises)?['"]|import\(\s*['"](node:)?fs/,
    process: /from\s+['"](node:)?child_process['"]|require\(\s*['"](node:)?child_process['"]/,
    network:
      /(^|[^.\w])fetch\s*\(|\bglobalThis\.fetch\b|from\s+['"](node:)?(http|https|http2|net|dgram|tls)['"]|\bnew\s+WebSocket\s*\(|\bXMLHttpRequest\b|\bnew\s+EventSource\s*\(|\bcreateServer\s*\(/,
    // The DOM: the document's and the window's own members, React DOM, and the observers.
    dom: new RegExp(
      [
        /\bdocument\.(createElement|createElementNS|querySelector|querySelectorAll|getElementById|body|documentElement|head|addEventListener|defaultView|fonts|activeElement|visibilityState|hasFocus)\b/,
        /\bwindow\.(addEventListener|location|parent|open|matchMedia|requestAnimationFrame|getComputedStyle|innerWidth|innerHeight|devicePixelRatio|scrollTo|getSelection)\b/,
        /from\s+['"]react-dom(\/client)?['"]/,
        /\bnew\s+(ResizeObserver|MutationObserver|IntersectionObserver)\b/,
      ]
        .map(pattern => pattern.source)
        .join('|'),
    ),
    wasmHost: /\bWebAssembly\.(instantiate|compile|Module|Instance|validate|instantiateStreaming|compileStreaming)\b/,
    clock: /\bDate\.now\s*\(|\bnew\s+Date\s*\(\s*\)|\bperformance\.now\s*\(/,
    random: /\bMath\.random\s*\(|\brandomUUID\s*\(|\bgetRandomValues\s*\(|\brandomBytes\s*\(/,
    environment: /\bprocess\.env\b|\bimport\.meta\.env\b/,
    stdio: /\bprocess\.(stdin|stdout)\b/,
    messaging: /\.postMessage\s*\(|\bonDidReceiveMessage\b|addEventListener\(\s*['"]message['"]|\bacquireVsCodeApi\s*\(|\bonmessage\s*=/,
    dynamicCode: /\bnew\s+Function\s*\(|(^|[^.\w])eval\s*\(/,
  },
  go: {
    json: /^\s*(import\s+)?(\w+\s+)?"encoding\/json"\s*\)?$/,
    fs: /\bos\.(ReadFile|WriteFile|Open|Create|ReadDir|Stat|MkdirAll)\b/,
    process: /^\s*(import\s+)?(\w+\s+)?"os\/exec"\s*\)?$/,
    network: /^\s*(import\s+)?(\w+\s+)?"(net|net\/http)"\s*\)?$/,
    unsafe: /^\s*(import\s+)?(\w+\s+)?"unsafe"\s*\)?$/,
    clock: /\btime\.Now\(/,
    random: /^\s*(import\s+)?(\w+\s+)?"(math\/rand|crypto\/rand)"\s*\)?$/,
    environment: /\bos\.(Getenv|Environ|LookupEnv)\(/,
    stdio: /\bos\.(Stdin|Stdout)\b/,
  },
  python: {
    json: /^\s*import\s+json\b|^\s*from\s+json\s+import|\bjson\.(dumps|loads|dump|load)\(/,
    fs: /\bopen\(|\bpathlib\b|\bos\.(listdir|walk|scandir)\(/,
    process: /\bsubprocess\b|\bos\.system\(/,
    network: /\burllib\b|\brequests\b|\bsocket\b|\bhttp\.client\b/,
    clock: /\btime\.time\(|\bdatetime\.now\(/,
    random: /^\s*import\s+random\b|\buuid\.uuid4\(/,
    environment: /\bos\.environ\b|\bos\.getenv\(/,
    stdio: /\bsys\.(stdin|stdout)\b/,
  },
  java: {
    json: /com\.fasterxml\.jackson|\borg\.json\b|\bcom\.google\.gson\b|\bjakarta\.json\b/,
    serialization: /\bimplements\s+Serializable\b/,
    fs: /\bjava\.nio\.file\b|\bjava\.io\.File\b/,
    process: /\bProcessBuilder\b|\bRuntime\.getRuntime\(\)\.exec\b/,
    network: /\bjava\.net\.(URL|Socket|http)\b/,
    clock: /\bSystem\.currentTimeMillis\(|\bInstant\.now\(/,
    random: /\bjava\.util\.Random\b|\bUUID\.randomUUID\(/,
    environment: /\bSystem\.getenv\(/,
    stdio: /\bSystem\.(in|out)\b/,
  },
  csharp: {
    json: /\bSystem\.Text\.Json\b|\bNewtonsoft\.Json\b|\bJsonSerializer\./,
    fs: /\bSystem\.IO\b|\bFile\.(Read|Write|Open|Exists)/,
    process: /\bSystem\.Diagnostics\.Process\b|\bProcess\.Start\(/,
    network: /\bSystem\.Net\b|\bHttpClient\b/,
    unsafe: /\bunsafe\s*\{|\bunsafe\s+(static|void|class|struct)\b/,
    clock: /\bDateTime\.(Now|UtcNow)\b|\bStopwatch\b/,
    random: /\bnew\s+Random\(|\bGuid\.NewGuid\(/,
    environment: /\bEnvironment\.GetEnvironmentVariable\(/,
    stdio: /\bConsole\.(In|Out|OpenStandardInput|OpenStandardOutput|ReadLine)\b/,
  },
  shell: {
    process: /^\s*exec\s/,
    environment: /\$\{?[A-Z_][A-Z0-9_]*\}?/,
  },
}

// A file's module: its path without extension, `mod`, `index` or `lib` file names folded into their directory, and
// at most two segments deep (`src/runtime/process.rs` and `src/runtime.rs` are both `src/runtime`), so splitting a

// file into a directory changes nothing. Evidence keeps the file and line.
function moduleOf(relative) {
  const segments = relative.replace(/\.[^./]+$/, '').split('/')
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
        if (unit.evidence.length < MAX_EVIDENCE)
          unit.evidence.push({kind: `capability:${capability}`, source: entry.file, location: {line: index + 1}})
      }
    }
  }
}
