// shadcn/ui components (radix-vega style, shadcn@4.23.0, MIT; see LICENSE.shadcn.txt) with the `pj-` prefix, for Projections apps.
// Render them inside `ScopedRoot` and load `@githubnext/projections-host/ui.css`.
import type {ComponentProps} from 'react'
import type {Badge} from './badge.js'
import type {Button} from './button.js'
import type {NativeSelect} from './native-select.js'

export {ScopedRoot} from './scoped-root.js'
export type {ScopedRootProps} from './scoped-root.js'
export {Alert, AlertDescription, AlertTitle} from './alert.js'
export {Badge, badgeVariants} from './badge.js'
export {Button, buttonVariants} from './button.js'
export {ButtonGroup, ButtonGroupSeparator, ButtonGroupText, buttonGroupVariants} from './button-group.js'
export {Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle} from './card.js'
export {Checkbox} from './checkbox.js'
export {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from './dropdown-menu.js'
export {Input} from './input.js'
export {Label} from './label.js'
export {NativeSelect, NativeSelectOptGroup, NativeSelectOption} from './native-select.js'
export {Popover, PopoverAnchor, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger} from './popover.js'
export {ProjectionsMark} from './projections-mark.js'
export type {ProjectionsMarkProps} from './projections-mark.js'
export {Range} from './range.js'
export type {RangeProps} from './range.js'
export {ScrollArea, ScrollBar} from './scroll-area.js'
export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from './select.js'
export {SegmentedControl, SegmentedControlItem} from './segmented-control.js'
export {Separator} from './separator.js'
export {Slider} from './slider.js'
export {Table, TableBody, TableCaption, TableCell, TableFooter, TableHead, TableHeader, TableRow} from './table.js'
export {Tabs, TabsContent, TabsList, TabsTrigger} from './tabs.js'
export {Toggle, toggleVariants} from './toggle.js'
export {Toolbar, ToolbarButton, ToolbarLink, ToolbarSeparator, ToolbarToggleGroup, ToolbarToggleItem} from './toolbar.js'
export {ToggleGroup, ToggleGroupItem} from './toggle-group.js'
export {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from './tooltip.js'
export {cn} from '../lib/utils.js'

/** Props of the vendored components, which upstream doesn't name. */
export type BadgeProps = ComponentProps<typeof Badge>
/** The props of the vendored `Button`: a native `button`'s, its `variant` and `size`, and `asChild`. */
export type ButtonProps = ComponentProps<typeof Button>
/** The props of the vendored `NativeSelect`: a native `select`'s, and its `size`. */
export type NativeSelectProps = ComponentProps<typeof NativeSelect>
export {PortalContainerContext, usePortalContainer} from '../lib/portal.js'
export {useColorMode} from '../lib/color-mode.js'
export {fitWidth, toolbarHysteresis, useFitPlan} from '../fit-plan.js'
export type {FitPlanOptions} from '../fit-plan.js'
export {
  projectorPalette,
  projectorRendererTokens,
  projectorSurfaces,
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- The former name stays exported until it is removed.
  shadcnPalette,
  shadcnRendererTokens,
  sharedSurfaceNames,
} from '../lib/tokens.js'
