<script>
  import { onMount } from 'svelte'
  import {
    Siren,
    Smartphone,
    MapPin,
    Mic,
    Radio,
    ShieldCheck,
    BellRing,
    Users,
    Check,
    Copy,
    QrCode,
    Navigation,
    Clock,
    Volume2,
    Lock,
    HeartPulse,
  } from '@lucide/svelte'

  let { onpreview } = $props()

  let activeScreenId = $state('home')
  let copied = $state(false)
  let copyTimer = null
  let appUrl = $state('https://allert.my.id')
  let displayHost = $state('allert.my.id')

  onMount(() => {
    if (typeof window !== 'undefined' && window.location?.origin) {
      const isLocal =
        window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
      appUrl = isLocal ? 'https://allert.my.id' : window.location.origin
      displayHost = isLocal ? 'allert.my.id' : window.location.host || 'allert.my.id'
    }
    return () => clearTimeout(copyTimer)
  })

  async function copyUrl() {
    try {
      await navigator.clipboard?.writeText(appUrl)
      copied = true
      clearTimeout(copyTimer)
      copyTimer = setTimeout(() => {
        copied = false
      }, 2400)
    } catch {
      /* clipboard blocked */
    }
  }

  const screens = [
    {
      id: 'home',
      title: 'Peta Radar Komunitas',
      subtitle: 'Pantau responder aktif di sekitar lokasi Anda secara real-time',
      tag: 'Beranda & Radar',
      image: '/screenshots/home-map.png',
      alt: 'Tampilan Beranda SOS Alert dengan peta radar komunitas dan tombol tahan SOS',
      icon: MapPin,
      summary:
        'Begitu dibuka di ponsel, aplikasi langsung memetakan posisi GPS Anda dan memindai responder komunitas aktif dalam jangkauan 1 km hingga 5 km.',
      highlights: [
        'Pin lokasi responder sekitar disamarkan pada grid ±100 m demi menjaga privasi sebelum darurat terjadi.',
        'Tombol merah SOS menggunakan mekanisme tahan 850 ms agar tidak terpencet secara tidak sengaja di saku.',
        'Indikator lokasi otomatis mengenali nama area atau kelurahan tempat Anda berada saat ini.',
      ],
    },
    {
      id: 'triage',
      title: 'Triase Suara AI & Pelacakan Live',
      subtitle: 'Rekaman otomatis 10 detik untuk menentukan tingkat bahaya & radius bantuan',
      tag: 'Saat Darurat Aktif',
      image: '/screenshots/sos-active-triage.png',
      alt: 'Tampilan SOS Aktif dengan hasil triase AI dari rekaman suara dan peta pelacakan langsung',
      icon: Mic,
      summary:
        'Jendela hitung mundur 10 detik sekaligus merekam suara di sekitar Anda. AI mentranskripsi dan mengklasifikasikan jenis bahaya sebelum sinyal dikirim.',
      highlights: [
        'Menentukan kategori darurat (Medis, Kecelakaan, atau Bahaya) dan skor keparahan secara otomatis.',
        'Menyesuaikan radius sebaran (1 km, 2 km, hingga 5 km) berdasarkan tingkat urgensi insiden.',
        'Mengirim titik pergerakan langsung (live breadcrumb) setiap 5 detik melalui koneksi WebSocket.',
      ],
    },
    {
      id: 'responder',
      title: 'Lembar Responder & Bukti Audio',
      subtitle: 'Warga terdekat menerima notifikasi instan, estimasi jarak, dan rekaman suara',
      tag: 'Sisi Penolong',
      image: '/screenshots/responder-incoming.png',
      alt: 'Tampilan notifikasi SOS masuk untuk responder dilengkapi pemutar bukti rekaman suara dan transkrip',
      icon: Volume2,
      summary:
        'Responder yang berada di dalam radius menerima peringatan Web Push dan dapat langsung menekan "I\'m coming" untuk membagikan estimasi waktu tiba (ETA).',
      highlights: [
        'Lokasi presisi dan bukti rekaman suara 10 detik hanya terbuka bagi responder yang sudah menyatakan berangkat.',
        'Dilengkapi pemutar audio langsung dan teks transkrip agar penolong tahu situasi sebelum tiba di lokasi.',
        'Daftar penolong yang sedang menuju lokasi diperbarui secara langsung tanpa perlu memuat ulang layar.',
      ],
    },
    {
      id: 'history',
      title: 'Riwayat & Ringkasan Insiden',
      subtitle: 'Catatan transparan untuk setiap peringatan yang dikirim maupun dijawab',
      tag: 'Riwayat & Status',
      image: '/screenshots/alerts-history.png',
      alt: 'Tampilan riwayat peringatan SOS yang pernah dikirim dan diterima beserta ringkasan statistik',
      icon: Clock,
      summary:
        'Setiap peringatan yang pernah Anda kirim atau bantu tercatat rapi di server lengkap dengan status akhir, waktu penyelesaian, dan jumlah penolong.',
      highlights: [
        'Ringkasan cepat total SOS terkirim, insiden yang berhasil Anda bantu, dan peringatan aktif saat ini.',
        'Filter terpisah antara peringatan terkirim (Sent) dan peringatan masuk di sekitar Anda (Received).',
        'Status akhir tercatat jelas: Active, Acknowledged, Resolved, Cancelled, atau Expired.',
      ],
    },
    {
      id: 'contacts',
      title: 'Lingkaran Kontak Darurat',
      subtitle: 'Simpan nomor keluarga dan kerabat terdekat untuk panggilan atau pesan cepat',
      tag: 'Kontak Kepercayaan',
      image: '/screenshots/contacts-circle.png',
      alt: 'Tampilan daftar kontak darurat keluarga dan dokter dengan tombol telepon serta pesan langsung',
      icon: Users,
      summary:
        'Simpan daftar orang kepercayaan Anda—keluarga, kerabat, atau dokter pribadi—untuk dihubungi dalam satu ketukan saat situasi genting.',
      highlights: [
        'Tombol panggilan telepon dan SMS langsung terhubung ke aplikasi dialer bawaan ponsel Anda.',
        'Kontak tersimpan aman di akun Anda dan tidak dihubungi secara otomatis tanpa kendali Anda.',
        'Dilengkapi pencarian instan dan penanda hubungan keluarga atau medis.',
      ],
    },
  ]

  const activeScreen = $derived(screens.find((s) => s.id === activeScreenId) || screens[0])

  const workflowSteps = [
    {
      step: '01',
      title: 'Tahan Tombol SOS & Ceritakan Situasi',
      description:
        'Tahan tombol SOS selama kurang dari satu detik, lalu ucapkan atau ketik kondisi darurat Anda selama jendela hitung mundur 10 detik.',
      detail: 'Bisa dibatalkan kapan saja sebelum 10 detik berakhir tanpa mengirim sinyal apa pun.',
    },
    {
      step: '02',
      title: 'AI Mengklasifikasi & Mengatur Radius',
      description:
        'Mesin Speech-to-Text dan AI Triage menganalisis rekaman suara Anda untuk menilai tingkat keparahan dan memilih radius pencarian penolong.',
      detail: 'Radius otomatis melebar hingga 5 km jika rekaman suara mendeteksi kondisi kritis.',
    },
    {
      step: '03',
      title: 'Responder Terdekat Bergerak ke Lokasi',
      description:
        'Komunitas di sekitar menerima Web Push instan, mendengarkan rekaman suara Anda, dan memantau titik GPS Anda secara langsung sampai Anda aman.',
      detail: 'Akhiri sinyal lewat konfirmasi dua ketukan ("I\'m safe") saat bantuan tiba.',
    },
  ]

  const deviceReasons = [
    {
      icon: Navigation,
      title: 'Modul GPS Presisi Tinggi',
      text: 'Laptop mengandalkan lokasi Wi-Fi atau alamat IP yang sering meleset ratusan meter. Ponsel memiliki chip GPS untuk memandu responder tepat ke titik Anda berdiri.',
    },
    {
      icon: Mic,
      title: 'Tangkap Suara di Lokasi Kejadian',
      text: 'Saat darurat di jalan atau ruang publik, mikrofon ponsel langsung merekam situasi 10 detik di sekitar Anda untuk dianalisis oleh AI.',
    },
    {
      icon: BellRing,
      title: 'Web Push & Panggilan 112 Langsung',
      text: 'Notifikasi darurat di latar belakang serta tautan panggilan cepat ke layanan darurat 112 dan kontak keluarga dirancang untuk sistem telepon seluler.',
    },
    {
      icon: Lock,
      title: 'Privasi Lokasi Berbasis Partisipasi',
      text: 'Koordinat Anda disamarkan pada peta umum dan hanya dibagikan secara presisi saat Anda memicu SOS atau saat Anda berangkat menolong.',
    },
  ]
