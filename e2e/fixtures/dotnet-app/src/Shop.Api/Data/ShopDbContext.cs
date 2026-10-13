using Microsoft.EntityFrameworkCore;

namespace Shop.Api.Data;

public class ShopDbContext(DbContextOptions<ShopDbContext> options) : DbContext(options) { }
