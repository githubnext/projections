export class Cart {
  items: string[] = []

  add(item: string) {
    this.items.push(item)
  }

  remove(item: string) {
    this.items = this.items.filter(existing => existing !== item)
  }
}
