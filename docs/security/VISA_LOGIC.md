# Senin HTML/JS’e göre “legal-safe” test tasarımı (adım adım)
1) Fixture (selector) testi için minimal sayfa

Kopya site değil: sadece şu elementleri içeren kendi HTML’in:

#apForm

#NationalityTabID, #AppointmentTabID, #TravelSubject

#TravelDate, #datepicker, #AppointmentTime

input name’leri: PassaportNumber, Name, Surname, ...

#AppTime, #AppTimeSelectForm, .custom-loader-wrap, .appointment-form-wrapper

Ama Cloudflare/Turnstile scriptlerini hiç koyma. (Zaten CI’da çalışmayacak.)

2) Mock API contract’ı

Senin JS’den görünen backend çağrıları:

POST /AnBir/Macaristan/TarihGetir → data olarak tarih listesi dönüyor (disabled listesine yazılıyor)

POST /AnBir/Macaristan/SaatGetir → [{ value, text }] dönüyor

Mock server’da birebir aynı JSON shape’i üret.

Not: JS bug var: "<option value'" + data[i].value + "'>" → value=' eksik. Bizim automation buna dayanmayacak; direkt selectOption ile yönetiriz.

3) CI testleri (iki katman)

Selector unit: “bu selectorlar sayfada bulunuyor mu?”

Flow unit: “Nationality seç → AppointmentTab change → tarih endpoint çağrıldı mı → datepicker set edildi mi → saat endpoint çağrıldı mı → AppointmentTime doldu mu?”

4) Stage smoke (gerçek site)

Çok düşük frekansta, strict pacing + retry/backoff + circuit breaker

Sadece “sayfa açıldı + form elementleri bulundu + tarihler geliyorsa logla” gibi non-invasive smoke


## Flow

Tamam, iki paralel şey var:

“Randevu açıldı mı?” tespiti (watch/ping)

Slot-hunt/selectors v1 (bizim kod)

Aşağıdaki yaklaşım, anti-bot/korumaları aşmaya çalışmadan “availability” sinyali yakalamaya odaklanır.

1) Randevu açıldı mı? (watcher tasarımı)

Hedef: Açık gün/saat göründüğü anda event üretmek (ve gerekirse ayrı “booking” job’ını enqueue etmek).

Mantık

“Watcher” job’ı belirli aralıklarla çalışır (örn 30–90 sn jitter ile; tenant başına ayarlanabilir).

Sayfayı açar → form hazır mı kontrol eder → available date listesi geliyor mu bakar (UI’dan veya varsa endpoint response’undan).

Yeni bir “available slot set” görürse:

DB’ye SLOT_FOUND event + snapshot (tarih/saat listesi hash’i)

Notification (webhook/telegram/email)

İstersen queue’ya “booking” job’ı atar ama son adımı HITL ile onaylatırsın (operational safety).

Neden “ping” değil “watcher”?

Bu sitede availability genelde UI state + ajax ile geliyor. Saf HTTP ping çoğu zaman yeterli sinyal vermez. Yine de watcher “minimum etkileşim” ile kalmalı:

agresif polling yok

rate limit + backoff

hata artarsa circuit-breaker (5xx/403 -> cooldown)

Not: “randevu olduğu an kapacağız” dediğin kısım operasyonel olarak “slot found → hemen booking” demek. Bunu HITL onayı ile bağlamak en sağlıklısı (hem yanlış pozitif hem de istenmeyen davranış riskini azaltır).


## FSM logic
FSM ile ilerle, ama tasarımı şöyle yap:

“Run-scoped FSM” + “Checkpointed resume”

FSM tek çağrıda bütün adımları yürütür (context aynı)

Her state sonunda:

DB’ye job_events yaz

jobs.status güncelle

job_runs.checkpoint_data güncelle (minimum veri: state + küçük flags)

HITL oluşursa: state “WAITING_HITL”, job-run kapanır, context kapatılır

Resume geldiğinde FSM en baştan açılır ama resume_from_state ile doğru handler’dan başlar; gerektiğinde login tekrar eder

Bu yaklaşım:

spaghetti’yi engeller (FSM kazanımı)

worker’ı stateless tutar (senin sevdiğin)

anti-bot’a daha az “suspicious” pattern üretir

4) Bizim mevcut koda nasıl oturacak?

createJobContext() zaten var. Bunu FSM’in ctx’ine koyacağız.

portal.run() gibi dış orchestrator yerine, portal’ın step’leri FSM state handler’ları olacak:

LOGIN_PROCESS → login step

FORM_FILLING → fill step

PROCESSING → slot-hunt / submit step

slotHunt() “availability poll” ise bu bir state olabilir ya da PROCESSING altında loop.

Net cevap

Evet, “DB checkpoint → tekrar çağır” şeklinde kurarsan “page’i nereden bulacak?” problemi çıkar.

Hayır, FSM’i “in-memory run” yaparsan çıkmaz.

Crash/resume için en sağlam çözüm: stateless worker + gerektiğinde yeniden login (cookie restore değil).


5) Yani:
Portal driver kalacak mı?
Evet: plugin model + registry + lazy-load için kalması en doğru.
Ama driver’ın içi “linear script” değil, FSM çağrısı olacak.

Portal driver (plugin entrypoint): “Bu job hangi portal’a ait? Hangi step set’i / selector set’i / config?” sorusunun cevabı. Registry + lazy-load için ideal.

FSM (orchestrator): O portal’ın içindeki akışı doğru state yönetimi + retry/error/HITL ile çalıştıran motor.

Yani hedef mimari:

processor.ts -> portal.run(...) -> runPortalFSM(ctx) -> state handlers (login / slot-hunt / submit / ...)

Portal driver’ı kaldırıp “her portal için ayrı FSM runner” yazmak yerine, driver sadece FSM’i başlatan adaptör olsun.