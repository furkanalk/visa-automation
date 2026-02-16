# AS-VISA portal

Otomasyon, mock site (`.bin/as-visa.html` / `.bin/as-visa.js`) ve canlı sitedeki element id/name ile uyumlu selektörler kullanır.

## Yapı

- **config.ts** – Portal id (`as-visa`).
- **driver.ts** – Portal driver (run entry).
- **index.ts** – Portal ve FSM handler kaydı.
- **pages/** – Sayfa bazlı modül; her sayfa kendi selektörlerini tutar.
  - **make-appointment/** – Randevu alma sayfası (Ankara Bireysel formu).
    - `selectors.ts` – Bu sayfaya ait tüm selektörler (form, loaders, selects, inputs, sections, security).
    - `index.ts` – PAGE_ID + selektör re-export.
- **steps/** – Adımlar. Şu an sadece **slot-hunt** FSM’de kullanılıyor (slot arama). fill-form, security-code, payment ileride form doldurma / kod / ödeme için eklenecek.
- **fsm/handlers.ts** – FSM state handler’ları; `pages/make-appointment` selektörlerini ve `steps/slot-hunt` kullanır.

## Steps kullanımı

| Step          | Kullanım                          | Durum   |
|---------------|------------------------------------|---------|
| slot-hunt.ts  | SLOT_SEARCHING: sayfa aç, dateDisabled oku, müsait tarih var mı kontrol et | Kullanılıyor |
| fill-form.ts  | Form doldurma (ad, soyad, pasaport, vb.)   | Stub, ileride |
| security-code.ts | 6 haneli kod / CAPTCHA/Turnstile        | Stub, ileride |
| payment.ts    | Ödeme adımı (gerekirse)                  | Stub, ileride |

## Mock test (ufak ufak)

1. **Mock portalı aç**: `.bin/as-visa.html` (ve gerekirse as-visa.js) bir HTTP sunucusuyla servis et (örn. `npx serve .bin` veya projedeki bir mock server).
2. **Portal config**: Admin portal’da as-visa portalının **base_url**’ini mock sunucu adresine ayarla (örn. `http://localhost:3000`).
3. **Customer oluştur**: Admin portal’dan bir customer ekle; portal olarak as-visa seçili olsun.
4. **Job / Agent**: Job oluşturulunca (veya mevcut akışta) DP’de agent bu job’ı alır. FSM: **LOGIN_PROCESS** (sayfaya git, form selector’ı bekle) → **SLOT_SEARCHING** (slotHunt: sayfada `window.dateDisabled`’ı oku, müsait tarih var mı kontrol et).
5. **Mock’ta tarih vermek**: Canlı sitede `AppointmentTabID` change olunca `/AnBir/Macaristan/TarihGetir` çağrılıyor ve `window.dateDisabled` set ediliyor. Mock’ta bu API’yi taklit eden bir endpoint + sayfada bu isteği yapan JS olmalı; yoksa `dateDisabled` boş kalır ve slot-hunt “slot yok” görür. İleride mock API ekleyebilirsin (ör. birkaç tarih döndüren stub).

## Müşteri formu (Admin Portal)

Admin portal’da **Portals → Configure → Customer form fields (schema)** ile portala özel alanlar tanımlanır. Müşteri eklerken önce portal seçilir; seçilen portala göre bu alanlar açılır. Değerler `customer.preferences` içinde saklanır; agent (özellikle fill-form adımı) bu key’leri kullanarak formu doldurur. **Schema’daki `key` değerleri selektörlerdeki mantıksal isimlerle uyumlu olmalı** (örn. `nationality`, `name`, `passportNumber`) ki agent doğru input’a yazabilsin.

## Selektör stratejisi

- **Sayfa başına tek selectors dosyası**: Her sayfa için bir `selectors.ts` (örn. `pages/make-appointment/selectors.ts`). Tüm alanlar gruplu (form, loaders, selects, inputs, sections, security) tek yerde; HTML’deki id/name ile eşlemesi kolay.
- **Fonksiyonellik steps’te**: Doldurma, tıklama, bekleme gibi davranış `steps/` ve `fsm/handlers.ts` içinde; selektörler sadece “nerede” bilgisi taşır.
- İleride yeni sayfa (örn. başvuru takibi) eklendiğinde: `pages/tracking/selectors.ts` + `index.ts` eklenir; driver veya FSM’de sayfa yönlendirmesi yapılır.

## Selektör doğrulama

Mock HTML’deki önemli alanlar:

| Alan           | HTML id/name              | Selektör (selectors.ts)     |
|----------------|---------------------------|-----------------------------|
| Form           | id="apForm"               | form                        |
| Uyruk          | id="NationalityTabID"     | selects.nationality         |
| Randevu tipi   | id="AppointmentTabID"     | selects.appointment        |
| Seyahat nedeni | id="TravelSubject"        | selects.travelSubject      |
| Seyahat tarihi | id="TravelDate"           | inputs.travelDate          |
| Randevu tarihi | id="datepicker"           | inputs.appointmentDate     |
| Randevu saati  | id="AppointmentTime"      | selects.appointmentTime    |
| Pasaport       | name="PassaportNumber"    | inputs.passportNumber      |
| Ad             | name="Name"               | inputs.name                |
| Soyad          | name="Surname"            | inputs.surname             |
| T.C. Kimlik    | name="TcKimlikNo"         | inputs.tcKimlikNo          |
| Tekrar T.C.    | name="reTCKN"             | inputs.reTckn              |
| Doğum yılı     | name="DogumYili"          | inputs.dogumYili            |
| Telefon        | name="Phone"              | inputs.phone               |
| E-posta        | name="Email" / "reEmail"   | inputs.email / reEmail     |
| 6 haneli kod   | name="enteredCode"        | inputs.enteredCode         |
| Submit         | button[type=submit]       | submit                     |
