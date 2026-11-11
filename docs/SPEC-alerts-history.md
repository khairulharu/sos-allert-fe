# SPEC — Alerts page: Sent & Received history (FRONTEND)

Status: **draft, belum diimplementasi**
Repo: `frontend` (Svelte 5 + Vite)
Spec sisi backend (sumber kontrak): `../backend/docs/SPEC-alerts-history.md`
Blocker: endpoint `GET /api/sos/history` + `GET /api/sos/summary` harus ada di
backend dan `api/api.md` / `api/api-spec.json` sudah di-copy ulang ke
`frontend/api/` sebelum pekerjaan ini dimulai.

---

## 1. Keputusan UI

- Tab jadi **dua**: `Sent` dan `Received`. Tab **`All` dihapus** — "semua alert"
  tidak bisa dinyatakan oleh satu query paged, dan menggabungkan dua halaman
  membuat `paging` berbohong.
- Setiap tab memakai satu `role` (`sent` / `received`) sehingga `paging`,
  `total_item`, dan tombol "Load more" selalu benar.
- Kartu ringkasan memakai `GET /api/sos/summary` (bukan turunan dari halaman
  yang sedang tampil):

| Kartu | Nilai | Copy |
|---|---|---|
| 1 | `sent.total` | "All time · alerts sent" |
| 2 | `responded.resolved` | "Resolved · you answered" |
| 3 | `received.active` | "Incoming · active" |

Kartu ke-3 **jangan** berlabel "nearby" selama `GET /api/sos/nearby` belum ada:
inbox ≠ alert di sekitar. Kalau Fase 3 backend dikerjakan, ganti isinya ke
`nearby.count` dan barulah label "Nearby" boleh dipakai.

---

## 2. Kondisi sekarang (`src/lib/components/AlertsView.svelte`)

- `load()` hanya memanggil `sos.active()` + `sos.inbox()` (keduanya aktif-only),
  lalu merge + dedupe by `alert_id`.
- `sentCount` = jumlah alert di list (aktif saja) → bukan total.
- `helpedCount` = jumlah `statusKey === 'RESOLVED'` di list → **selalu 0**,
  karena dua endpoint sumbernya memfilter status aktif
  (`ListActiveBySender` / `ListInbox` di backend).
- `normalize()` menebak `type` dari `sender.id === $session.user.id`, bukan dari
  peran query.
- `statusLabel` tidak punya `EXPIRED`.
- Tidak ada pagination; limit backend 20 per sumber.

---

## 3. Kontrak yang dikonsumsi

Detail lengkap + aturan ada di spec backend §3. Ringkas untuk frontend:

### `GET /api/sos/history`

```
?role=sent|received&status=&page=1&size=20
```

- `status` kosong = semua; nilai yang boleh dikirim: `active`, `closed`,
  `TRIGGERED`, `ACKNOWLEDGED`, `RESOLVED`, `CANCELLED`, `EXPIRED`.
- Response: `{ data: AlertDetailResponse[], paging: { page, size, total_item, total_page } }`.
- Item memakai bentuk `AlertDetailResponse` yang sudah dikenal, **tanpa**
  `responders[]` dan `breadcrumbs` (list riwayat tidak memakainya; detail
  participant tetap lewat `GET /api/sos/{alertId}`).
- `masked: true` + koordinat dibulatkan ~100 m bila kita bukan sender dan bukan
  responder → label lokasi harus tetap "perkiraan" (footer copy).
- Field opsional **absen** (`omitempty`), bukan `null`: `severity`, `summary`,
  `masked`, `resolved_at`, `cancelled_at`, `latest_location.updated_at`. Jadi
  `a.masked` absen = bukan masked, `a.resolved_at` absen = belum selesai.
- Error yang ditangani: `400` (param salah — bug frontend), `401` (sesi habis,
  ditangani global di `App.svelte`), `500` (tampilkan error + Retry).

### `GET /api/sos/summary`

```json
{ "data": {
  "sent":      { "total": 12, "active": 1, "resolved": 8, "cancelled": 2, "expired": 1 },
  "received":  { "total": 6,  "active": 2, "resolved": 3, "cancelled": 1, "expired": 0 },
  "responded": { "total": 4,  "resolved": 3 }
} }
```

