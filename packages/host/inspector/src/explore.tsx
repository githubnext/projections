import {useCallback, useEffect, useMemo, useState} from 'react'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Checkbox,
  Label,
  ScopedRoot,
  useColorMode,
} from '@githubnext/projections-host/ui/components'
import {Compass, FilePlus2, ShieldAlert, Workflow} from 'lucide-react'
import type {InspectorApi} from './client/api.js'
import {copyText, useInspectorHost} from './host.js'
import {SweepGrid, type SweepLabels} from './sweep/grid.js'
import type {ExploreCandidate, OnboardingWrite} from './types.js'

/** A candidate's basis in words: "found `packages/a/package.json` and 3 more". */
export function basisText(candidate: Pick<ExploreCandidate, 'basis'>): {lead: string; path?: string; more?: number; pattern?: string} {
  const {pattern, count, examples} = candidate.basis
  if (pattern === '*' || pattern === '**/*') return {lead: `${count} files in the repository`}
  const first = examples[0] ?? ''
  return count > 1 ? {lead: 'found', path: first, more: count - 1, pattern} : {lead: 'found', path: first}
}

/** A write preview's files: each path, whether it's new, and its new content. */
function FilesPreview({preview}: {preview: OnboardingWrite}) {
  return (
    <ul className="pj:flex pj:flex-col pj:gap-2" aria-label="Files">
      {preview.files.map(file => (
        <li key={file.path} className="pj:flex pj:flex-col pj:gap-1">
          <span className="pj:flex pj:flex-wrap pj:items-center pj:gap-2 pj:text-sm">
            <code className="pj:font-mono">{file.path}</code>
            <Badge variant="outline">{!file.changed ? 'Unchanged' : file.created ? 'New file' : 'Updated'}</Badge>
          </span>
          {file.changed && (
            <details open={preview.files.length <= 2}>
              <summary className="pj:cursor-pointer pj:text-xs pj:text-muted-foreground">
                {preview.written ? 'Content' : 'Content to write'}
              </summary>
              <pre className="pi-file-preview pj:mt-1 pj:max-h-72 pj:overflow-auto pj:rounded-md pj:border pj:border-divider pj:p-2 pj:font-mono pj:text-xs">
                {file.after}
              </pre>
            </details>
          )}
        </li>
      ))}
    </ul>
  )
}

const message = (failure: unknown) => (failure instanceof Error ? failure.message : String(failure))

/** Adopt: preview the definitions and bookmarks the selected candidates write, then write them. */
function AdoptPanel({
  api,
  selected,
  titles,
  onAdopted,
}: {
  api: InspectorApi
  selected: string[]
  titles: Map<string, string>
  onAdopted: () => void
}) {
  const [preview, setPreview] = useState<OnboardingWrite | undefined>()
  const [result, setResult] = useState<OnboardingWrite | undefined>()
  const [error, setError] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)
  const key = selected.join(',')
  // A different selection needs a new preview.
  useEffect(() => setPreview(undefined), [key])
  if (!selected.length && !result) return null
  const names = selected.map(id => titles.get(id) ?? id).join(', ')
  const act = (run: () => Promise<void>) => {
    setBusy(true)
    setError(undefined)
    run()
      .catch((failure: unknown) => setError(message(failure)))
      .finally(() => setBusy(false))
  }
  return (
    <section
      aria-labelledby="pi-adopt-title"
      className="pi-onboarding pj:flex pj:flex-col pj:gap-3 pj:rounded-md pj:border pj:border-divider pj:p-4"
    >
      <h2 id="pi-adopt-title" className="pj:flex pj:items-center pj:gap-2 pj:text-base pj:font-semibold">
        <FilePlus2 className="pj:size-4" aria-hidden="true" />
        Adopt
      </h2>
      {result && (
        <Alert>
          <AlertTitle>Adopted {result.adopted?.join(', ')}</AlertTitle>
          <AlertDescription>Commit the files below. Then add them to your CI, below, or tune one live in the Inspector.</AlertDescription>
        </Alert>
      )}
      {result && <FilesPreview preview={result} />}
      {selected.length > 0 && (
        <>
          <p className="pj:text-sm">
            Adopting {names} writes {selected.length === 1 ? 'its definition' : 'their definitions'} and bookmarks the recent changes{' '}
            {selected.length === 1 ? 'it' : 'they'} showed the most on, so the team can come back to them. Nothing is replaced.
          </p>
          {preview && <FilesPreview preview={preview} />}
          {preview?.bookmarked && preview.bookmarked.length > 0 && (
            <ul className="pj:flex pj:flex-col pj:gap-0.5 pj:text-xs" aria-label="Bookmarks">
              {preview.bookmarked.map(bookmark => (
                <li key={bookmark.id}>
                  Bookmarks <code className="pj:font-mono">{bookmark.id}</code>: {bookmark.change.title}
                </li>
              ))}
            </ul>
          )}
          <div className="pj:flex pj:flex-wrap pj:gap-2">
            {!preview ? (
              <Button
                size="sm"
                disabled={busy}
                onClick={() => act(async () => setPreview(await api.adopt({projections: selected, dryRun: true})))}
              >
                Preview adopting {selected.length === 1 ? names : `${selected.length} projections`}
              </Button>
            ) : (
              <>
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    act(async () => {
                      const written = await api.adopt({projections: selected, digest: preview.digest})
                      setResult(written)
                      setPreview(undefined)
                      onAdopted()
                    })
                  }
                >
                  Write {preview.files.length === 1 ? 'the file' : `${preview.files.length} files`}
                </Button>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => setPreview(undefined)}>
                  Cancel
                </Button>
              </>
            )}
          </div>
        </>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </section>
  )
}

