// The scoped stylesheet inside a page with hostile global styles (packages/host/core/browser/embed.spec.ts).
import {StrictMode, useState} from 'react'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  Input,
  Label,
  ScopedRoot,
  ScrollArea,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  Slider,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  ToggleGroup,
  ToggleGroupItem,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@githubnext/projections-host/ui/components'
import {ProjectionView} from '@githubnext/projections-host/ui'
import type {ViewSubject} from '@githubnext/projections-host'
import '@githubnext/projections-host/ui.css'
import {usePageStyles} from '../page-styles.js'
import hostile from './embed.css?inline'

/**
 * Every shadcn component inside one scoped root, so the browser test can probe them against the page's styles.
 * Only classes that src/ui already uses exist in dist/ui.css; the rest of the layout is inline.
 */
function Showcase({colorMode}: {colorMode: 'light' | 'dark'}) {
  const [mode, setMode] = useState('side-by-side')
  return (
    <ScopedRoot colorMode={colorMode} data-testid={`${colorMode}-root`}>
      <TooltipProvider delayDuration={0}>
        <div className="pj:flex pj:flex-col pj:bg-background pj:text-foreground" style={{gap: 16, padding: 16}} data-testid="surface">
          <h2 className="pj:font-semibold" style={{fontSize: 18}} data-testid="heading">
            Scoped heading
          </h2>
          <div className="pj:flex pj:items-center pj:gap-2" style={{flexWrap: 'wrap'}}>
            <Button data-testid="button">Primary</Button>
            <Button variant="outline">Outline</Button>
            <Badge data-testid="badge">Badge</Badge>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="sm" data-testid="tooltip-trigger">
                  Hint
                </Button>
              </TooltipTrigger>
              <TooltipContent data-testid="tooltip">Tooltip text</TooltipContent>
            </Tooltip>
          </div>
          <Alert variant="destructive" data-testid="alert">
            <AlertTitle>Removed</AlertTitle>
            <AlertDescription>Three nodes were removed.</AlertDescription>
          </Alert>
          <Tabs defaultValue="graph">
            <TabsList>
              <TabsTrigger value="graph">Graph</TabsTrigger>
              <TabsTrigger value="table">Table</TabsTrigger>
            </TabsList>
            <TabsContent value="graph">Graph view</TabsContent>
            <TabsContent value="table">Table view</TabsContent>
          </Tabs>
          <ToggleGroup
            type="single"
            value={mode}
            onValueChange={value => {
              if (value) setMode(value)
            }}
            variant="outline"
          >
            <ToggleGroupItem value="side-by-side">Side by side</ToggleGroupItem>
            <ToggleGroupItem value="swipe">Swipe</ToggleGroupItem>
          </ToggleGroup>
          <Slider defaultValue={[40]} max={100} step={1} aria-label="Transition" />
          <div className="pj:flex pj:items-center pj:gap-2">
            <Checkbox id={`${colorMode}-check`} defaultChecked data-testid="checkbox" />
            <Label htmlFor={`${colorMode}-check`}>Show unchanged</Label>
          </div>
          <Input placeholder="Filter" data-testid="input" />
          <Select defaultValue="graph">
            <SelectTrigger style={{width: 192}} data-testid="select-trigger">
              <SelectValue />
            </SelectTrigger>
            <SelectContent data-testid="select-content">
              <SelectItem value="graph">Graph</SelectItem>
              <SelectItem value="table">Table</SelectItem>
              <SelectItem value="text">Text</SelectItem>
            </SelectContent>
          </Select>
          <Separator />
          <Card data-testid="card">
            <CardHeader>
              <CardTitle>Card</CardTitle>
              <CardDescription>Description</CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea style={{height: 96}}>
                <Table data-testid="table">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Node</TableHead>
                      <TableHead>Change</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow>
                      <TableCell data-testid="cell">checkout</TableCell>
                      <TableCell style={{color: 'var(--pj-added)'}}>added</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>payments</TableCell>
                      <TableCell style={{color: 'var(--pj-removed)'}}>removed</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>audit</TableCell>
                      <TableCell style={{color: 'var(--pj-modified)'}}>modified</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </ScrollArea>
            </CardContent>
          </Card>
        </div>
      </TooltipProvider>
    </ScopedRoot>
  )
}

/** The real default UI, without a renderer (table and text views only). */
const subject: ViewSubject = {
  mode: 'extraction',
  extraction: {
    protocolVersion: 0,
    schema: 'graph/v0',
    entities: [
      {id: 'checkout', kind: 'service', label: 'Checkout'},
      {id: 'payments', kind: 'service', label: 'Payments'},
    ],
    relationships: [{id: 'checkout->payments', kind: 'calls', from: 'checkout', to: 'payments'}],
  },
}

/** The embedding page: its own elements and styles (loaded after ui.css), then the UI. */
export function EmbedHarness() {
  usePageStyles(hostile)
  return (
    <StrictMode>
      <h2 id="page-heading">Embedding page</h2>
      <button id="page-button" type="button">
        Page button
      </button>
      <table id="page-table">
        <tbody>
          <tr>
            <td>page</td>
            <td>table</td>
          </tr>
        </tbody>
      </table>
      <div id="page-spinner"></div>
      <div id="mount">
        <Showcase colorMode="light" />
        <Showcase colorMode="dark" />
        <ProjectionView subject={subject} projection={{id: 'embedded', title: 'Embedded projection'}} colorMode="light" />
      </div>
    </StrictMode>
  )
}
