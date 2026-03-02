Yapılacaklar Listesi
🔴 Bug — Acil
1. staff_members JSON güncelleme hatası (staff.ts:265)

Sorun: [sql](http://_vscodecontentref_/17)${JSON.stringify(arr)}::jsonb`ifadesi PostgreSQL'e$1::jsonbyerine bozuk parametre gönderiyor →"invalid input syntax for type json"/"Expected ':', found ','"`
Etkilenen: Herhangi bir staff üyesini super_admin yapmaya çalışırken permissions veya settings içeren tüm PATCH istekleri patlıyor
Nerede: staff.repository.ts update() metodu (satır 122–128)
Çözüm: [sql](http://_vscodecontentref_/22)${...}::jsonb`` yerine Kysely'nin [sql](http://_vscodecontentref_/23)cast(${...} as jsonb)`` veya sql.raw(...) kullanılmalı
🟡 Özellik — Devam Eden
2. Scout false positive — seyahat tarihi filtresi YOK

Sorun: Scout portali today+90 ile tarar, müşterinin travel_date'ini görmez. Slot bulunca TÜM aktif müşterilere iş oluşturuyor. Ama müşterinin geçerli randevu penceresi [travelDate-45, travelDate-15] — bulunan tarihler bu pencereye girmeyebilir → booking agent boşa çalışıyor
Nerede: watcher.ts POST /slot-open — müşteri job'ı oluşturmadan önce open_dates ↔ müşteri penceresi kesişimi kontrol edilmeli
Plan (B+C):
B: callSlotOpen / /slot-open endpoint'i: her müşteri için [travelDate-45, travelDate-15] penceresiyle res.dates kesişimini kontrol et, eşleşme yoksa o müşteri için job oluşturma
C: Booking agent SLOT_SEARCHING girişinde: pencere dışındaysa erken WAITING_SLOT döndür
3. Booking agent runStageB (locator.click()) doğrulaması

Sorun: Önceki oturumda jQuery synthetic click sorunu giderildi, ama booking path'iyle (slotCheckOnly=false) test edilmedi
Yapılacak: Mock portal'da slotCheckOnly=false ile bir iş çalıştır, runStageB: clicked day cell via locator ve hasRealSlot:true loglarını gözlemle
🟢 UI / UX — Staff Portalı
4. Şifre alanı sadece super_admin görmeli

super_admin'de göz ikonu ile göster/gizle
Diğer roller **** redacted görür, edit edemez
5. Staff ekleme akışı — e-posta davetiye ile kayıt

Yeni staff eklenince girilen maile davetiye gönder
Link → portalda şifre belirleme formu (şifre + tekrar gir)
Şifre set edilene kadar listede pending durumda
Şifreler DB'ye şifreli (bcrypt) kaydedilmeli
Davet adımını tamamlamayanlar listede açıkça pending görünsün
6. Suspend gerçekten girişi engelliyor mu?

Suspended kullanıcı giriş yapmaya çalışınca "This account is suspended. Contact administrator." mesajı görmeli
Doğrulama gerekiyor
7. Portals sekmesi güncellemesi

Rate limit, OTP, CAPTCHA modları her portalda listelensin
Renk eski haline dönsün
🔵 Altyapı / Uzun Vadeli
8. SMTP e-posta için domain

E-posta gönderimi için gerçek domain alınmalı
9. Mouse hareketi — Mock server log'larına bak, birkaç hareket kayıt olmalı (mouseMoveIntervalMs)

10. Min 40 saniye kuralı — minRunDurationMs: 40000 enforce ediliyor mu? Log'lardan kontrol

11. Payments tab — Admin portalı için ödeme sekmesi

12. Headless sayfa 2 testi

Öneri sırası: 1 → 2 → 3 → 4 → 5 → 6 → 7

5) Current Services

We have the following containers:

visa-dp (Data Plane – worker)

visa-cp (Control Plane – API)

visa-admin-portal

visa-mock-portal

visa-staff-portal

We want to introduce Caddy as the public reverse proxy and TLS terminator.

5.1) Target Public Routing

All services must remain internal except Caddy.

External access only via Caddy (ports 80/443).

Domain Mapping

Example subdomains:

api.example.com → visa-cp

admin.example.com → visa-admin-portal

staff.example.com → visa-staff-portal

mock.example.com → visa-mock-portal

visa-dp must NOT be publicly exposed.

5.2) Docker Compose Changes

Add Caddy service:

services:
  caddy:
    image: caddy:2-alpine
    container_name: caddy
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./infra/caddy/Caddyfile:/etc/caddy/Caddyfile
      - caddy_data:/data
      - caddy_config:/config
    depends_on:
      - visa-cp
      - visa-admin-portal
      - visa-staff-portal
      - visa-mock-portal
    networks:
      - edge
      - backend

Internal services must NOT expose ports publicly:

Remove things like:

ports:
  - "8000:8000"

They should only use:

expose:
  - "8000"

(or nothing, if same network)

5.3) Example Caddyfile
api.example.com {
    reverse_proxy visa-cp:8000
}

admin.example.com {
    reverse_proxy visa-admin-portal:3000
}

staff.example.com {
    reverse_proxy visa-staff-portal:3000
}

mock.example.com {
    reverse_proxy visa-mock-portal:3000
}

Notes:

Caddy automatically handles HTTPS via Let’s Encrypt.

No manual cert management needed.

Ensure DNS A record points to server IP.

5.4) Network Isolation

We want two networks:

networks:
  edge:
  backend:

Caddy connected to both edge and backend

Other services connected only to backend

visa-dp must never connect to edge

5.5) Security Goals

Only Caddy exposed to internet

No direct access to:

visa-cp

visa-dp

portals

Automatic HTTPS

Minimal RAM footprint (Caddy is lightweight)

5.6) Important

Ensure:

NOTIFY_ACTION_BASE_URL updated to public domain (api.example.com)

Webhooks / Telegram signed ACK links use public URL

No service binds to 0.0.0.0 externally except Caddy