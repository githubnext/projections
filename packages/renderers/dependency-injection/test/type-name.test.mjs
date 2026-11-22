import {test} from 'node:test'
import assert from 'node:assert/strict'
import {buildDiModel} from '../node_modules/.cache/test/model.js'
import {shortTypeName} from '../node_modules/.cache/test/type-name.js'

test('a closed generic type reads with its arguments, each without its namespace', () => {
  const cases = [
    ['IOptions`1[Workbench.Storage.InventoryOptions]', 'IOptions<InventoryOptions>'],
    ['Microsoft.Extensions.Options.IOptions<Workbench.Storage.InventoryOptions>', 'IOptions<InventoryOptions>'],
    // Several arguments, nested generics and arrays, in reflection and source form.
    [
      'System.Collections.Generic.Dictionary`2[System.String,System.Collections.Generic.List`1[Workbench.Item]]',
      'Dictionary<String, List<Item>>',
    ],
    ['Dictionary<string, List<Workbench.Item[]>>', 'Dictionary<string, List<Item[]>>'],
    // Assembly-qualified arguments, each in its own brackets.
    [
      'Workbench.ICache`1[[Workbench.Storage.Inventory, Workbench, Version=1.0.0.0, Culture=neutral, PublicKeyToken=null]]',
      'ICache<Inventory>',
    ],
    // Plain and open generic names, as before; a nested type keeps its outer one.
    ['Workbench.Storage.InventoryStore', 'InventoryStore'],
    ['Workbench.IRepository`1', 'IRepository'],
    ['Workbench.Outer+Inner', 'Outer+Inner'],
    // A nested type's arguments go to the types that declare them, in order.
    ['Workbench.Outer`1+Inner[System.String]', 'Outer<String>+Inner'],
    ['Workbench.Outer`1+Inner`1[System.String,Workbench.Item]', 'Outer<String>+Inner<Item>'],
    [
      'Workbench.Outer`1+Inner`2[[System.String, mscorlib],[Workbench.Item, Workbench],[System.Int32, mscorlib]]',
      'Outer<String>+Inner<Item, Int32>',
    ],
    ['Workbench.Outer`1+Inner`1', 'Outer+Inner'],
    ['Workbench.Item[]', 'Item[]'],
  ]
  for (const [name, shown] of cases) assert.equal(shortTypeName(name), shown, name)
})

test("a name it can't read is shortened at its last dot", () => {
  assert.equal(shortTypeName('Workbench.Broken`1[Workbench.Item'), 'Item')
})

test("a closed generic service's card names it whole", () => {
  const options = 'Microsoft.Extensions.Options.IOptions`1[Workbench.Storage.InventoryOptions]'
  const model = buildDiModel({
    entities: [
      {id: 'service:options', kind: 'service', label: options, data: {key: 'unkeyed'}},
      {id: 'service:options:registration:0', kind: 'registration', label: `${options} [0]`, data: {lifetime: 'Singleton', ordinal: 0}},
    ],
    relationships: [{id: 'registration:options', kind: 'registration', from: 'service:options', to: 'service:options:registration:0'}],
  })
  const unit = model.units.find(item => item.id === 'service:options')
  assert.equal(unit.implementation, 'IOptions<InventoryOptions>')
})