Gagal dimuat → tampilkan `—` (bukan `0`).

---

## 4. TODO frontend

### 4.1 `src/lib/api.js`

- [ ] Helper paging — `request()` saat ini hanya mengembalikan `payload.data`,
      jadi `paging` hilang:

```js
async function requestPaged(path) {
  const resp = await request('GET', path, undefined, { raw: true })
  const payload = await resp.json().catch(() => null)
  return { items: payload?.data ?? [], paging: payload?.paging ?? null }
}
```

- [ ] Tambah ke `export const sos`:

```js
history: ({ role = 'sent', status = '', page = 1, size = 20 } = {}) => {
  const q = new URLSearchParams({ role, page: String(page), size: String(size) })
  if (status) q.set('status', status)
  return requestPaged(`/api/sos/history?${q.toString()}`)
},
summary: () => request('GET', '/api/sos/summary'),
```

### 4.2 `src/lib/components/AlertsView.svelte`

State:

```js
let role = $state('sent')          // 'sent' | 'received'
let statusFilter = $state('all')   // 'all' | 'active' | 'closed'
let items = $state([])
let page = $state(1)
let totalPage = $state(1)
let totalItem = $state(0)
let loading = $state(true)
let loadingMore = $state(false)
let error = $state('')
let summary = $state(null)
let summaryError = $state(false)
```

- [ ] **Hapus tab `All`**: `tabs = [{ id: 'sent', label: 'Sent' }, { id: 'received', label: 'Received' }]`;
      tidak ada lagi request `active`/`inbox` untuk halaman ini.
- [ ] `load({ append = false } = {})`:
  - `status` dikirim `''` untuk `all`, `active`/`closed` untuk chip.
  - reset: `items = []`, `page = 1`; append: `page + 1`.
  - **sequence guard** — respons lama tidak boleh menimpa state tab/filter baru:

```js
let seq = 0
async function load({ append = false } = {}) {
  const my = ++seq
  const nextPage = append ? page + 1 : 1
  ;(append ? (loadingMore = true) : (loading = true))
  error = ''
  try {
    const { items: rows, paging } = await sosApi.history({
      role, status: statusFilter === 'all' ? '' : statusFilter, page: nextPage, size: 20,
    })
    if (my !== seq) return            // tab/filter berubah saat request berjalan
    items = append ? [...items, ...rows] : rows
    page = paging?.page ?? nextPage
    totalPage = paging?.total_page ?? 1
    totalItem = paging?.total_item ?? rows.length
  } catch (e) {
    if (my !== seq) return
    error = e?.message || 'Failed to load alerts'
  } finally {
    if (my === seq) { loading = false; loadingMore = false }
  }
}
```

- [ ] `loadSummary()` sekali saat mount + setiap kali `summaryError` di-retry;
      jangan menurunkan angka dari `items`.
- [ ] Panggil `load()` saat mount dan saat `role`/`statusFilter` berubah
      (`$effect` dengan reset). `loadSummary()` tidak diulang tiap tab switch
      kecuali setelah aksi yang mengubah status — aman: panggil ulang saat
      `role` berubah, murah.
- [ ] Chip filter status di atas list: `All` / `Active` / `Closed`
      (`aria-pressed`, tombol biasa; jangan bikin tab ARIA setengah jadi).
- [ ] "Load more" (bukan infinite scroll) di bawah list, tampil bila
      `page < totalPage`; `aria-busy={loadingMore}`, disabled saat memuat,
      label "Load more · N left" memakai `totalItem - items.length`.
- [ ] Kartu ringkasan baca `summary`:

```js
const sentTotal = $derived(summary?.sent?.total ?? null)
const resolvedAnswered = $derived(summary?.responded?.resolved ?? null)
const incomingActive = $derived(summary?.received?.active ?? null)
```

  render `null` → `—`. Hapus `sentCount` / `helpedCount` lama.
- [ ] `normalize(a)`: `type` diambil dari `role` (bukan menebak dari
      `sender.id`), tambahkan `statusLabel.EXPIRED = 'Expired'` dan tone netral
      (`bg-[#F2F3F5] text-muted`, bukan hijau "safe").
