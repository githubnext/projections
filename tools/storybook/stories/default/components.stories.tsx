import {useState} from 'react'
import type {Meta, StoryObj} from '@storybook/react-vite'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Checkbox,
  Input,
  Label,
  NativeSelect,
  Range,
  ScrollArea,
  SegmentedControl,
  SegmentedControlItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  Slider,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Toggle,
  ToggleGroup,
  ToggleGroupItem,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@githubnext/projections-host/ui/components'
import {withDefaultFrame} from '../../src/default-frame.js'

/**
 * The scoped shadcn/ui components (`@githubnext/projections-host/ui/components`) the default UI, the Inspector and
 * the static site compose. Layout here is inline: the stylesheet contains only the utilities the host UI uses.
 */
const meta = {
  title: 'Default UI/Components',
  decorators: [withDefaultFrame],
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

const column = {display: 'grid', gap: 16, maxWidth: 560} as const

export const Buttons: Story = {
  render: () => (
    <div style={column}>
      <div className="sb-row">
        {(['default', 'secondary', 'outline', 'ghost', 'destructive', 'link'] as const).map(variant => (
          <Button key={variant} variant={variant}>
            {variant}
          </Button>
        ))}
      </div>
      <div className="sb-row">
        <Button size="sm">Small</Button>
        <Button>Default</Button>
        <Button size="lg">Large</Button>
        <Button disabled>Disabled</Button>
      </div>
      <div className="sb-row">
        {(['default', 'secondary', 'outline', 'destructive'] as const).map(variant => (
          <Badge key={variant} variant={variant}>
            {variant}
          </Badge>
        ))}
      </div>
    </div>
  ),
}

export const Alerts: Story = {
  render: () => (
    <div style={column}>
      <Alert>
        <AlertTitle>Renderer substituted</AlertTitle>
        <AlertDescription>The requested renderer is unavailable, so the built-in one is shown.</AlertDescription>
      </Alert>
      <Alert variant="destructive">
        <AlertTitle>These extractions can't be compared.</AlertTitle>
        <AlertDescription>The schemas differ (graph/v0 and dag/v0).</AlertDescription>
      </Alert>
    </div>
  ),
}

function FormControls() {
  const [range, setRange] = useState(40)
  return (
    <div style={column}>
      <div style={{display: 'grid', gap: 6}}>
        <Label htmlFor="sb-input">Filter rows</Label>
        <Input id="sb-input" placeholder="Find an item" />
      </div>
      <div className="sb-row">
        <Checkbox id="sb-check" defaultChecked />
        <Label htmlFor="sb-check">Changes only</Label>
      </div>
      <div style={{display: 'grid', gap: 6}}>
        <Label htmlFor="sb-native">Compare from</Label>
        <NativeSelect id="sb-native" defaultValue="before">
          <option value="">Nothing (show one revision)</option>
          <option value="before">Before</option>
          <option value="after">After</option>
        </NativeSelect>
      </div>
      <div className="sb-row">
        <Label htmlFor="sb-range">Transition</Label>
        <Range id="sb-range" min={0} max={100} value={range} onChange={event => setRange(event.target.valueAsNumber)} />
        <output htmlFor="sb-range">{range}%</output>
      </div>
      <Slider defaultValue={[60]} max={100} step={1} aria-label="Speed" />
      <Select defaultValue="graph">
        <SelectTrigger style={{width: 200}} aria-label="Renderer">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="graph">Graph</SelectItem>
          <SelectItem value="treemap">Treemap</SelectItem>
          <SelectItem value="minimal">Minimal outline</SelectItem>
        </SelectContent>
      </Select>
    </div>
  )
}
export const Forms: Story = {name: 'Form controls', render: () => <FormControls />}

function Choices() {
  const [mode, setMode] = useState('animated')
  const [view, setView] = useState('renderer')
  return (
    <div style={column}>
      <SegmentedControl aria-label="Comparison mode" value={mode} onValueChange={setMode}>
        <SegmentedControlItem value="animated">Animated</SegmentedControlItem>
        <SegmentedControlItem value="side-by-side">Side by side</SegmentedControlItem>
        <SegmentedControlItem value="swipe">Swipe</SegmentedControlItem>
      </SegmentedControl>
      <ToggleGroup type="single" variant="outline" value={view} onValueChange={value => value && setView(value)} aria-label="View">
        <ToggleGroupItem value="renderer">Renderer</ToggleGroupItem>
        <ToggleGroupItem value="table">Table</ToggleGroupItem>
        <ToggleGroupItem value="text">Text</ToggleGroupItem>
      </ToggleGroup>
      <div className="sb-row">
        <Toggle aria-label="Highlight changes" defaultPressed>
          Highlight
        </Toggle>
        <Toggle variant="outline" aria-label="Show unchanged">
          Unchanged
        </Toggle>
      </div>
      <Tabs defaultValue="renderer">
        <TabsList>
          <TabsTrigger value="renderer">Renderer</TabsTrigger>
          <TabsTrigger value="table">Table</TabsTrigger>
          <TabsTrigger value="text">Text</TabsTrigger>
        </TabsList>
        <TabsContent value="renderer">The renderer's sandboxed frame.</TabsContent>
        <TabsContent value="table">The host's built-in table.</TabsContent>
        <TabsContent value="text">The host's built-in text view.</TabsContent>
      </Tabs>
    </div>
  )
}
export const Selection: Story = {name: 'Segmented control, toggles and tabs', render: () => <Choices />}

export const Tooltips: Story = {
  render: () => (
    <TooltipProvider delayDuration={0}>
      <Tooltip defaultOpen>
        <TooltipTrigger asChild>
          <Button variant="outline">Swap</Button>
        </TooltipTrigger>
        <TooltipContent>Swap the compared revisions</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  ),
}

const changes = [
  ['checkout', 'added'],
  ['payments', 'modified'],
  ['legacy-billing', 'removed'],
  ['orders', 'unchanged'],
] as const

export const Surfaces: Story = {
  name: 'Card, table and scroll area',
  render: () => (
    <Card style={{maxWidth: 560}}>
      <CardHeader>
        <CardTitle>Service platform</CardTitle>
        <CardDescription>Before → After · 4 changes</CardDescription>
      </CardHeader>
      <CardContent>
        <ScrollArea style={{height: 168}}>
          <Table>
            <TableCaption>Changed items</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead>Change</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {changes.map(([id, status]) => (
                <TableRow key={id}>
                  <TableCell>{id}</TableCell>
                  <TableCell>
                    <Badge variant={status === 'removed' ? 'destructive' : status === 'unchanged' ? 'outline' : 'secondary'}>
                      {status}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ScrollArea>
      </CardContent>
      <Separator />
      <CardFooter style={{paddingTop: 16}}>
        <Button size="sm" variant="outline">
          Open table view
        </Button>
      </CardFooter>
    </Card>
  ),
}
