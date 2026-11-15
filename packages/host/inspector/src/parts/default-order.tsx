import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from '@githubnext/projections-host/ui/components'
import type {DefaultComparatorOptions} from '@githubnext/projections-schemas'

const orderChoices: {value: string; label: string}[] = [{value: 'none', label: 'As extracted'}]

/** The default comparator's ordering: by dependents or a `data.*` field, ascending or descending. */
export function DefaultOrder({
  dataFields,
  order,
  onOrder,
}: {
  dataFields: readonly string[]
  order: DefaultComparatorOptions['order'] | undefined
  onOrder: (order: DefaultComparatorOptions['order'] | undefined) => void
}) {
  const by = order?.by ?? 'none'
  const choices = [
    ...orderChoices,
    {value: 'dependents', label: 'Dependents'},
    ...dataFields.map(field => ({value: `data.${field}`, label: `data.${field}`})),
  ]
  return (
    <div className="pi-order pj:flex pj:items-center pj:gap-1 pj:pt-0.5">
      <Select
        value={by}
        onValueChange={value =>
          onOrder(
            value === 'none' ? undefined : {by: value as 'dependents' | `data.${string}`, direction: order?.direction ?? 'descending'},
          )
        }
      >
        <SelectTrigger size="sm" aria-label="Order changes by" className="pj:h-7 pj:min-w-0 pj:flex-1 pj:bg-background pj:text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper" align="start" collisionPadding={8}>
          {choices.map(choice => (
            <SelectItem key={choice.value} value={choice.value} className="pj:py-1 pj:text-xs">
              {choice.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={order?.direction ?? 'descending'}
        disabled={!order}
        onValueChange={value => order && onOrder({...order, direction: value as 'ascending' | 'descending'})}
      >
        <SelectTrigger size="sm" aria-label="Order direction" className="pj:h-7 pj:w-28 pj:bg-background pj:text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper" align="start" collisionPadding={8}>
          <SelectItem value="descending" className="pj:py-1 pj:text-xs">
            Descending
          </SelectItem>
          <SelectItem value="ascending" className="pj:py-1 pj:text-xs">
            Ascending
          </SelectItem>
        </SelectContent>
      </Select>
    </div>
  )
}
