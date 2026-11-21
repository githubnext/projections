import {useEffect, useMemo, useState} from 'react'
import {Button, Popover, PopoverContent, PopoverTrigger, cn} from '@githubnext/projections-host/ui/components'
import type {Definition} from '@githubnext/projections-schemas'
import {Copy, RotateCcw, Save} from 'lucide-react'
import {copyText, useInspectorHost} from '../host.js'
import {lineDiff} from './line-diff.js'
import {changedParts} from './model.js'
import type {DefinitionWriter} from './model.js'
import {noop} from '../noop.js'

/**
 * Save to definition: the definition file's exact edit for the overrides, written by the local runner (behind its
 * token and `--trust`), or offered to copy when it can't write.
 */
export function SaveToDefinition({
  definition,
  saved,
  onResetAll,
  writer,
}: {
  definition: Definition
  saved: Definition
  onResetAll: () => void
  writer?: DefinitionWriter | undefined
}) {
  const [copied, setCopied] = useState(false)
  const [open, setOpen] = useState(false)
  const host = useInspectorHost()
  const [preview, setPreview] = useState<{path: string; before: string; after: string; digest: string} | undefined>()
  const [status, setStatus] = useState<{kind: 'saving' | 'error'; text?: string} | undefined>()
  const json = `${JSON.stringify(saved, null, 2)}\n`
  const parts = useMemo(() => changedParts(definition, saved), [definition, saved])
  const partsKey = JSON.stringify(parts)
  useEffect(() => {
    if (!open || !writer) return undefined
    let cancelled = false
    setPreview(undefined)
    setStatus(undefined)
    writer
      .preview(JSON.parse(partsKey) as Record<string, unknown>)
      .then(result => !cancelled && setPreview(result))
      .catch(
        (failure: unknown) => !cancelled && setStatus({kind: 'error', text: failure instanceof Error ? failure.message : String(failure)}),
      )
    return () => {
      cancelled = true
    }
  }, [open, writer, partsKey])
  // The runner's exact edit of the file when it can preview it; otherwise the definition as JSON.
  const diff = preview ? lineDiff(preview.before, preview.after) : lineDiff(`${JSON.stringify(definition, null, 2)}\n`, json)
  const save = async () => {
    if (!writer || !preview) return
    setStatus({kind: 'saving'})
    try {
      await writer.save(parts, preview.digest)
      setStatus(undefined)
      setOpen(false)
      writer.onSaved()
    } catch (failure) {
      setStatus({kind: 'error', text: failure instanceof Error ? failure.message : String(failure)})
    }
  }
  return (
    <div className="pi-x-block pj:flex pj:items-center pj:gap-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button type="button" size="sm" variant="outline" className="pj:h-7 pj:flex-1">
            <Save />
            <span>Save to definition…</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          collisionPadding={8}
          aria-label="Save to definition"
          className="pj:w-[min(30rem,calc(100vw-1rem))] pj:gap-2 pj:p-3"
        >
          <p className="pj:text-xs">
            {preview ? (
              <>
                This edits{' '}
                {host.openFile ? (
                  <button
                    type="button"
                    className="pi-source-path pj:cursor-pointer pj:font-mono pj:underline pj:underline-offset-2"
                    onClick={() => host.openFile!(preview.path)}
                  >
                    {preview.path}
                  </button>
                ) : (
                  <code className="pj:font-mono">{preview.path}</code>
                )}
                , the projection&apos;s source of truth; only its parts change.
              </>
            ) : (
              <>
                The definition file (<code className="pj:font-mono">{definition.id}.json</code> in{' '}
                <code className="pj:font-mono">.github/projections</code> or <code className="pj:font-mono">.projections</code>) stays the
                source of truth. Make this edit, or copy the whole definition.
              </>
            )}
          </p>
          <pre
            aria-label="Definition diff"
            className="pi-diff pj:max-h-64 pj:overflow-auto pj:rounded-sm pj:border pj:border-divider pj:bg-surface-inset pj:p-2 pj:font-mono pj:text-[11px] pj:leading-snug"
          >
            {diff.map((line, index) => (
              <div
                key={index}
                data-kind={line.kind === '+' ? 'added' : line.kind === '-' ? 'removed' : 'same'}
                className={cn(line.kind === '+' && 'pj:bg-added-muted', line.kind === '-' && 'pj:bg-removed-muted')}
              >
                {line.kind} {line.text}
              </div>
            ))}
          </pre>
          {writer?.disabled && <p className="pj:text-xs pj:text-muted-foreground">{writer.disabled}</p>}
          {status?.kind === 'error' && (
            <p role="alert" className="pj:text-xs pj:text-destructive">
              {status.text}
            </p>
          )}
          <div className="pj:flex pj:gap-1.5">
            {writer && (
              <Button
                type="button"
                size="sm"
                className="pj:h-7"
                disabled={!preview || Boolean(writer.disabled) || status?.kind === 'saving'}
                onClick={() => void save()}
              >
                <Save />
                <span>{status?.kind === 'saving' ? 'Saving…' : preview ? `Save to ${preview.path}` : 'Save'}</span>
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              variant={writer ? 'outline' : 'default'}
              className="pj:h-7"
              onClick={() => {
                void copyText(host, json)
                  .then(() => setCopied(true))
                  .catch(noop)
                setTimeout(() => setCopied(false), 2000)
              }}
            >
              <Copy />
              <span>{copied ? 'Copied' : 'Copy definition JSON'}</span>
            </Button>
          </div>
        </PopoverContent>
      </Popover>
      <Button type="button" size="sm" variant="ghost" className="pj:h-7" onClick={onResetAll}>
        <RotateCcw />
        <span>Reset all</span>
      </Button>
    </div>
  )
}