</script>

<div class="min-h-dvh w-full bg-[#F4F5F7] text-[#0D0F13] selection:bg-sos/15">
  <!-- Top Sticky Header -->
  <header class="sticky top-0 z-40 border-b border-black/[0.06] bg-[#F4F5F7]/85 backdrop-blur-xl">
    <div class="mx-auto flex max-w-[1280px] items-center justify-between px-8 py-4">
      <div class="flex items-center gap-3">
        <span class="relative grid h-10 w-10 place-items-center rounded-[14px] bg-ink shadow-sm">
          <span class="absolute inset-0 rounded-[14px] bg-gradient-to-br from-white/20 to-transparent"></span>
          <Siren size={20} class="relative text-white" strokeWidth={2.2} />
        </span>
        <div>
          <div class="flex items-center gap-2">
            <span class="text-[18px] font-bold tracking-[-0.03em] text-ink">
              sos<span class="text-sos">.</span>alert
            </span>
            <span class="rounded-full bg-[#FFECEB] px-2.5 py-0.5 text-[11px] font-semibold text-[#B3241D]">
              Khusus Perangkat Mobile
            </span>
          </div>
          <p class="text-[12px] text-muted">Jaringan tanggap darurat komunitas berbasis AI</p>
        </div>
      </div>

      <nav aria-label="Navigasi halaman pengenalan" class="flex items-center gap-6 text-[13.5px] font-medium text-muted">
        <a href="#tentang-sos" class="transition hover:text-ink">Apa itu SOS Alert?</a>
        <a href="#fitur-layar" class="transition hover:text-ink">Tampilan &amp; Fitur</a>
        <a href="#cara-kerja" class="transition hover:text-ink">Cara Kerja</a>
        <button
          type="button"
          onclick={onpreview}
          class="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-[13px] font-semibold text-ink shadow-xs ring-1 ring-black/[0.08] transition hover:bg-[#FAFBFC] active:scale-[0.98]"
        >
          <Smartphone size={14} class="text-sos" />
          Buka Simulasi Mobile
        </button>
      </nav>
    </div>
  </header>

  <main class="mx-auto max-w-[1280px] px-8 pb-24 pt-12">
    <!-- HERO SECTION: Mobile Handoff + Phone Showcase -->
    <section class="grid grid-cols-12 items-center gap-12 pb-20">
      <div class="col-span-7 pr-4">
        <div class="inline-flex items-center gap-2 rounded-full bg-white px-3.5 py-1.5 text-[12.5px] font-semibold text-ink shadow-2xs ring-1 ring-black/[0.06]">
          <span class="relative flex h-2 w-2">
            <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-sos opacity-75"></span>
            <span class="relative inline-flex h-2 w-2 rounded-full bg-sos"></span>
          </span>
          Anda membuka halaman ini dari layar Desktop / Laptop
        </div>

        <h1 class="mt-5 text-[44px] font-bold leading-[1.08] tracking-[-0.035em] text-ink">
          Bantuan darurat terdekat, dirancang khusus untuk genggaman ponsel Anda.
        </h1>

        <p class="mt-5 max-w-[60ch] text-[16px] leading-[1.65] text-muted">
          <strong>SOS Alert</strong> adalah aplikasi web keselamatan komunitas yang menghubungkan warga dalam kondisi darurat dengan penolong (responder) terdekat dalam hitungan detik. Karena membutuhkan GPS presisi, mikrofon lapangan, dan sensor gerak langsung, aplikasi ini dioptimalkan sepenuhnya untuk perangkat <strong>HP / Smartphone</strong>.
        </p>

        <!-- Callout Box: Buka di HP -->
        <div class="mt-8 rounded-[28px] bg-white p-6 shadow-[0_18px_44px_-22px_rgba(16,24,40,0.18)] ring-1 ring-black/[0.06]">
          <div class="flex items-start justify-between gap-6">
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2 text-[14px] font-semibold text-ink">
                <Smartphone size={17} class="text-sos" strokeWidth={2.3} />
                Buka di HP Anda Sekarang
              </div>
              <p class="mt-1 text-[13px] leading-relaxed text-muted">
                Ketik atau salin tautan di bawah ini ke browser ponsel Anda (Safari / Chrome), lalu pilih <strong>"Add to Home Screen"</strong> agar siap diakses satu ketukan kapan saja.
              </p>

              <div class="mt-4 flex items-center gap-2.5">
                <div class="flex min-w-0 flex-1 items-center gap-2.5 rounded-2xl bg-[#F4F5F7] px-4 py-3 ring-1 ring-black/[0.05]">
                  <span class="h-2 w-2 shrink-0 rounded-full bg-safe"></span>
                  <code class="truncate text-[14px] font-semibold text-ink">{appUrl}</code>
                </div>
                <button
                  type="button"
                  onclick={copyUrl}
                  class="inline-flex shrink-0 items-center gap-2 rounded-2xl bg-ink px-4 py-3 text-[13.5px] font-semibold text-white transition hover:bg-ink/90 active:scale-[0.98]"
                >
                  {#if copied}
                    <Check size={15} class="text-[#6EE7B7]" />
                    Tersalin
                  {:else}
                    <Copy size={15} />
                    Salin Link
                  {/if}
                </button>
              </div>

              <div class="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-[12px] font-medium text-muted">
                <span class="inline-flex items-center gap-1.5">
                  <ShieldCheck size={14} class="text-safe" /> Tanpa instalasi App Store / Play Store
                </span>
                <span class="inline-flex items-center gap-1.5">
                  <BellRing size={14} class="text-[#2F6BFF]" /> Mendukung Web Push Notification
                </span>
              </div>
            </div>

            <!-- Visual Mobile Badge -->
            <div class=" flex shrink-0 flex-col items-center justify-center rounded-2xl bg-[#F8FAFF] px-5 py-4 text-center ring-1 ring-[#2F6BFF]/15">
              <div class="grid h-12 w-12 place-items-center rounded-2xl bg-[#2F6BFF]/10 text-[#2F6BFF]">
                <QrCode size={24} strokeWidth={2} />
              </div>
              <p class="mt-2 text-[12px] font-bold text-ink">{displayHost}</p>
              <p class="mt-0.5 text-[11px] text-muted">Akses via Browser HP</p>
            </div>
          </div>
        </div>

        <div class="mt-5 flex items-center gap-3 text-[13px] text-muted">
          <span>Ingin mencoba langsung dari laptop untuk pengujian?</span>
          <button
            type="button"
            onclick={onpreview}
            class="font-semibold text-ink underline decoration-ink/30 underline-offset-4 transition hover:decoration-ink"
          >
            Tampilkan mode simulasi layar HP di sini
          </button>
        </div>
      </div>

      <!-- Right Column: Dual Phone Hardware Preview -->
      <div class="col-span-5">
        <div class="relative mx-auto flex items-center justify-center py-4">
          <!-- Soft ambient glow behind phones -->
          <div class="pointer-events-none absolute -left-6 top-8 h-72 w-72 rounded-full bg-sos/12 blur-3xl"></div>
          <div class="pointer-events-none absolute -right-6 bottom-4 h-72 w-72 rounded-full bg-[#2F6BFF]/12 blur-3xl"></div>

          <!-- Secondary Phone (Back Right - Active SOS Triage) -->
          <div
            class="relative z-10 -mr-6 translate-x-10 translate-y-6 rotate-[4deg] rounded-[42px] bg-[#14171D] p-2.5 shadow-[0_32px_70px_-25px_rgba(13,15,19,0.5)] ring-1 ring-white/15 transition duration-300 hover:translate-x-12"
          >
            <div class="w-[230px] overflow-hidden rounded-[32px] bg-[#0F1216]">
              <img
                src="/screenshots/sos-active-triage.png"
                alt="Tampilan Triase Suara AI saat SOS aktif"
                class="block h-auto w-full select-none"
                loading="eager"
              />
            </div>
          </div>

          <!-- Primary Phone (Front Left - Home Radar Map) -->
          <div
            class="relative z-20 -translate-x-8 rounded-[46px] bg-[#0D0F13] p-3 shadow-[0_40px_90px_-28px_rgba(13,15,19,0.65)] ring-1 ring-black/15"
          >
            <!-- Top speaker notch -->
            <div class="mx-auto mb-2 h-1.5 w-14 rounded-full bg-white/15"></div>
            <div class="w-[264px] overflow-hidden rounded-[35px] bg-white">
              <img
                src="/screenshots/home-map.png"
                alt="Tampilan Peta Utama SOS Alert di HP"
                class="block h-auto w-full select-none"
                loading="eager"
              />
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- SECTION 2: APA ITU SOS ALERT & KENAPA MOBILE-ONLY -->
    <section id="tentang-sos" class="scroll-mt-24 border-t border-black/[0.07] py-18">
      <div class="grid grid-cols-12 gap-10">
        <div class="col-span-5">
          <p class="text-[12px] font-semibold uppercase tracking-[0.13em] text-sos">
            Pengenalan Sistem
          </p>
          <h2 class="mt-2 text-[32px] font-bold leading-[1.15] tracking-[-0.03em] text-ink">
            Apa itu SOS Alert dan mengapa harus dibuka di ponsel?
          </h2>
          <p class="mt-4 text-[15px] leading-[1.65] text-muted">
            Dalam kondisi darurat seperti kecelakaan jalan raya, serangan medis mendadak, atau ancaman keamanan, ambulans dan aparat sering kali membutuhkan waktu tempuh yang cukup lama. Padahal, orang yang berada paling dekat dengan Anda—dalam jarak 100 hingga 500 meter—bisa memberikan pertolongan pertama jauh lebih cepat.
          </p>
          <p class="mt-3.5 text-[15px] leading-[1.65] text-muted">
            <strong>SOS Alert</strong> menjembatani celah waktu kritis tersebut. Sistem ini menggunakan <strong>AI Speech-to-Text</strong> untuk memahami situasi darurat Anda tanpa menuntut Anda mengetik panjang saat panik, lalu menyiarkan lokasi Anda secara terarah hanya kepada responder komunitas yang aktif di sekitar Anda.
          </p>

          <div class="mt-6 rounded-2xl bg-white p-4 ring-1 ring-black/[0.05]">
            <div class="flex items-center gap-3">
              <span class="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#FFECEB] text-sos">
                <HeartPulse size={20} strokeWidth={2.2} />
              </span>
              <div>
                <p class="text-[13.5px] font-semibold text-ink">Dirancang untuk kondisi panik di lapangan</p>
                <p class="mt-0.5 text-[12.5px] text-muted">
                  Satu tombol tahan di bawah ibu jari, rekaman otomatis 10 detik, dan pembatalan dua ketukan yang aman.
                </p>
              </div>
            </div>
          </div>
        </div>

        <div class="col-span-7 grid grid-cols-2 gap-4">
          {#each deviceReasons as item}
            {@const Icon = item.icon}
            <div class="flex flex-col justify-between rounded-[26px] bg-white p-6 shadow-[0_12px_32px_-18px_rgba(16,24,40,0.12)] ring-1 ring-black/[0.05]">
              <div>
                <span class="grid h-11 w-11 place-items-center rounded-2xl bg-[#F4F5F7] text-ink ring-1 ring-black/[0.04]">
                  <Icon size={20} strokeWidth={2.1} />
                </span>
                <h3 class="mt-4 text-[17px] font-semibold tracking-[-0.02em] text-ink">
                  {item.title}
                </h3>
                <p class="mt-2 text-[13.5px] leading-[1.6] text-muted">
                  {item.text}
                </p>
              </div>
            </div>
          {/each}
        </div>
      </div>
    </section>

    <!-- SECTION 3: INTERACTIVE SCREENSHOT & FEATURE TOUR -->
    <section id="fitur-layar" class="scroll-mt-24 border-t border-black/[0.07] py-18">
      <div class="flex items-end justify-between gap-8">
        <div>
          <p class="text-[12px] font-semibold uppercase tracking-[0.13em] text-[#2F6BFF]">
            Tur Fitur &amp; Tampilan Layar Penting
          </p>
          <h2 class="mt-2 text-[32px] font-bold leading-[1.15] tracking-[-0.03em] text-ink">
            Lihat bagaimana setiap halaman bekerja saat darurat.
          </h2>
        </div>
        <p class="max-w-[42ch] text-[14px] leading-relaxed text-muted">
          Pilih salah satu tampilan layar di bawah untuk melihat tangkapan layar asli aplikasi beserta penjelasan fiturnya.
        </p>
      </div>

      <!-- Interactive Showcase Container -->
      <div class="mt-10 grid grid-cols-12 items-start gap-8 rounded-[36px] bg-[#0D0F13] p-8 text-white shadow-[0_32px_80px_-30px_rgba(13,15,19,0.55)] ring-1 ring-white/10">
        <!-- Left: Screen Selector Tabs -->
        <div class="col-span-5 flex flex-col gap-2.5">
          {#each screens as item}
            {@const Icon = item.icon}
            {@const isSelected = item.id === activeScreenId}
            <button
              type="button"
              onclick={() => (activeScreenId = item.id)}
              aria-pressed={isSelected}
              class="group w-full rounded-[22px] p-4 text-left transition {isSelected
                ? 'bg-white text-ink shadow-lg'
                : 'bg-white/[0.04] text-white/80 ring-1 ring-white/[0.07] hover:bg-white/[0.08]'}"
            >
              <div class="flex items-start gap-3.5">
                <span
                  class="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-xl transition {isSelected
                    ? 'bg-sos text-white'
                    : 'bg-white/10 text-white/75 group-hover:text-white'}"
                >
                  <Icon size={18} strokeWidth={2.2} />
                </span>
                <div class="min-w-0 flex-1">
                  <div class="flex items-center justify-between gap-2">
                    <span
                      class="text-[11px] font-bold uppercase tracking-[0.12em] {isSelected
                        ? 'text-sos'
                        : 'text-white/60'}"
                    >
                      {item.tag}
                    </span>
                  </div>
                  <p class="mt-0.5 text-[15.5px] font-semibold tracking-[-0.015em] {isSelected ? 'text-ink' : 'text-white'}">
                    {item.title}
                  </p>
                  <p class="mt-1 text-[12.5px] leading-snug {isSelected ? 'text-muted' : 'text-white/60'}">
                    {item.subtitle}
                  </p>
                </div>
              </div>
            </button>
          {/each}
        </div>

        <!-- Center: Real Mobile Screenshot Frame -->
        <div class="col-span-3 flex flex-col items-center justify-center">
          <div class="rounded-[40px] bg-[#1C2029] p-2.5 shadow-[0_24px_60px_-15px_rgba(0,0,0,0.75)] ring-1 ring-white/15">
            <div class="mx-auto mb-2 h-1.5 w-12 rounded-full bg-white/15"></div>
            <div class="w-[248px] overflow-hidden rounded-[30px] bg-[#F4F5F7]">
              <img
                src={activeScreen.image}
                alt={activeScreen.alt}
                class="block h-auto w-full select-none"
              />
            </div>
          </div>
        </div>

        <!-- Right: Detailed Feature Breakdown of Selected Screen -->
        <div class="col-span-4 flex h-full flex-col justify-between rounded-[26px] bg-white/[0.05] p-6 ring-1 ring-white/[0.08]">
          <div>
            <span class="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/80">
              <Radio size={12} class="text-[#6EE7B7]" />
              {activeScreen.tag}
            </span>

            <h3 class="mt-4 text-[24px] font-bold leading-tight tracking-[-0.025em] text-white">
              {activeScreen.title}
            </h3>

            <p class="mt-3 text-[14px] leading-[1.65] text-white/70">
              {activeScreen.summary}
            </p>

            <div class="mt-6 border-t border-white/10 pt-5">
              <p class="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/60">
                Fitur Utama di Layar Ini
              </p>
              <ul class="mt-3.5 space-y-3">
                {#each activeScreen.highlights as point}
                  <li class="flex items-start gap-2.5 text-[13px] leading-relaxed text-white/80">
                    <span class="mt-1 grid h-4 w-4 shrink-0 place-items-center rounded-full bg-[#0BA36F]/25 text-[#6EE7B7]">
                      <Check size={11} strokeWidth={2.8} />
                    </span>
                    <span>{point}</span>
                  </li>
                {/each}
              </ul>
            </div>
          </div>

          <div class="mt-8 rounded-2xl bg-white/[0.05] p-4 ring-1 ring-white/[0.07]">
            <p class="text-[12px] leading-relaxed text-white/65">
              Tangkapan layar di samping diambil langsung dari antarmuka mobile <strong>SOS Alert</strong> dengan ukuran layar standar 390×844 px.
            </p>
          </div>
        </div>
      </div>

      <!-- All 5 Screens Quick Visual Strip -->
      <div class="mt-10 grid grid-cols-5 gap-4">
        {#each screens as item}
          {@const isSelected = item.id === activeScreenId}
          <button
            type="button"
            onclick={() => (activeScreenId = item.id)}
            class="group flex flex-col overflow-hidden rounded-[24px] bg-white p-3 text-left transition {isSelected
              ? 'ring-2 ring-ink shadow-md'
              : 'ring-1 ring-black/[0.06] hover:ring-black/20'}"
          >
            <div class="overflow-hidden rounded-[16px] bg-[#E9EDF0] ring-1 ring-black/[0.04]">
              <img
                src={item.image}
                alt={item.alt}
                class="aspect-[390/844] w-full object-cover object-top transition duration-300 group-hover:scale-[1.02]"
                loading="eager"
              />
            </div>
            <div class="mt-3 px-1">
              <p class="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">{item.tag}</p>
              <p class="mt-0.5 truncate text-[13px] font-semibold text-ink">{item.title}</p>
            </div>
          </button>
        {/each}
      </div>
    </section>

    <!-- SECTION 4: ALUR KERJA DARI TOMBOL SOS SAMPAI RESPONDER TIBA -->
    <section id="cara-kerja" class="scroll-mt-24 border-t border-black/[0.07] py-18">
      <div class="max-w-[64ch]">
        <p class="text-[12px] font-semibold uppercase tracking-[0.13em] text-safe">
          Alur Tanggap Darurat
        </p>
        <h2 class="mt-2 text-[32px] font-bold leading-[1.15] tracking-[-0.03em] text-ink">
          Bagaimana SOS Alert bekerja dalam 3 langkah.
        </h2>
        <p class="mt-3 text-[15px] leading-relaxed text-muted">
          Setiap detik sangat berharga. Seluruh proses mulai dari penekanan tombol hingga pemberitahuan responder dirancang otomatis tanpa formulir yang rumit.
        </p>
      </div>

      <div class="mt-10 grid grid-cols-3 gap-6">
        {#each workflowSteps as item}
          <div class="flex flex-col justify-between rounded-[28px] bg-white p-7 shadow-[0_14px_34px_-18px_rgba(16,24,40,0.14)] ring-1 ring-black/[0.05]">
            <div>
              <div class="flex items-center justify-between">
                <span class="rounded-full bg-[#F4F5F7] px-3.5 py-1 text-[13px] font-bold tabular-nums text-ink ring-1 ring-black/[0.05]">
                  Langkah {item.step}
                </span>
              </div>
              <h3 class="mt-5 text-[19px] font-bold leading-snug tracking-[-0.02em] text-ink">
                {item.title}
              </h3>
              <p class="mt-2.5 text-[14px] leading-[1.65] text-muted">
                {item.description}
              </p>
            </div>

            <div class="mt-6 rounded-2xl bg-[#F8F9FA] px-4 py-3 text-[12.5px] font-medium text-ink/80 ring-1 ring-black/[0.04]">
              {item.detail}
            </div>
          </div>
        {/each}
      </div>
    </section>

    <!-- BOTTOM BANNER: BUKA DI HP ATAU SIMULASI -->
    <section class="mt-6 rounded-[32px] bg-gradient-to-br from-[#14171D] via-[#0F1216] to-[#0B0D11] p-10 text-white shadow-[0_28px_70px_-28px_rgba(13,15,19,0.6)]">
      <div class="flex items-center justify-between gap-10">
        <div class="max-w-[58ch]">
          <span class="inline-flex items-center gap-2 rounded-full bg-sos/20 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-[#FF8A82] ring-1 ring-sos/30">
            <Smartphone size={12} /> Siap Digunakan di Perangkat Mobile
          </span>
          <h2 class="mt-3 text-[28px] font-bold leading-tight tracking-[-0.03em]">
            Buka {displayHost} di ponsel Anda untuk perlindungan penuh.
          </h2>
          <p class="mt-2.5 text-[14.5px] leading-relaxed text-white/70">
            Aktifkan izin lokasi dan Web Push Notification di browser HP Anda agar dapat mengirim sinyal darurat maupun membantu tetangga di sekitar Anda.
          </p>
        </div>

        <div class="flex shrink-0 items-center gap-3">
          <button
            type="button"
            onclick={copyUrl}
            class="inline-flex items-center gap-2 rounded-full bg-white px-5 py-3.5 text-[14px] font-semibold text-ink transition hover:bg-white/90 active:scale-[0.98]"
          >
            {#if copied}
              <Check size={16} class="text-safe" />
              Link Tersalin
            {:else}
              <Copy size={16} />
              Salin Link Aplikasi
            {/if}
          </button>
          <button
            type="button"
            onclick={onpreview}
            class="inline-flex items-center gap-2 rounded-full bg-white/10 px-5 py-3.5 text-[14px] font-semibold text-white ring-1 ring-white/15 transition hover:bg-white/15 active:scale-[0.98]"
          >
            <Smartphone size={16} />
            Coba Simulasi Mobile
          </button>
        </div>
      </div>
    </section>
  </main>
</div>