- [ ] Tampilkan waktu selesai: `a.resolved_at` / `a.cancelled_at` →
      `timeAgo()` (`src/lib/alertMeta.js`), fallback `triggered_at`. Untuk
      `EXPIRED` pakai `triggered_at` (backend tidak mengirim timestamp expire).
      Ingat field terminal **absen**, bukan `null`, saat belum selesai.
- [ ] Grouping tanggal dihitung dari `items` gabungan (setelah append), bukan
      per halaman, supaya header "Today" tidak muncul dua kali.
- [ ] Empty state per kombinasi:
      - `sent` + all → "No alerts sent yet"
      - `received` + all → "No alerts received yet"
      - filter status → "No {active|closed} alerts in this tab"
- [ ] Baris **non-interaktif** (keputusan: di luar scope). `AlertFlow` adalah
      alur sender dan `AlertIncoming` butuh payload inbox + state respond, jadi
      tidak ada detail view yang bisa dibuka dari riwayat. Jangan bikin handler
      kosong atau baris yang terlihat bisa diketuk.
- [ ] Footer copy: "Alerts are kept on the server. Other people's locations stay
      approximate until you respond."
- [ ] Hapus blok info lama yang menyebut sumber `active`/`inbox` bila tidak
      relevan lagi.

### 4.3 Tidak diubah

- `App.svelte`, `AlertFlow.svelte`, `AlertIncoming.svelte`, `HomeView.svelte`,
  `src/lib/geo.js`: riwayat murni server-side. Tidak ada cache lokal, tidak ada
  hook status terminal.
- `src/lib/stores.js`: tidak ada state baru.

### 4.4 Standar interface (dari `AGENTS.md`)

- [ ] Semua teks ≥ 12 px; kartu ringkasan tetap `text-[12px]` untuk keterangan.
- [ ] Jangan cetak enum mentah → tetap `emergencyLabel()` / `severityWord()`.
- [ ] Tidak ada angka karangan: `—` sebelum summary datang.
- [ ] Tombol "Load more" punya label jelas dan `disabled` saat memuat
      (bukan hanya spinner).
- [ ] `npm run build` bersih (tidak ada warning Svelte baru).

---

## 5. Acceptance criteria

1. Kartu "Alerts sent" = `sent.total` dan cocok dengan jumlah baris tab Sent
   (semua status, semua halaman).
2. Alert yang baru di-`resolve` tetap tampil di tab Sent dengan badge
   "Resolved" + waktu selesai.
3. Kartu "Resolved" tidak lagi selalu 0; naik setelah pengguna merespons alert
   dan alert itu di-resolve.
4. Tab Received menampilkan alert yang pernah di-push walau sudah resolved;
   lokasi tampil sebagai perkiraan saat belum merespons.
5. "Load more" menambah halaman tanpa duplikat; ganti tab/filter me-reset ke
   halaman 1 dan respons lama tidak menimpa (uji dengan throttle jaringan).
6. `—` (bukan `0`) saat summary belum/gagal dimuat; Retry memulihkan.
7. Tab `All` sudah tidak ada; hanya `Sent` dan `Received`.
8. `npm run build` sukses.

---

## 6. Verifikasi

```bash
cd ../backend && go run cmd/web/main.go     # endpoint history + summary aktif
cd ../frontend && npm run build && npm run dev   # http://localhost:5173 → tab Alerts
```

Manual: buat 2 akun (A, B) → A trigger, B respond, A resolve → cek tab Alerts
di kedua akun, kartu ringkasan, "Load more" setelah >20 alert, dan switch
tab/filter cepat (tidak ada baris nyasar dari tab sebelumnya).

---

## 7. Keputusan final & pertanyaan terbuka

Sudah final — jangan diubah tanpa memperbarui spec backend:

1. **Kartu "Resolved"** = `responded.resolved` (alert yang benar-benar kamu
   jawab lalu resolved), bukan `received.resolved`.
2. **Tab `All` dihapus**; hanya `Sent` dan `Received`.
3. **Baris riwayat non-interaktif**: tidak ada detail view yang dibuka dari
   list. Detail participant tetap di luar halaman ini.

Masih terbuka:

1. **"Nearby alerts"** (Fase 3 backend): sampai diputuskan, kartu ke-3 berlabel
   "Incoming · active" dan memakai `received.active`.
