# Review — API mirror sync `c5f8ca5` (pentest F-1..F-4)

Status: **note, belum dikerjakan.** Bukan spec, bukan handoff. Daftar ini
disimpan supaya temuan review tidak hilang; kerjakan sesuai urutan kalau
mau dibereskan.

**Yang direview:** commit `c5f8ca5` ("docs: sync API mirror for nearby distance
bucket (F-1)") — re-copy `api/api.md`, `api/api-spec.json`, `docs/api-changes.md`
dari backend `0bc5cca` + refresh `AGENTS.md`. Diff-nya 84 baris, semuanya
dokumen; **tidak ada perubahan kode aplikasi**.

**Kesimpulan kode:** tidak ada yang rusak. Yang memakai data yang berubah:

- `GET /api/sos/{alertId}` hanya dipanggil `AlertFlow.svelte:568` (pemilik alert,
  selalu participant) → gate `404`/`403` tidak pernah kena.
- Notifikasi yang di-tap dicocokkan dari daftar inbox (`App.svelte:210-218`),
  bukan dengan fetch detail → tidak ada jalur 404 baru.
- `distance_m` yang dibulatkan 100 m tetap terbaca: `alertMeta.formatDistance`
  → `500 m` / `1.2 km`; `0` tetap `Number.isFinite`, jadi sortir
  `AlertFlow.svelte:185` dan `MapCard` "closest" tidak rusak.
- Bucket hanya di `distance_m`; `latitude`/`longitude` yang sudah diblur tidak
  berubah → pin peta identik.

Lima temuan di bawah soal dokumen yang saling bertentangan dan dua hal kecil di
UI/format.

## Must fix

### 1. Mirror masih bilang siapa pun boleh baca insiden

- Lokasi: `api/api.md:172`, `api/api.md:452`, `api/api-spec.json:1330`,
  `api/api-spec.json:1442`.
- Masalah: keempat baris menyatakan "any authenticated user may fetch it" /
  "anyone who knows the alert id can acknowledge" dan menjelaskan `200` termask
  untuk outsider. Kode backend (`sos_controller.go:46`,
  `sos_api_test.go:505`) mengembalikan `404` untuk stranger dan `403` untuk
  `respond`. Jadi commit ini menambahkan bagian yang bertentangan dengan spec
  di sebelahnya, padahal `AGENTS.md` menyebut `api/` sebagai sumber otoritatif.
- Perbaikan: bukan di repo ini — betulkan dua `description` di
  `../backend/api/api-spec.json` dan baris tabel + "Catatan implementasi" di
  `../backend/api/api.md`, lalu re-copy. Response `404` untuk `getAlert` sudah
  ada, cuma teksnya yang salah.
- Kalau dibiarkan: fitur berikutnya yang ditulis dari spec akan membangun jalur
  yang ditolak server, dan tidak jelas dokumen mana yang benar.

### 2. `AGENTS.md` masih mengecualikan `GET /metrics` dari auth

- Lokasi: `AGENTS.md:91` ("Protected routes: everything except … and
  `GET /metrics`").
- Masalah: commit yang sama menambahkan ke `api/api.md` bahwa `/metrics` butuh
  `Authorization: <token>` dan `404` kalau `metrics.token` kosong. Dua file di
  repo ini sekarang bertentangan.
- Perbaikan: ganti jadi "everything except `POST /api/users` and
  `POST /api/users/_login`", tambah satu baris soal token metrics.
- Kalau dibiarkan: ada yang memasang scrape/URL dashboard tanpa token lalu dapat
  `401`.

## Should fix

### 3. Contoh `nearby` di `AGENTS.md` masih `distance_m: 262`

- Lokasi: `AGENTS.md:487`.
- Masalah: baris 58 file yang sama (diedit di commit ini) bilang `distance_m`
  dibulatkan ke 100 m, dan `api/api.md` sudah mengubah contohnya `262` → `300`.
  Contoh di `AGENTS.md` tertinggal, jadi orang yang copy-paste memakai nilai
  yang tidak mungkin dikirim server lagi.
- Perbaikan: `262` → `300`.

### 4. Item checklist "404 pada detail" belum diimplementasi

- Lokasi: `src/lib/components/AlertFlow.svelte:566-578`.
- Masalah: `docs/api-changes.md` (commit ini) minta state "insiden tidak
  tersedia" dan tanpa retry loop saat detail `404`. `catch` di sini menelan
  semua status dan interval 10 s tetap jalan. Kasusnya: alert `EXPIRED` saat
  socket tracking sedang putus, jadi tidak ada frame `ALERT_STATUS` — layar
  terus mengaku SOS aktif sambil polling `404` tanpa penjelasan apa pun.
- Perbaikan: tangani `err?.status === 404` di `catch` (1–2 baris): hentikan poll
  lewat flag yang dibaca `$effect`, lalu tampilkan "This incident is no longer
  available" menggantikan blok responder. Kalau jalur sender dianggap tidak
  mungkin `404`, hapus item itu dari `docs/api-changes.md` (di backend) supaya
  checklist-nya jujur.

## Nice to have

### 5. Hash sumber re-copy salah

- Lokasi: `AGENTS.md:56-60` ("from backend `45f2219`").
- Masalah: byte `api/api-spec.json` dan `api/api.md` identik dengan backend
  `0bc5cca` (commit F-1), bukan `45f2219`. Pesan commit menyebut `@0bc5cca`,
  handbook menyebut `45f2219`.
- Perbaikan: `45f2219` → `0bc5cca`. Kalau dibiarkan, re-copy berikutnya
  di-diff ke commit yang tidak pernah memuat byte ini dan terlihat seperti
  regresi.

### 6. Dua salinan formatter jarak

- Lokasi: `src/lib/components/MapCard.svelte:69-72` — `distanceLabel()` adalah
  salinan persis `formatDistance()` di `src/lib/alertMeta.js:46-49`.
- Masalah: aturan label akan berubah (lihat #7), dan memperbaiki satu tempat
  meninggalkan tooltip pin dan footer peta ("Closest is … away") di aturan lama.
- Perbaikan: import `formatDistance` dari `$lib/alertMeta.js`, hapus fungsi
  lokal (−4 baris).

### 7. Bucket 100 m bisa tampil "0 m away"

- Lokasi: `src/lib/alertMeta.js:46-49`.
- Masalah: `quantizeDistance` membulatkan 0–49 m ke `0`, dan itu sekarang lazim
  (siapa pun di sel 100 m yang sama). Tooltip jadi "Responder · 0 m away" dan
  footer "Closest is 0 m away" — terbaca seperti bug, bukan bucket. Sebelum
  bucketing ini hanya terjadi di bawah 0.5 m.
- Perbaikan: satu baris di `formatDistance`:
  `meters < 100 ? 'under 100 m' : …` (sekalian menutup #6).

## Verdict

Kerjakan #1 dan #2 dulu (keduanya soal aturan keamanan yang salah dokumen), #3
satu kata. Kode aplikasi aman dikirim apa adanya.

## Yang tidak dicek

`npm run build` dan tiga script browser (`scripts/test-*.mjs`) tidak dijalankan
— commit-nya tidak menyentuh kode aplikasi, dan mock di sana tidak meng-assert
teks jarak maupun status detail. Bundle produksi (`https://allert.my.id`) tidak
diperiksa.
