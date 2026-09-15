namespace TanStackDemo.Api;

public class Manufacturer {
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Ref { get; set; } = string.Empty;
    public string Address { get; set; } = string.Empty;
    public string City { get; set; } = string.Empty;
    public string Country { get; set; } = string.Empty;

    public ICollection<Product> Products { get; set; } = new List<Product>();
}
