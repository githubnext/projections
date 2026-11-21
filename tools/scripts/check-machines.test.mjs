import {test} from 'node:test'
import {RuleTester} from 'eslint'
import {lifecycleRule} from './check-machines/lifecycle-rule.mjs'

RuleTester.describe = (_name, run) => run()
RuleTester.it = (name, run) => test(name, run)
RuleTester.itOnly = RuleTester.it
const tester = new RuleTester({languageOptions: {ecmaVersion: 'latest', sourceType: 'module'}})

tester.run('machines/lifecycle', lifecycleRule, {
  valid: [
    // A ref holding something other than a flag, a timer outside an effect, and a setter called directly.
    'const element = useRef(null); const id = setTimeout(tick, 10)',
    'const [value, setValue] = useState(0); useEffect(() => { setValue(1) })',
    // A machine's send from a deferred callback is how results reach it.
    'const [state, send] = useMachine(machine, options); useEffect(() => { load().then(result => send({type: "loaded", result})) })',
    // A function called from a promise callback that isn't a useState setter, even one named like a setter elsewhere.
    'load().then(result => record(result))',
    'function A() { const [v, setValue] = useState(0) } function B(setValue) { load().then(() => setValue(1)) }',
  ],
  invalid: [
    {code: 'const pressed = useRef(false)', errors: [{messageId: 'booleanRef'}]},
    {code: 'useLayoutEffect(() => { const frame = requestAnimationFrame(measure) })', errors: [{messageId: 'timerInEffect'}]},
    {code: 'React.useEffect(() => { window.setTimeout(() => undefined, 0) })', errors: [{messageId: 'timerInEffect'}]},
    {
      code: 'const [rows, setRows] = useState([]); useEffect(() => { fetchRows().then(rows => setRows(rows)) })',
      errors: [{messageId: 'deferredSetState', data: {setter: 'setRows', callback: 'then'}}],
    },
    {
      code: 'function Copy() { const [copied, setCopied] = useState(false); return () => setTimeout(() => setCopied(false), 1000) }',
      errors: [{messageId: 'deferredSetState', data: {setter: 'setCopied', callback: 'setTimeout'}}],
    },
  ],
})
