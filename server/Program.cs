using System.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Data.Sqlite;

var builder = WebApplication.CreateBuilder(args);
var dataDirectory = Path.Combine(builder.Environment.ContentRootPath, "Data");
Directory.CreateDirectory(dataDirectory);
builder.Services.AddDbContext<ReservationDb>(options =>
    options.UseSqlite($"Data Source={Path.Combine(dataDirectory, "reservations.db")}"));

var app = builder.Build();
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<ReservationDb>();
    db.Database.EnsureCreated();
    if (!db.Users.Any())
    {
        db.Users.AddRange(new User { Id = 1, Name = "Alex Morgan", Role = "Staff" },
            new User { Id = 2, Name = "Taylor Chen", Role = "Staff" },
            new User { Id = 3, Name = "Jordan Lee", Role = "Admin" });
        db.SaveChanges();
    }
    if (!db.Sites.Any())
    {
        db.Sites.AddRange(
            new Site { Name = "Main Campus", Address = "100 Education Drive" },
            new Site { Name = "Learning Center", Address = "25 Library Lane" },
            new Site { Name = "North Annex", Address = "12 North Street" });
        db.SaveChanges();
        var sites = db.Sites.OrderBy(x => x.Id).ToArray();
        db.Rooms.AddRange(
            new Room { SiteId = sites[0].Id, Name = "Conference A", Capacity = 12, Features = "Display · Whiteboard" },
            new Room { SiteId = sites[0].Id, Name = "Workshop Studio", Capacity = 24, Features = "Projector · Flexible seating" },
            new Room { SiteId = sites[1].Id, Name = "Meeting Room 201", Capacity = 8, Features = "Video conferencing" },
            new Room { SiteId = sites[1].Id, Name = "Training Suite", Capacity = 32, Features = "Projector · Whiteboard" },
            new Room { SiteId = sites[2].Id, Name = "Collaboration Hub", Capacity = 16, Features = "Display · Hybrid meetings" });
        db.SaveChanges();
    }
}

// Demo personas make the workflow easy to present. These IDs are not authentication.

app.MapGet("/api/bootstrap", async (ReservationDb db) => new
{
    users = await db.Users.OrderBy(u => u.Id).ToListAsync(),
    sites = await db.Sites.OrderBy(s => s.Name).ToListAsync(),
    rooms = await db.Rooms.Include(r => r.Site).OrderBy(r => r.Site!.Name).ThenBy(r => r.Name)
        .Select(r => new { r.Id, r.SiteId, SiteName = r.Site!.Name, r.Name, r.Capacity, r.Features, r.IsActive })
        .ToListAsync()
});

app.MapGet("/api/rooms", async (ReservationDb db, int? siteId, int? capacity,
    DateTimeOffset? start, DateTimeOffset? end) =>
{
    if ((start.HasValue != end.HasValue) || (start.HasValue && end <= start))
        return Results.BadRequest(new { error = "Provide a valid start and end time." });
    IQueryable<Room> rooms = db.Rooms.Include(r => r.Site).Where(r => r.IsActive);
    if (siteId.HasValue) rooms = rooms.Where(r => r.SiteId == siteId);
    if (capacity.HasValue) rooms = rooms.Where(r => r.Capacity >= capacity);
    var rows = await rooms.OrderBy(r => r.Site!.Name).ThenBy(r => r.Name).ToListAsync();
    var busyIds = new HashSet<int>();
    if (start.HasValue)
    {
        var from = start.Value.UtcDateTime;
        var to = end!.Value.UtcDateTime;
        busyIds = (await db.Reservations.Where(r => r.Status != "Denied" && r.StartUtc < to && from < r.EndUtc)
            .Select(r => r.RoomId).Distinct().ToListAsync()).ToHashSet();
    }
    return Results.Ok(rows.Select(r => new { r.Id, r.SiteId, SiteName = r.Site!.Name,
        r.Name, r.Capacity, r.Features, Available = !busyIds.Contains(r.Id) }));
});