/** The prompt that hands adding Projections to CI to a coding agent: the same as docs/setup/ci.md's. */
const addToCiPrompt = "Add Projections to this repository's CI: run `projections help agents ci` and follow what it prints."
const addToCiGuide = 'https://github.com/githubnext/projections/blob/main/docs/setup/ci.md'

/**
 * Add to CI: where the Projections step goes depends on the repository's CI (usually the job that already installs and
 * builds), so nothing here writes a workflow. The host's agent gets the prompt, or the person copies it or reads the guide.
 */
function AddToCiPanel() {
  const host = useInspectorHost()
  const [copied, setCopied] = useState<'copied' | 'failed' | undefined>()
  return (
    <section
      aria-labelledby="pi-ci-title"
      className="pi-onboarding pj:flex pj:flex-col pj:gap-3 pj:rounded-md pj:border pj:border-divider pj:p-4"
    >
      <h2 id="pi-ci-title" className="pj:flex pj:items-center pj:gap-2 pj:text-base pj:font-semibold">
        <Workflow className="pj:size-4" aria-hidden="true" />
        Add to CI
      </h2>
      <p className="pj:text-sm">
        Once the projections you want are adopted, one step in your CI runs them on every pull request: each run summarizes how they
        changed. Where it belongs depends on your CI, usually the job that already installs your dependencies and builds, so your coding
        agent reads your workflows and proposes the change before writing it.
      </p>
      <pre className="pj:overflow-x-auto pj:whitespace-pre-wrap pj:rounded pj:bg-muted pj:p-2 pj:font-mono pj:text-xs" aria-label="Prompt">
        {addToCiPrompt}
      </pre>
      <div className="pj:flex pj:flex-wrap pj:items-center pj:gap-2">
        {host.addToCi && (
          <Button size="sm" onClick={() => host.addToCi?.()}>
            Ask your coding agent
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            copyText(host, addToCiPrompt).then(
              () => setCopied('copied'),
              () => setCopied('failed'),
            )
          }
        >
          Copy the prompt
        </Button>
        <Button asChild size="sm" variant="outline">
          <a
            href={addToCiGuide}
            target="_blank"
            rel="noreferrer"
            onClick={event => {
              if (!host.openExternal) return
              event.preventDefault()
              host.openExternal(addToCiGuide)
            }}
          >
            Read the guide
          </a>
        </Button>
        {copied && (
          <span role="status" className="pj:text-xs pj:text-muted-foreground">
            {copied === 'copied' ? 'Copied. Paste it into your coding agent.' : 'The clipboard is unavailable: copy the prompt above.'}
          </span>
        )}
      </div>
    </section>
  )
}

/**
 * The Explore view: the projections that apply to this repository, proposed by `projections explore` from the files it
 * holds, each with why; how each does on recent changes; and adopting the useful ones and adding them to CI. Nothing is
 * written until a projection is adopted.
 */
export function ExplorePage({api, sweepLabels}: {api: InspectorApi; sweepLabels?: SweepLabels | undefined}) {
  const colorMode = useColorMode()
  const [candidates, setCandidates] = useState<ExploreCandidate[] | undefined>()
  const [session, setSession] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const titles = useMemo(() => new Map((candidates ?? []).map(candidate => [candidate.id, candidate.title])), [candidates])
  const adoptable = useMemo(() => new Map((candidates ?? []).map(candidate => [candidate.id, {adopted: candidate.adopted}])), [candidates])
  const load = useCallback(
    (signal?: AbortSignal) =>
      api
        .explore(signal)
        .then(result => {
          setCandidates(result.candidates)
          setSession(result.session)
        })
        .catch((failure: unknown) => !signal?.aborted && setError(message(failure))),
    [api],
  )
  useEffect(() => {
    const abort = new AbortController()
    void load(abort.signal)
    return () => abort.abort()
  }, [load])
  const select = (id: string, value: boolean) =>
    setSelected(current => {
      const next = new Set(current)
      if (value) next.add(id)
      else next.delete(id)
      return next
    })
  const chosen = (candidates ?? []).filter(candidate => selected.has(candidate.id) && !candidate.adopted).map(candidate => candidate.id)
  return (
    <ScopedRoot colorMode={colorMode} className="pi pi-explore">
      <main className="pj:mx-auto pj:flex pj:min-h-dvh pj:max-w-7xl pj:flex-col pj:gap-4 pj:bg-background pj:p-6 pj:text-foreground">
        <header className="pj:flex pj:flex-col pj:gap-1">
          <h1 className="pj:flex pj:items-center pj:gap-2 pj:text-lg pj:font-semibold">
            <Compass className="pj:size-5" aria-hidden="true" />
            Explore this repository
          </h1>
          <p className="pj:text-sm pj:text-muted-foreground">
            The projections that apply here, found from the files the repository holds. Try them on recent changes, keep the useful ones,
            then add them to your CI. Nothing is written until you adopt a projection.
          </p>
        </header>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {candidates && !candidates.length && (
          <p className="pj:text-sm">
            No built-in projection applies to this repository. Build one for it with{' '}
            <code className="pj:font-mono">projections init &lt;id&gt;</code>.
          </p>
        )}
        {candidates && candidates.length > 0 && (
          <ul
            aria-label="Candidates"
            className="pj:flex pj:flex-col pj:divide-y pj:divide-divider pj:rounded-md pj:border pj:border-divider"
          >
            {candidates.map(candidate => {
              const basis = basisText(candidate)
              const checkbox = `pi-candidate-${candidate.id}`
              return (
                <li key={candidate.id} className="pi-candidate pj:flex pj:flex-col pj:gap-1 pj:p-3" data-candidate={candidate.id}>
                  <div className="pj:flex pj:flex-wrap pj:items-baseline pj:gap-2">
                    <span className="pj:font-medium">{candidate.title}</span>
                    <code className="pj:font-mono pj:text-xs pj:text-muted-foreground">{candidate.id}</code>
                    {candidate.adopted && <Badge variant="secondary">Adopted as {candidate.adopted}</Badge>}
                    {candidate.requiresTrust && (
                      <Badge variant="outline" className="pj:gap-1">
                        <ShieldAlert className="pj:size-3" aria-hidden="true" />
                        Runs repository code
                      </Badge>
                    )}
                    {!candidate.adopted && (
                      <span className="pj:ml-auto pj:flex pj:items-center pj:gap-2 pj:self-center">
                        <Checkbox
                          id={checkbox}
                          checked={selected.has(candidate.id)}
                          onCheckedChange={value => select(candidate.id, value === true)}
                        />
                        <Label htmlFor={checkbox} className="pj:text-xs">
                          Adopt
                        </Label>
                      </span>
                    )}
                  </div>
                  <p className="pj:text-xs pj:text-muted-foreground">{candidate.description}</p>
                  <p className="pj:text-xs">
                    {basis.lead}
                    {basis.path && (
                      <>
                        {' '}
                        <code className="pj:font-mono">{basis.path}</code>
                      </>
                    )}
                    {basis.more !== undefined && (
                      <>
                        {' '}
                        and {basis.more} more matching <code className="pj:font-mono">{basis.pattern}</code>
                      </>
                    )}
                    {' · '}
                    <code className="pj:font-mono">{candidate.schema}</code> drawn by{' '}
                    <code className="pj:font-mono">{candidate.renderer}</code>
                  </p>
                </li>
              )
            })}
          </ul>
        )}
        {candidates && (
          <SweepGrid
            api={api}
            titles={titles}
            start={session}
            adoptable={adoptable}
            selected={selected}
            onSelect={select}
            labels={sweepLabels}
          />
        )}
        {candidates && (
          <AdoptPanel
            api={api}
            selected={chosen}
            titles={titles}
            onAdopted={() => {
              setSelected(new Set())
              void load()
            }}
          />
        )}
        {candidates && <AddToCiPanel />}
        <footer className="pj:flex pj:gap-2">
          <Button asChild variant="outline" size="sm">
            <a href="?view=inspect">Open the Inspector</a>
          </Button>
        </footer>
      </main>
    </ScopedRoot>
  )
}
