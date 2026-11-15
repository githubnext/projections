using Microsoft.EntityFrameworkCore;

namespace MinimalHost;

public interface IGreeter { }
public sealed class Greeter : IGreeter { }

public sealed class Item
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
}

public sealed class ShopContext(DbContextOptions<ShopContext> options) : DbContext(options)
{
    protected override void OnModelCreating(ModelBuilder model) => model.Entity<Item>().ToTable("items");
}
