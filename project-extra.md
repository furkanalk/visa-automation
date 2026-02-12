Kritik (Phase 3’e geçmeden önce)
1) CPClient.checkJobStatus() URL hack’i çok riskli

Şu an:

const apiUrl = this.baseUrl.replace('/cp', '/api').replace(':3001', ':3000');


Bu prod’da patlar (port, path, reverse proxy, docker network). Zaten .env.example’e PUBLIC_API_URL eklemişsiniz; buradan okumalı.

Öneri (sadece değişen satırlar):

// CPClient ctor parametresine ekle: publicApiUrl
private publicApiUrl: string;

// ctor içinde:
this.publicApiUrl = options.publicApiUrl.replace(/\/$/, '');

// checkJobStatus içinde:
const response = await fetch(`${this.publicApiUrl}/api/jobs/${jobId}`, { ... })

2) Heartbeat loop “overlap” edebilir (setInterval + async)

setInterval(async () => { ... await ... }) yoğunlukta üst üste binebilir. Sonuç: CP’ye paralel heartbeat spam, yarış durumları.

Öneri (sadece ek satırlar fikri):

private heartbeatInFlight = false;

interval içinde en başta:

if (this.heartbeatInFlight) return;
this.heartbeatInFlight = true;
try { ... } finally { this.heartbeatInFlight = false; }

3) CP tarafında config_changed hesabı muhtemelen yanlış

Heartbeat endpoint’inde updateHeartbeat() çağrısından sonra configChanged için agent.last_heartbeat_at kullanıyorsun ama agent değişkeni update öncesi state. Bu yüzden false/true yanlış dönebilir.

Öneri: updateHeartbeat() dönüşünden last_heartbeat_at alıp onunla kıyasla (repo method bunu döndürmüyorsa döndürsün).

Orta Öncelik
4) Worker runtime metadata boş kalıyor

registerAgent’a metadata gönderiyorsun ama runtime objesinde:

metadata: {},


Bu debug/observability için kaçırılmış.

Öneri (tek satır):

metadata: registration.metadata ?? params.metadata ?? {},


(ya da en azından metadata: { worker_pid..., started_at... })

5) Agent status mapping (RUNNING/DRAINING) CP’de yeterince ifade edilmiyor

Heartbeat’te RUNNING iken CP status “ONLINE” gidiyor. Bu MVP’de idare eder ama CP UI’da “busy” ayrımı kaybolur.

Ya heartbeat payload’ına runtime_status ekleyin

Ya CP AgentStatus set’inize BUSY gibi bir status ekleyin (MVP sonrası da olabilir)

6) AsyncAgentRunner “no idle agent” durumunda job fail ediyor

BullMQ job’u fail olunca retry/backoff ayarı yoksa boşa düşer. Burada iki yol:

“No idle agent available” için retryable error + backoff

ya da queue concurrency’yi agent sayısı kadar tutup “agent seçimi”ni daha deterministik yap.

Staff Portal tarafı

Genel olarak temiz; MVP için kullanılabilir.

7) Tenant hardcode

staffApi her istekte:

"x-tenant-id": "default"


Çok-tenant hedefliyorsanız useAuthStore.user.tenant_id’den gelmeli.

8) Auth guard ve theme hydration iki kez uğraşıyor

<head> içinde theme script var

AppLayout içinde persist rehydrate + DOM class set var
Bu ikisi bazen flicker/double-work yapar. Çalışır ama sadeleştirilebilir (Phase 3 sonrası da olur).

9) Küçük temizlik

CaptchaInput içinde RefreshCw import edilmiş ama kullanılmıyor.

En kritikler (bug seviyesinde)
1) HITL resolve/cancel: ASSIGNED state’i DB update’lerinde çalışmıyor

Route tarafında resolve/cancel için PENDING || ASSIGNED kabul etmişsin, ama repository:

resolve() → .where('status', '=', 'PENDING')

markExpired() → .where('status', '=', 'PENDING')

Yani task ASSIGNED olunca resolve/cancel 200 dönse bile task null gelebilir (veya resolve olmaz).

2) HITL “CANCELLED” state mismatch

UI statusColors içinde CANCELLED var, ama backend:

cancel endpoint markExpired() çağırıyor → status EXPIRED yapıyor.

repo’da CANCELLED diye bir state set edilmiyor.

Sonuç: UI’da “Cancelled” filter/renk var ama backend bunu üretmiyor.

3) Job state isimleri tutarsız

apps/admin-ui/src/app/agents/page.tsx içinde:

FAILED_PERMANENT var
Ama diğer yerlerde (jobs.ts, dashboard, statusColors) FAILED_TERMINAL kullanıyorsun.

Bu, agent card “FSM badge” mapping’ini ve filtreleri patlatır (state hiç match olmaz).

Orta seviye ama önemli
4) React Query invalidation / queryKey uyumsuzluğu

Jobs list queryKey: ["jobs", statusFilter]
Ama mutation success’te invalidate: invalidateQueries({ queryKey: ["jobs"] })

Bu bazen çalışır (partial match), bazen cache politikasına göre beklediğin refresh’i yapmayabilir. En garanti: predicate veya exact key’leri invalidate etmek.