app.MapGet("/api/reservations", async (ReservationDb db, int? userId, bool? upcoming) =>
{
    IQueryable<Reservation> query = db.Reservations.Include(r => r.Room).ThenInclude(r => r!.Site);
    if (userId.HasValue) query = query.Where(r => r.UserId == userId);
    if (upcoming == true) query = query.Where(r => r.EndUtc >= DateTime.UtcNow);
    var rows = await query.OrderBy(r => r.StartUtc).ToListAsync();
    var names = await db.Users.ToDictionaryAsync(u => u.Id, u => u.Name);
    return Results.Ok(rows.Select(r => new ReservationView(r.Id, r.RoomId, r.Room!.Name,
        r.Room.Site!.Name, r.UserId, names.GetValueOrDefault(r.UserId, "Unknown"),
        r.Title, DateTime.SpecifyKind(r.StartUtc, DateTimeKind.Utc),
        DateTime.SpecifyKind(r.EndUtc, DateTimeKind.Utc), r.Status)));
});

app.MapPost("/api/reservations", async (ReservationDb db, CreateReservation input) =>
{
    if (!await db.Users.AnyAsync(u => u.Id == input.UserId && u.Role == "Staff"))
        return Results.BadRequest(new { error = "Choose a staff member." });
    if (string.IsNullOrWhiteSpace(input.Title) || input.Title.Trim().Length > 100)
        return Results.BadRequest(new { error = "Enter a title (up to 100 characters)." });
    var from = input.Start.UtcDateTime;
    var to = input.End.UtcDateTime;
    if (from < DateTime.UtcNow.AddMinutes(-1) || to <= from || to - from > TimeSpan.FromHours(12))
        return Results.BadRequest(new { error = "Choose a future time window of at most 12 hours." });
    try
    {
        // SQLite starts a write transaction before the overlap check. Concurrent requests serialize.
        await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable);
        var room = await db.Rooms.FindAsync(input.RoomId);
        if (room is null || !room.IsActive) return Results.NotFound(new { error = "Room not found." });
        if (await HasConflict(db, room.Id, from, to))
            return Results.Conflict(new { error = "That room is already requested or booked for this time." });
        var reservation = new Reservation { RoomId = room.Id, UserId = input.UserId,
            Title = input.Title.Trim(), StartUtc = from, EndUtc = to, Status = "Pending" };
        db.Reservations.Add(reservation);
        await db.SaveChangesAsync();
        await transaction.CommitAsync();
        return Results.Created($"/api/reservations/{reservation.Id}", new { reservation.Id, reservation.Status });
    }
    catch (SqliteException e) when (e.SqliteErrorCode == 5 || e.SqliteErrorCode == 6)
    { return Results.Conflict(new { error = "The room is busy. Please retry." }); }
});

app.MapPatch("/api/reservations/{id:int}/decision", async (ReservationDb db, int id, Decision input) =>
{
    if (!await db.Users.AnyAsync(u => u.Id == input.AdminUserId && u.Role == "Admin")
        || input.Status is not ("Approved" or "Denied"))
        return Results.BadRequest(new { error = "Choose an admin and a valid decision." });
    try
    {
        await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable);
        var reservation = await db.Reservations.FindAsync(id);
        if (reservation is null) return Results.NotFound();
        if (reservation.Status != "Pending")
            return Results.Conflict(new { error = "This request has already been decided." });
        if (input.Status == "Approved" && await HasConflict(db, reservation.RoomId,
            reservation.StartUtc, reservation.EndUtc, reservation.Id))
            return Results.Conflict(new { error = "Another reservation now conflicts with this request." });
        reservation.Status = input.Status;
        await db.SaveChangesAsync();
        await transaction.CommitAsync();
        return Results.Ok(new { reservation.Id, reservation.Status });
    }
    catch (SqliteException e) when (e.SqliteErrorCode == 5 || e.SqliteErrorCode == 6)
    { return Results.Conflict(new { error = "The reservation changed. Please retry." }); }
});

