import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'

type User = { id: number; name: string; role: 'Staff' | 'Admin' }
type Site = { id: number; name: string; address: string }
type Room = { id: number; siteId: number; siteName: string; name: string; capacity: number; features: string; isActive?: boolean; available?: boolean }
type Reservation = { id: number; roomId: number; roomName: string; siteName: string; userId: number; userName: string; title: string; startUtc: string; endUtc: string; status: 'Pending' | 'Approved' | 'Denied' }
type Tab = 'explore' | 'mine' | 'admin'

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  })
  if (!response.ok) {
    const data = await response.json().catch(() => ({})) as { error?: string }
    throw new Error(data.error ?? `Request failed (${response.status})`)
  }
  return response.json() as Promise<T>
}

function localDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
function interval(date: string, from: string, to: string) {
  const start = new Date(`${date}T${from}`)
  const end = new Date(`${date}T${to}`)
  return { start, end, valid: !isNaN(+start) && !isNaN(+end) && end > start }
}
function time(iso: string) { return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) }

export default function App() {
  const initialHour = new Date().getHours() >= 20 ? 9 : Math.max(8, new Date().getHours() + 1)
  const initialDate = new Date()
  if (initialDate.getHours() >= 20) initialDate.setDate(initialDate.getDate() + 1)
  const [tab, setTab] = useState<Tab>('explore')
  const [users, setUsers] = useState<User[]>([])
  const [userId, setUserId] = useState(1)
  const [sites, setSites] = useState<Site[]>([])
  const [allRooms, setAllRooms] = useState<Room[]>([])
  const [rooms, setRooms] = useState<Room[]>([])
  const [reservations, setReservations] = useState<Reservation[]>([])
  const [siteId, setSiteId] = useState('all')
  const [capacity, setCapacity] = useState('')
  const [date, setDate] = useState(localDate(initialDate))
  const [from, setFrom] = useState(`${String(initialHour).padStart(2, '0')}:00`)
  const [to, setTo] = useState(`${String(initialHour + 1).padStart(2, '0')}:00`)
  const [selected, setSelected] = useState<number | null>(null)
  const [title, setTitle] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [siteName, setSiteName] = useState('')
  const [siteAddress, setSiteAddress] = useState('')
  const [roomName, setRoomName] = useState('')
  const [roomCapacity, setRoomCapacity] = useState('12')
  const [roomFeatures, setRoomFeatures] = useState('')
  const [newRoomSite, setNewRoomSite] = useState('')

  const person = users.find(u => u.id === userId)
  const slot = useMemo(() => interval(date, from, to), [date, from, to])
  const currentRoom = rooms.find(r => r.id === selected)

  const reload = useCallback(async () => {
    const [data, bookings] = await Promise.all([
      api<{ users: User[]; sites: Site[]; rooms: Room[] }>('/bootstrap'),
      api<Reservation[]>('/reservations'),
    ])
    setUsers(data.users)
    setSites(data.sites)
    setAllRooms(data.rooms)
    setReservations(bookings)
    setNewRoomSite(previous => previous || String(data.sites[0]?.id ?? ''))
  }, [])

  useEffect(() => { reload().catch(e => setError(String(e))) }, [reload])
  useEffect(() => {
    if (!slot.valid) { setRooms([]); return }
    const params = new URLSearchParams({ start: slot.start.toISOString(), end: slot.end.toISOString() })
    if (siteId !== 'all') params.set('siteId', siteId)
    if (capacity) params.set('capacity', capacity)
    let cancelled = false
    api<Room[]>(`/rooms?${params}`).then(result => { if (!cancelled) setRooms(result) })
      .catch(e => { if (!cancelled) setError(String(e)) })
    return () => { cancelled = true }
  }, [slot, siteId, capacity, reservations])

  async function perform(action: () => Promise<unknown>, message: string): Promise<boolean> {
    setBusy(true); setError(''); setNotice('')
    try { await action(); await reload(); setNotice(message); return true }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); return false }
    finally { setBusy(false) }
  }

  function reserve(event: FormEvent) {
    event.preventDefault()
    if (!selected || !slot.valid || !person || person.role !== 'Staff') return
    perform(() => api('/reservations', { method: 'POST', body: JSON.stringify({ roomId: selected,
      userId, title, start: slot.start.toISOString(), end: slot.end.toISOString() }) }),
      'Request sent. It is awaiting approval.').then(ok => { if (ok) { setTitle(''); setSelected(null) } })
  }

  function decide(id: number, status: 'Approved' | 'Denied') {
    perform(() => api(`/reservations/${id}/decision`, { method: 'PATCH',
      body: JSON.stringify({ adminUserId: userId, status }) }), `Reservation ${status.toLowerCase()}.`)
  }

  function addSite(event: FormEvent) {
    event.preventDefault()
    perform(() => api('/sites', { method: 'POST', body: JSON.stringify({ name: siteName, address: siteAddress }) }),
      'Site added.').then(ok => { if (ok) { setSiteName(''); setSiteAddress('') } })
  }
  function addRoom(event: FormEvent) {
    event.preventDefault()
    perform(() => api('/rooms', { method: 'POST', body: JSON.stringify({ name: roomName, siteId: Number(newRoomSite),
      capacity: Number(roomCapacity), features: roomFeatures }) }), 'Room added.')
      .then(ok => { if (ok) { setRoomName(''); setRoomFeatures('') } })
  }

  const myReservations = reservations.filter(r => r.userId === userId && new Date(r.endUtc) >= new Date())
  const pending = reservations.filter(r => r.status === 'Pending' && new Date(r.endUtc) >= new Date())
  const availableCount = rooms.filter(r => r.available).length

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand"><span className="brand-mark">S</span><span>spaces<span className="brand-period">.</span></span></div>
      <div className="top-right"><span className="demo-label">DEMO WORKSPACE</span>
        <label className="user-picker"><span className="avatar">{person?.name.slice(0, 1) ?? 'A'}</span>
          <select aria-label="Choose demo user" value={userId} onChange={e => { setUserId(Number(e.target.value)); setTab('explore'); setSelected(null) }}>
            {users.map(u => <option key={u.id} value={u.id}>{u.name} · {u.role}</option>)}
          </select></label></div>
    </header>

    <main className="page">
      <div className="eyebrow">WORKSPACE / RESERVATIONS</div>
      <section className="intro"><div><h1>Find your space<span>.</span></h1><p>Good meetings start with the right room. Find a space across our sites and make it yours.</p></div>
        <div className="intro-stat"><strong>{sites.length.toString().padStart(2, '0')}</strong><span>SITES TO EXPLORE</span></div></section>

      <nav className="tabs" aria-label="Main navigation">
        <button className={tab === 'explore' ? 'active' : ''} onClick={() => setTab('explore')}>Explore spaces</button>
        <button className={tab === 'mine' ? 'active' : ''} onClick={() => setTab('mine')}>My reservations <span className="count">{myReservations.length}</span></button>
        {person?.role === 'Admin' && <button className={tab === 'admin' ? 'active' : ''} onClick={() => setTab('admin')}>Admin desk <span className="count">{pending.length}</span></button>}
      </nav>
      {error && <div className="message error" role="alert">{error}<button onClick={() => setError('')} aria-label="Dismiss error">×</button></div>}
      {notice && <div className="message success" role="status">{notice}<button onClick={() => setNotice('')} aria-label="Dismiss message">×</button></div>}

      {tab === 'explore' && <>
        <div className="section-heading"><div><div className="eyebrow">BROWSE & BOOK</div><h2>Available rooms</h2></div><span className="result-count">{availableCount} available for your time</span></div>
        <div className="filters">
          <label>LOCATION<select value={siteId} onChange={e => { setSiteId(e.target.value); setSelected(null) }}><option value="all">All sites</option>{sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
          <label>DATE<input type="date" min={localDate(new Date())} value={date} onChange={e => { setDate(e.target.value); setSelected(null) }} /></label>
          <label>FROM<input type="time" value={from} onChange={e => { setFrom(e.target.value); setSelected(null) }} /></label>
          <label>TO<input type="time" value={to} onChange={e => { setTo(e.target.value); setSelected(null) }} /></label>
          <label>MIN. PEOPLE<input type="number" min="1" max="500" value={capacity} placeholder="Any" onChange={e => setCapacity(e.target.value)} /></label>
        </div>
        {!slot.valid && <p className="field-error">End time must be later than start time.</p>}
        <div className="content-grid"><div className="room-list">
          {rooms.length === 0 && <div className="empty">No rooms match these filters. Try another site or time.</div>}
          {rooms.map((room, index) => <article key={room.id} className={`room-card ${selected === room.id ? 'selected' : ''}`}>
            <div className={`room-illustration tone-${index % 3}`} aria-hidden="true"><span className="illustration-window"/><span className="illustration-table"/><span className="illustration-leg"/></div>
            <div className="room-info"><span className="site-tag">{room.siteName}</span><h3>{room.name}</h3>
              <p><span className="person-icon">♙</span> Up to {room.capacity} people <span className="dot">·</span> {room.features || 'Flexible space'}</p>
              <div className="room-footer"><span className={room.available ? 'availability' : 'unavailable'}><span className="status-dot"/>{room.available ? 'Available' : 'Unavailable'}</span>
                <button disabled={!room.available || person?.role !== 'Staff'} className="link-button" onClick={() => setSelected(room.id)}>
                  {selected === room.id ? 'Selected ✓' : 'Select room →'}</button></div></div></article>)}
        </div><aside className="booking-card"><div className="booking-top"><span className="eyebrow">YOUR BOOKING</span><span className="booking-icon">↗</span></div>
          <h3>Make room for<br/>what matters.</h3><p>Choose an available room, then send a request for approval.</p>
          <div className="booking-detail"><span>SELECTED SPACE</span><strong>{currentRoom?.name ?? 'Choose a room'}</strong></div>
          <div className="booking-detail"><span>DATE & TIME</span><strong>{date ? new Date(`${date}T12:00`).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '—'}<br/>{from} – {to}</strong></div>
          {person?.role === 'Staff' ? <form onSubmit={reserve}><label className="form-label">MEETING TITLE<input required maxLength={100} value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Team planning" /></label>
            <button className="primary-button" disabled={busy || !currentRoom?.available || !slot.valid}>Request reservation <span>↗</span></button></form>
            : <p className="admin-hint">Switch to a staff persona to request a room.</p>}
          <div className="booking-note">Requests stay pending until an admin approves them.</div>
        </aside></div>
      </>}

      {tab === 'mine' && <section className="panel-section"><div className="section-heading"><div><div className="eyebrow">YOUR SCHEDULE</div><h2>Upcoming reservations</h2></div></div>
        {person?.role === 'Admin' ? <div className="empty">Switch to a staff persona to view their reservations.</div>
          : <ReservationList rows={myReservations} empty="No upcoming reservations yet. Explore spaces to get started." />}</section>}

      {tab === 'admin' && person?.role === 'Admin' && <section className="panel-section"><div className="section-heading"><div><div className="eyebrow">ADMIN DESK</div><h2>Reservation requests</h2></div><span className="result-count">{pending.length} awaiting review</span></div>
        <ReservationList rows={pending} empty="All caught up. There are no pending requests." action={(r) => <div className="actions"><button disabled={busy} className="approve" onClick={() => decide(r.id, 'Approved')}>Approve</button><button disabled={busy} className="deny" onClick={() => decide(r.id, 'Denied')}>Deny</button></div>} />
        <div className="management"><div className="section-heading"><div><div className="eyebrow">SPACE DIRECTORY</div><h2>Manage locations</h2></div></div>
          <div className="management-grid"><div className="manage-panel"><h3>Add a site</h3><form onSubmit={addSite}><label>Site name<input required maxLength={80} value={siteName} onChange={e => setSiteName(e.target.value)} placeholder="e.g. East Campus" /></label><label>Address<input value={siteAddress} onChange={e => setSiteAddress(e.target.value)} placeholder="Optional" /></label><button className="secondary-button" disabled={busy}>Add site +</button></form></div>
            <div className="manage-panel"><h3>Add a room</h3><form onSubmit={addRoom}><label>Site<select required value={newRoomSite} onChange={e => setNewRoomSite(e.target.value)}>{sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label><label>Room name<input required maxLength={80} value={roomName} onChange={e => setRoomName(e.target.value)} placeholder="e.g. Seminar Room" /></label><div className="two-fields"><label>Capacity<input required type="number" min="1" max="500" value={roomCapacity} onChange={e => setRoomCapacity(e.target.value)} /></label><label>Features<input value={roomFeatures} onChange={e => setRoomFeatures(e.target.value)} placeholder="Display, whiteboard" /></label></div><button className="secondary-button" disabled={busy}>Add room +</button></form></div></div>
          <div className="directory"><h3>Room directory</h3>{allRooms.map(room => <div key={room.id} className="directory-row"><div><strong>{room.name}</strong><span>{room.siteName} · {room.capacity} people</span></div><button disabled={busy} onClick={() => perform(() => api(`/rooms/${room.id}/active`, { method: 'PATCH', body: JSON.stringify({ isActive: !room.isActive }) }), room.isActive ? 'Room hidden from search.' : 'Room restored.')}>{room.isActive ? 'Deactivate' : 'Activate'}</button></div>)}</div>
        </div></section>}
    </main><footer>SPACES <span>·</span> ROOM RESERVATION DEMO <span>·</span> TIU 11 CODING CHALLENGE</footer>
  </div>
}

function ReservationList({ rows, empty, action }: { rows: Reservation[]; empty: string; action?: (row: Reservation) => ReactNode }) {
  if (!rows.length) return <div className="empty">{empty}</div>
  return <div className="reservation-list">{rows.map(row => <article key={row.id} className="reservation-row">
    <div className="reservation-initial">{row.roomName[0]}</div><div className="reservation-main"><div className="reservation-title">{row.title} <span className={`badge ${row.status.toLowerCase()}`}>{row.status}</span></div><div className="reservation-meta">{row.roomName} · {row.siteName} · {row.userName}</div><div className="reservation-time">{time(row.startUtc)} – {new Date(row.endUtc).toLocaleTimeString(undefined, { timeStyle: 'short' })}</div></div>{action?.(row)}
  </article>)}</div>
}