5) Agent job status polling aşırı maliyetli

jobStatuses queryFn içinde job’ları for-loop ile seri çağırıyorsun. Agent sayısı artınca yavaşlar.

Promise.all ile paralel çek

veya backend’e “batch job statuses” endpoint koy (en sağlamı)

6) JobRepository findWithFilters: count query ayrı, ana query ayrı

Normal; ama iki query’de filter logic duplication var. (bug değil, ileride drift olur)

UI component’ler (Button/Badge)

Temiz. cva varyantların mantıklı. Sadece küçük not:

Button için type default’u HTML’de “submit” olabilir; bazı form’larda sürpriz yapar. (Eğer form içinde çok kullanacaksan type="button" defaultlamayı düşünebilirsin.)



1) Dark/Light toggle dönüyor ama sayfaya etki etmiyor: en olası sebep

Tailwind “dark mode” ayarın media’da kalmış olması.
Sen document.documentElement.classList.add("dark") yapıyorsun; bu ancak Tailwind darkMode: "class" ise çalışır. dark: class’ları aksi halde “prefers-color-scheme”e bakar, HTML class’ını umursamaz.

Kontrol/Fix:

tailwind.config.(js|ts) içinde şunu görmelisin:

darkMode: ["class"] (veya darkMode: "class")

Bu yoksa toggle sadece ikon animasyonu yapar, UI değişmez.

İkinci olasılık: dark: class’larını kullanan CSS/utility’ler build’e girmiyordur (content paths eksik). Ama %80 darkMode ayarıdır.

2) “Settings” sayfasındaki CP API URL / Public API URL gerçekte işe yaramıyor

Sen localStorage’a yazıyorsun ama apps/admin-ui/src/lib/api.ts içinde URL’ler module import anında sabitleniyor:

const CP_API_URL = process.env.NEXT_PUBLIC_CP_API_URL || "http://localhost:3001";
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";


Bu yüzden UI’da değiştirsen bile cpApi yine env’deki URL’ye gider. “Refresh for changes” bile çoğu durumda yetmez, çünkü kod localStorage’ı hiç okumuyor.

Fix yaklaşımı: URL’leri const yerine runtime’da localStorage’dan okuyan fonksiyon yap.

İstediğin gibi “sadece değişen satırlar” olarak örnek:

-const CP_API_URL = process.env.NEXT_PUBLIC_CP_API_URL || "http://localhost:3001";
-const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";
+const getCpApiUrl = () =>
+  (typeof window !== "undefined" && localStorage.getItem("cp_api_url")) ||
+  process.env.NEXT_PUBLIC_CP_API_URL ||
+  "http://localhost:3001";
+
+const getPublicApiUrl = () =>
+  (typeof window !== "undefined" && localStorage.getItem("public_api_url")) ||
+  process.env.NEXT_PUBLIC_API_URL ||
+  "http://localhost:3000";


Ve aşağıdaki tüm kullanım noktalarında:

- `${CP_API_URL}/cp/...`
+ `${getCpApiUrl()}/cp/...`

- `${API_URL}/api/...`
+ `${getPublicApiUrl()}/api/...`

3) Audit page: React “key” uyarısı alırsın

logs.items.map((log) => (<> ... </>)) fragment key’siz. İçeride tr’a key vermişsin ama fragment yine key ister.

Fix (yalnızca değişen satır mantığında):

- {logs.items.map((log) => (
-   <>
+ {logs.items.map((log) => (
+   <React.Fragment key={log.id}>
...
-   </>
+   </React.Fragment>
  ))}


Bunun için import React from "react"; ya da import { Fragment } from "react"; eklemen gerekebilir (proje ayarına bağlı).

4) Notifications: “clear” edememe problemi (tasarımsal bug)

handleSave() içinde sadece doluysa gönderiyorsun:

if (webhookUrl) updates.webhook_url = webhookUrl;

boş string ile silme yapamıyorsun.
Aynısı chat_ids, smtp_* vs için de geçerli. UI’dan alanı boşaltsan bile backend’e “null/[]” gitmediği için eski değer DB’de kalır.

Çözüm: boşken de explicit null / [] gönder (özellikle disable edildiğinde).

5) Settings page: Badge variant’ları

Badge variant="success" | "warning" kullanmışsın. Shadcn badge default’ta bunları sağlamıyorsa (projene bağlı) style hiç uygulanmayabilir veya TS tipi patlar. (Sen bazı yerlerde cast etmişsin, bu da runtime’da class üretmiyorsa “görünmez bug” olur.)

“Config değerlerini koda gömmeyelim” — ne yapalım?

Evet: Postgres’te JSONB config (tenant + environment scoped) en pratik yol.

Önerilen model:

settings tablosu: tenant_id, key, value jsonb, updated_at, updated_by

veya domain bazlı: watcher_config, notify_settings, agent_profiles zaten var gibi → hepsini DB source of truth yap.

Admin UI: CRUD ekranları (validation + default presetler)

Backend: config cache (in-memory) + invalidation (update sonrası)

Audit: her update audit log’a yazılsın (zaten audit sayfan var)