# Özellik listesi

Bu dosya projedeki özellikleri (tamamlanan, sürüyor, planlanan) toplar.

---

## Tamamlanan

- Control Plane (CP) API: agents, profiles, portals, jobs, notify, watcher, audit, settings, customers, staff (temel CRUD).
- Public job API: create, list, get, stop/ack (token).
- Data Plane (DP): queue worker, config from CP, portal runs, HITL task oluşturma.
- Admin portal: config, agents, profiles, portals, jobs, notify, watcher, audit, customers, staff (temel), settings.
- Config: system_settings (Postgres), bootstrap/migrations, fail-fast env (Redis/DB/CP_URL).
- Staff portal: temel yapı, login, notifications (stub).

---

## Sürüyor / Kısmen

- Staff portal: tam akış bitmedi; HITL onayları ve aksiyonlar henüz yok.
- E2E / dev test: debug ve test süreci devam edecek.

---

## Planlanan

### Staff portal – HITL onayları ve aksiyonlar

- **Amaç:** Staff sadece portaldan çalışabilsin; HITL task’ları portaldan alıp çözebilsin.
- **Kapsam:**
  - HITL için **Notify** ve **Aksiyon** tab’ları (bildirimler + yapılacak işler).
  - Task atama (assign) ve çözüm (resolve) işlemleri portaldan.
  - DB’de alanlar hazır: `hitl_tasks.assigned_staff_id`, `resolved_staff_id` (FK → staff_members).
- **Bağımlılık:** Staff portal temel auth ve layout; CP’de assign/resolve API’leri (veya mevcut HITL route’larının staff portal’dan kullanılması).

---

### Test & güvenilirlik

- **Concurrency soak test:** 100 agent simülasyonu; yük altında queue, lock ve DB davranışı.
- **Lock chaos test:** Worker’ı run ortasında kill; lock süresi dolunca stuck-job recovery ve re-queue doğruluğu.
- **Retry exhaustion correctness:** Max retry’a ulaşınca job’ın doğru terminal state’e geçmesi, event/audit tutarlılığı.
- **Proxy failure scenarios:** Proxy timeout / unreachable; job’ın retry veya fail path’inin doğrulanması.
- **Memory profiling:** Playwright context’leri; context/browser leak, uzun süre çalışan worker bellek kullanımı.

---

### İzleme & prod

- **Monitoring dashboard tuning:** Metrikler (queue depth, job rate, agent health), alert eşikleri, Grafana/Prometheus panoları.
- **Real environment smoke test:** Gerçek hedef site (veya staging) üzerinde kısa smoke; login + kritik adımların çalıştığından emin olma.

---

### Site değişiklik tespiti (HTML drift)

- **Cron / scheduled job:** Hedef sitenin HTML’ini her gün rastgele bir saatte dump et; önceki dump ile karşılaştır.
- **Amaç:** Selector/HTML değişikliği automation’ı kırmadan önce tespit (mevcut watcher/snapshot’tan bağımsız veya onunla entegre).
- **Çıktı:** Değişiklik varsa bildirim (Telegram/email) veya dashboard’da uyarı.

---

### Öneriler: Admin / staff & mock

- **Admin için mock tenant + test staff:** Tek tıkla “test tenant” + birkaç staff (admin, staff1, staff2) oluşturma; seed veya Admin UI’dan “Create test tenant” butonu. Migration 012’deki seed staff’ı belirli bir test tenant’a bağlama veya dev ortamında otomatik test tenant.
- **Staff portal için mock HITL akışı:** Mock portal’da veya ayrı bir “HITL demo” sayfasında sahte task üretip assign/resolve akışını UI’da prova etme (gerçek job’a gerek kalmadan).
- **Mock portal çeşitliliği:** Farklı selector versiyonları veya hata senaryoları (CAPTCHA, OTP, 404) için birden fazla mock portal endpoint’i; E2E’de senaryo seçimi.
- **Admin’de “Run slot check” gerçekten job üretsin:** Müşteri ekranından tetiklenince `customer_id`’li job oluşturup queue’ya atma; böylece `jobs.customer_id` + trigger tekrar eklenebilir (şu an TODO).

---

*Yeni özellik eklerken ilgili bölüme (Tamamlanan / Sürüyor / Planlanan) madde ekleyin.*