app.MapPost("/api/sites", async (ReservationDb db, NewSite input) =>
{
    if (string.IsNullOrWhiteSpace(input.Name) || input.Name.Trim().Length > 80)
        return Results.BadRequest(new { error = "Enter a site name (up to 80 characters)." });
    var site = new Site { Name = input.Name.Trim(), Address = input.Address?.Trim() ?? "" };
    db.Sites.Add(site);
    await db.SaveChangesAsync();
    return Results.Created($"/api/sites/{site.Id}", site);
});

app.MapPost("/api/rooms", async (ReservationDb db, NewRoom input) =>
{
    if (!await db.Sites.AnyAsync(s => s.Id == input.SiteId) || string.IsNullOrWhiteSpace(input.Name)
        || input.Name.Trim().Length > 80 || input.Capacity is < 1 or > 500)
        return Results.BadRequest(new { error = "Choose a site, room name, and capacity from 1 to 500." });
    var room = new Room { SiteId = input.SiteId, Name = input.Name.Trim(), Capacity = input.Capacity,
        Features = input.Features?.Trim() ?? "" };
    db.Rooms.Add(room);
    await db.SaveChangesAsync();
    return Results.Created($"/api/rooms/{room.Id}", new { room.Id });
});

app.MapPatch("/api/rooms/{id:int}/active", async (ReservationDb db, int id, SetRoomActive input) =>
{
    var room = await db.Rooms.FindAsync(id);
    if (room is null) return Results.NotFound();
    room.IsActive = input.IsActive;
    await db.SaveChangesAsync();
    return Results.Ok(new { room.Id, room.IsActive });
});

app.Run();

static Task<bool> HasConflict(ReservationDb db, int roomId, DateTime from, DateTime to, int excludeId = 0) =>
    db.Reservations.AnyAsync(r => r.RoomId == roomId && r.Id != excludeId && r.Status != "Denied"
        && r.StartUtc < to && from < r.EndUtc);

record CreateReservation(int RoomId, int UserId, string Title, DateTimeOffset Start, DateTimeOffset End);
record Decision(int AdminUserId, string Status);
record NewSite(string Name, string? Address);
record NewRoom(int SiteId, string Name, int Capacity, string? Features);
record SetRoomActive(bool IsActive);
record ReservationView(int Id, int RoomId, string RoomName, string SiteName, int UserId, string UserName,
    string Title, DateTime StartUtc, DateTime EndUtc, string Status);

class ReservationDb(DbContextOptions<ReservationDb> options) : DbContext(options)
{
    public DbSet<Site> Sites => Set<Site>();
    public DbSet<User> Users => Set<User>();
    public DbSet<Room> Rooms => Set<Room>();
    public DbSet<Reservation> Reservations => Set<Reservation>();

    protected override void OnModelCreating(ModelBuilder model)
    {
        model.Entity<Reservation>().HasIndex(r => new { r.RoomId, r.StartUtc, r.EndUtc });
    }
}

class Site { public int Id { get; set; } public string Name { get; set; } = "";
    public string Address { get; set; } = ""; }
class User { public int Id { get; set; } public string Name { get; set; } = "";
    public string Role { get; set; } = "Staff"; }
class Room { public int Id { get; set; } public int SiteId { get; set; }
    public Site? Site { get; set; } public string Name { get; set; } = "";
    public int Capacity { get; set; } public string Features { get; set; } = "";
    public bool IsActive { get; set; } = true; }
class Reservation { public int Id { get; set; } public int RoomId { get; set; }
    public Room? Room { get; set; } public int UserId { get; set; }
    public string Title { get; set; } = ""; public DateTime StartUtc { get; set; }
    public DateTime EndUtc { get; set; } public string Status { get; set; } = "Pending"; }
