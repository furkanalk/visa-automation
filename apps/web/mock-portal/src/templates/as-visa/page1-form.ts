/**
 * AS-Visa Mock Portal - Page 1: Appointment Form
 *
 * This template matches the EXACT HTML structure and JavaScript behavior
 * of the real as-visa portal.
 *
 * Based on:
 * - /home/purple/repos/visa-automation/as-visa.html
 * - /home/purple/repos/visa-automation/as-visa.js
 */

export interface Page1Options {
  csrfToken: string;
  availableDates: string[]; // Format: YYYY-M-D (e.g., "2026-2-16")
  availableTimes: string[];
  showCaptcha: boolean;
  captchaAutoSolve: boolean;
  captchaAutoSolveDelayMs: number;
  securityCode: string;
  skipInfoPopup: boolean;
  skipBotDetection: boolean;
}

export function renderPage1(options: Partial<Page1Options> = {}): string {
  const {
    csrfToken = generateToken(),
    availableDates = [],
    availableTimes = ['09:00', '09:30', '10:00', '10:30', '11:00', '14:00', '14:30', '15:00'],
    showCaptcha = true,
    captchaAutoSolve = true,
    captchaAutoSolveDelayMs = 3000,
    securityCode = generateSecurityCode(),
    skipInfoPopup = true,
    skipBotDetection = true,
  } = options;

  const dateDisabledJS = JSON.stringify(availableDates);
  const availableTimesJS = JSON.stringify(availableTimes);

  return `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="version" content="1.0.1">
  <title>AS VISA SOLUTIONS | Mock Portal</title>

  <!-- Mimic AS-Visa asset paths (same as as-visa.html) -->
  <link rel="stylesheet" href="/WebSite/assets/css/global-settings.css" type="text/css" media="all" />
  <link rel="stylesheet" href="/WebSite/assets/css/theme.css" type="text/css" media="all" />

  <!-- jQuery -->
  <script src="https://code.jquery.com/jquery-3.6.0.min.js"></script>

  <!-- Bootstrap Datepicker -->
  <link href="https://cdnjs.cloudflare.com/ajax/libs/bootstrap-datepicker/1.10.0/css/bootstrap-datepicker.min.css" rel="stylesheet" />
  <script src="https://cdnjs.cloudflare.com/ajax/libs/bootstrap-datepicker/1.10.0/js/bootstrap-datepicker.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/bootstrap-datepicker/1.10.0/locales/bootstrap-datepicker.tr.min.js"></script>

  <!-- SweetAlert2 & Toastr -->
  <script src="https://cdn.jsdelivr.net/npm/sweetalert2@11"></script>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/toastr.js/latest/css/toastr.min.css">
  <script src="https://cdnjs.cloudflare.com/ajax/libs/toastr.js/latest/js/toastr.min.js"></script>

  <style>
    .mock-banner {
      background: #ff5722;
      color: white;
      padding: 8px 15px;
      text-align: center;
      font-weight: 600;
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      z-index: 10001;
      font-family: Arial, sans-serif;
      font-size: 14px;
    }
    body { padding-top: 40px; font-family: 'DM Sans', Arial, sans-serif; margin: 0; background: #f5f5f5; }

    /* Loaders */
    .lds-ring { display: none; position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 80px; height: 80px; z-index: 9999; }
    .lds-ring div { box-sizing: border-box; display: block; position: absolute; width: 64px; height: 64px; margin: 8px; border: 8px solid #1d2657; border-radius: 50%; animation: lds-ring 1.2s cubic-bezier(0.5, 0, 0.5, 1) infinite; border-color: #1d2657 transparent transparent transparent; }
    @keyframes lds-ring { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }

    .loader-wrap { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: white; z-index: 9998; display: flex; align-items: center; justify-content: center; }
    .spinner { width: 50px; height: 50px; border: 5px solid #f3f3f3; border-top: 5px solid #1d2657; border-radius: 50%; animation: spin 1s linear infinite; }
    @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }

    .custom-loader-wrap { display: flex; justify-content: center; padding: 40px; }
    .custom-loader { width: 48px; height: 48px; border: 5px solid #FFF; border-bottom-color: #1d2657; border-radius: 50%; display: inline-block; animation: rotation 1s linear infinite; }
    @keyframes rotation { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }

    .app-time-loader-wrap { display: flex; justify-content: center; padding: 20px; }

    /* Header & Page */
    .header_area { background: #1d2657; padding: 15px 0; }
    .large-container { max-width: 1200px; margin: 0 auto; padding: 0 15px; }
    .page_header_default { background: linear-gradient(rgba(29, 38, 87, 0.85), rgba(29, 38, 87, 0.85)); background-size: cover; padding: 60px 0; text-align: center; color: white; }
    .banner_title_inner .title { font-size: 28px; font-weight: 700; }
    .breadcrumb { list-style: none; padding: 0; margin: 20px 0 0; display: flex; justify-content: center; gap: 10px; }
    .breadcrumb li { color: rgba(255,255,255,0.8); }
    .breadcrumb a { color: white; text-decoration: none; }

    /* Form */
    .form-section { background: #f8f9fa; padding: 60px 0; }
    .container { max-width: 800px; margin: 0 auto; padding: 0 15px; }
    .section_title { text-align: center; margin-bottom: 30px; }
    .section_title .sm_title { color: #f15a29; font-size: 16px; margin-bottom: 10px; }
    .section_title .title { color: #1d2657; font-size: 32px; font-weight: 700; }
    .appointment-form-wrapper { background: white; padding: 30px; border-radius: 8px; box-shadow: 0 5px 30px rgba(0,0,0,0.1); }

    .form-group { margin-bottom: 20px; }
    .form-group label { display: block; margin-bottom: 8px; font-weight: 600; color: orangered; }
    .form-control { width: 100%; padding: 12px 15px; border: 1px solid #ddd; border-radius: 5px; font-size: 15px; background: white; box-sizing: border-box; }
    .form-control:focus { outline: none; border-color: #1d2657; }
    .form-select { width: 100%; padding: 12px 15px; border: 1px solid #ddd; border-radius: 5px; font-size: 15px; background: white; }

    /* Datepicker - position below input + opaque container (reeldeki gibi) */
    .datepicker-input-wrap { position: relative; display: inline-block; width: 100%; }
    /* Dropdown kutusu opak; arkasi gorme (transparency fix) */
    .datepicker,
    .datepicker-dropdown {
      z-index: 10000 !important;
      position: absolute !important;
      left: 0 !important;
      top: 100% !important;
      margin-top: 2px !important;
      background: #fff !important;
      border: 1px solid #ccc !important;
      border-radius: 4px !important;
      box-shadow: 0 6px 12px rgba(0,0,0,0.175) !important;
      padding: 4px !important;
    }
    .datepicker table { background: #fff !important; }
    .datepicker-dropdown.datepicker-orient-bottom::before,
    .datepicker-dropdown.datepicker-orient-bottom::after { display: none; }
    .datepicker table tr td.day { cursor: pointer; background: #fff; }
    .datepicker table tr td.day:hover { background: #eee; }
    /* Reeldeki as-visa.html inline style ile ayni: sadece renk (color) */
    .orange-bg { color: darkgreen !important; }
    .red-bg { color: darkorange !important; }
    .blue-text { color: darkgreen !important; }
    .white-text { color: darkorange !important; }
    /* Disabled gunler - reeldeki: disabled + red-bg + white-text => darkorange yazi, gri arka */
    .datepicker table tr td.disabled { cursor: not-allowed !important; background: #eee !important; }
    .datepicker table tr td.disabled:hover { background: #eee !important; }
    .datepicker table tr td.disabled.red-bg,
    .datepicker table tr td.disabled.white-text { color: darkorange !important; background: #eee !important; }
    /* Musait gunler - reeldeki: orange-bg + blue-text => darkgreen yazi, acik yesil arka */
    .datepicker table tr td.day.orange-bg,
    .datepicker table tr td.day.orange-bg.disabled,
    .datepicker table tr td.orange-bg,
    .datepicker table tr td.day.blue-text {
      color: darkgreen !important;
      background: #d4edda !important;
      cursor: pointer !important;
      pointer-events: auto !important;
    }
    .datepicker table tr td.day.orange-bg:hover,
    .datepicker table tr td.orange-bg:hover { background: #c3e6cb !important; }
    /* Musait olmayan (kapali) gunler - reeldeki: disabled + red-bg + white-text */
    .datepicker table tr td.day.red-bg:not(.orange-bg),
    .datepicker table tr td.red-bg { color: darkorange !important; background: #eee !important; }
    /* Secili tarih */
    .datepicker table tr td.day.active,
    .datepicker table tr td.active { background: #1d2657 !important; color: white !important; }

    /* Turnstile CAPTCHA */
    .cf-turnstile { min-height: 65px; display: flex; align-items: center; justify-content: center; background: #fafafa; border: 1px dashed #ddd; border-radius: 5px; padding: 15px; margin: 20px 0; }
    .cf-turnstile.solved { background: #e8f5e9; border-color: #4caf50; border-style: solid; }
    .turnstile-mock { display: flex; align-items: center; gap: 10px; }
    .turnstile-mock input[type="checkbox"] { width: 24px; height: 24px; cursor: pointer; }

    /* Submit button */
    .theme_btn { background: linear-gradient(135deg, #f15a29, #ff8c00); color: white; border: none; padding: 15px 40px; font-size: 16px; font-weight: 600; border-radius: 5px; cursor: pointer; width: 100%; }
    .theme_btn:hover { transform: translateY(-2px); box-shadow: 0 5px 20px rgba(241, 90, 41, 0.4); }
    .theme_btn:disabled { background: #ccc; cursor: not-allowed; transform: none; box-shadow: none; }

    /* Countdown */
    #countdown-timer { position: fixed; bottom: 10px; left: 10px; background-color: #f15a29; color: #1d2657; padding: 10px 20px; border-radius: 5px; font-size: 16px; font-weight: bold; z-index: 1000; }

    .row { display: flex; flex-wrap: wrap; margin: 0 -10px; }
    .col-md-12 { width: 100%; padding: 0 10px; }
  </style>
  <link rel="stylesheet" href="/PageJs/loader/loader.css" />
</head>

<body class="theme-vankine scrollbarcolor">
  <div class="mock-banner">⚠️ MOCK PORTAL - Test Environment (Port 3004)</div>

  <div class="lds-ring"><div></div><div></div><div></div><div></div></div>

  <div id="page" class="page_wapper">
    <div class="loader-wrap" id="preloader">
      <div class="animation-preloader"><div class="spinner"></div></div>
    </div>

    <div class="header_area">
      <div class="large-container">
        <div style="display: flex; align-items: center; justify-content: space-between;">
          <span style="color: white; font-size: 24px; font-weight: bold;">🎭 AS-VISA MOCK</span>
          <nav style="color: white;">
            <a href="/" style="color: white; margin: 0 15px; text-decoration: none;">Ana Sayfa</a>
          </nav>
        </div>
      </div>
    </div>

    <section class="page_header_default">
      <div class="container">
        <div class="banner_title_inner">
          <div class="title"><span class="main_tit">Ankara Çankaya<br />Macaristan Bireysel Randevu (C)</span></div>
        </div>
        <ul class="breadcrumb">
          <li><a href="#">Ankara Çankaya</a></li>
          <li class="active">Macaristan Bireysel Randevu (C)</li>
        </ul>
      </div>
    </section>

    <section class="form-section">
      <div class="container">
        <div class="section_title">
          <h4 class="sm_title">Ankara Çankaya - Macaristan Bireysel Randevu (C)</h4>
          <h4 class="title">Randevu Al (Book Appointment)</h4>
        </div>

        <div class="col-12 custom-loader-wrap" id="initialLoader">
          <span class="custom-loader"></span>
        </div>

        <div class="appointment-form-wrapper" id="formWrapper" style="display:none">
          <form id="apForm" method="POST" action="/as-visa/submit">
            <input name="__RequestVerificationToken" type="hidden" value="${csrfToken}" />
            <input type="hidden" id="cfToken" name="cfToken" />
            <input type="hidden" name="formStartTime" id="formStartTime" />

            <div class="controls">
              <div class="row">
                <!-- Randevu Tipi -->
                <div class="col-md-12 col-sm-12" style="margin-bottom:20px">
                  <div class="form-group"><label>Randevu Tipi (Randevu Al)</label></div>
                  <div class="form-group">
                    <select class="form-select form-control"><option value="Bireysel">Bireysel (Individual)</option></select>
                  </div>
                </div>

                <!-- #NationalityTabID -->
                <div class="col-md-12 col-sm-12" style="margin-bottom:20px">
                  <div class="form-group"><label>Ülke Seçiniz (Select Country)</label></div>
                  <div class="form-group">
                    <select class="form-select form-control" id="NationalityTabID" name="Nationality" required>
                      <optgroup label="Lütfen Uyruğunuzu Seçiniz.">
                        <option selected value="null">Lütfen Uyruğunuzu Seçiniz.</option>
                        <option value="TÜRKİYE">TÜRKİYE</option>
                        <option value="AFGANİSTAN">AFGANİSTAN</option>
                        <option value="AZERBAYCAN">AZERBAYCAN</option>
                        <option value="SURİYE">SURİYE</option>
                      </optgroup>
                    </select>
                  </div>
                </div>

                <!-- #AppointmentTabID -->
                <div class="col-md-12 col-sm-12" style="margin-bottom:20px">
                  <div class="form-group"><label>Randevu Tanımı Seçiniz (Select Appointment Description)</label></div>
                  <div class="form-group">
                    <select class="form-select form-control" id="AppointmentTabID" name="Appointment" required>
                      <optgroup label="Lütfen Başvuru Tipini Seçiniz">
                        <option value="Macaristan Bireysel Randevu (C)">Macaristan Bireysel Randevu (C)</option>
                      </optgroup>
                    </select>
                  </div>
                </div>

                <!-- #TravelSubject -->
                <div class="col-md-12 col-sm-12" style="margin-bottom:20px">
                  <div class="form-group"><label>Seyahat Tanımı Seçiniz (Select Travel Description)</label></div>
                  <div class="form-group">
                    <select class="form-select form-control" id="TravelSubject" name="TravelSubject" required>
                      <optgroup label="Lütfen Seyahat Nedenininizi Seçiniz">
                        <option value="Turist">Turist</option>
                        <option value="Aile ya da Arkadaşlar Ziyaret">Aile ya da Arkadaşlar Ziyaret</option>
                        <option value="İş (Ticari)">İş (Ticari)</option>
                        <option value="Eğitim">Eğitim</option>
                        <option value="Sağlık Nedenleri">Sağlık Nedenleri</option>
                      </optgroup>
                    </select>
                  </div>
                </div>

                <!-- #TravelDate (wrapper for datepicker position - opens below input) -->
                <div class="col-md-12 col-sm-12">
                  <div class="form-group"><label>Seyahat Tarihi (Travel Date)</label></div>
                  <div class="form-group datepicker-input-wrap" id="TravelDate-container" style="margin-bottom:20px;">
                    <input type="text" readonly required class="form-control" name="TravelDate" id="TravelDate" placeholder="Lütfen Seyahat Tarihini Seçiniz" />
                  </div>
                </div>

                <!-- Honeypot -->
                <div class="col-md-12 col-sm-12">
                  <input type="text" name="CompanyName" style="display:none" tabindex="-1" autocomplete="off" />
                </div>

                <!-- #apDate - Randevu Tarihi (wrapper for datepicker position - opens below input) -->
                <div class="col-md-12 col-sm-12" style="margin-bottom:20px" id="apDate">
                  <div class="form-group"><label>Randevu Tarihi (Appointment Date)</label></div>
                  <div class="form-group datepicker-input-wrap" id="datepicker-container">
                    <input type="text" readonly required class="form-control" name="AppointmentDate" id="datepicker" placeholder="Lütfen Randevu Tarihini Seçiniz" />
                  </div>
                </div>

                <!-- #AppTime - Randevu Saati (Initially HIDDEN) -->
                <div class="col-md-12 col-sm-12" id="AppTime" style="display:none">
                  <div class="form-group"><label>Randevu Saati (Appointment Time)</label></div>
                  <div class="form-group" style="display:none" id="AppTimeSelectForm">
                    <select class="form-select form-control" id="AppointmentTime" name="AppointmentTime" required style="display:none;"></select>
                  </div>
                  <div class="form-group app-time-loader-wrap">
                    <span class="custom-loader"></span>
                  </div>
                </div>

                <!-- Passport (id/name from as-visa.html) -->
                <div class="col-md-12 col-sm-12" id="PassaportNo" style="display:block; margin-bottom:20px;">
                  <div class="form-group"><label>Pasaport Numarası (Passport Number)</label></div>
                  <div class="form-group">
                    <input type="text" class="form-control" maxlength="9" name="PassaportNumber" placeholder="Lütfen Pasaport No Giriniz" required />
                  </div>
                </div>

                <!-- Name (id Adi, name Name - as-visa.html) -->
                <div class="col-md-12 col-sm-12" id="Adi" style="display:block; margin-bottom:20px;">
                  <div class="form-group"><label>Adınız (First Name)</label></div>
                  <div class="form-group">
                    <input type="text" maxlength="70" class="form-control" name="Name" placeholder="Lütfen Adınızı Giriniz" required />
                  </div>
                </div>

                <!-- Surname (id Soyadi, name Surname - as-visa.html) -->
                <div class="col-md-12 col-sm-12" id="Soyadi" style="display:block; margin-bottom:20px;">
                  <div class="form-group"><label>Soyadınız (Last Name)</label></div>
                  <div class="form-group">
                    <input type="text" maxlength="70" class="form-control" name="Surname" placeholder="Lütfen Soyadınızı Giriniz" required />
                  </div>
                </div>

                <!-- TC Kimlik (id tcKimlikNo, name TcKimlikNo - as-visa.html) -->
                <div class="col-md-12 col-sm-12" id="tcKimlikNo" style="display:block; margin-bottom:20px;">
                  <div class="form-group"><label>T.C. Kimlik (Turkish ID Number)</label></div>
                  <div class="form-group">
                    <input type="tel" class="form-control" maxlength="11" name="TcKimlikNo" placeholder="Lütfen T.C. Kimlik No Giriniz" />
                  </div>
                </div>

                <!-- Re-TC Kimlik (id retcKimlikNo, name reTCKN - as-visa.html) -->
                <div class="col-md-12 col-sm-12" id="retcKimlikNo" style="display:block; margin-bottom:20px;">
                  <div class="form-group"><label>Tekrar T.C. Kimlik (Re-enter Turkish ID Number)</label></div>
                  <div class="form-group">
                    <input type="tel" class="form-control" maxlength="11" name="reTCKN" placeholder="Lütfen T.C. Kimlik No Giriniz" />
                  </div>
                </div>

                <!-- Birth Year (id dogumYili, name DogumYili - as-visa.html) -->
                <div class="col-md-12 col-sm-12" id="dogumYili" style="display:block; margin-bottom:20px;">
                  <div class="form-group"><label>Doğum Yılı (Year of Birth)</label></div>
                  <div class="form-group">
                    <input type="tel" maxlength="4" class="form-control" name="DogumYili" placeholder="Lütfen Doğum Yılınızı Giriniz" required />
                  </div>
                </div>

                <!-- Phone (id Telefon, name Phone - as-visa.html) -->
                <div class="col-md-12 col-sm-12" id="Telefon" style="display:block; margin-bottom:20px;">
                  <div class="form-group"><label>Telefon Numarası (Phone Number)</label></div>
                  <div class="form-group">
                    <input type="tel" maxlength="15" class="form-control" name="Phone" placeholder="Lütfen Telefon Giriniz" required />
                  </div>
                </div>

                <!-- Email (id Eposta, name Email - as-visa.html) -->
                <div class="col-md-12 col-sm-12" id="Eposta" style="display:block; margin-bottom:20px;">
                  <div class="form-group"><label>E-posta (Email)</label></div>
                  <div class="form-group">
                    <input type="email" maxlength="100" class="form-control" name="Email" placeholder="Lütfen E-posta Giriniz" required />
                  </div>
                </div>

                <!-- Re-Email (id reEposta, name reEmail - as-visa.html) -->
                <div class="col-md-12 col-sm-12" id="reEposta" style="display:block; margin-bottom:20px;">
                  <div class="form-group"><label>Tekrar E-posta (Re-enter Email)</label></div>
                  <div class="form-group">
                    <input type="email" maxlength="100" class="form-control" name="reEmail" placeholder="Lütfen E-posta Giriniz" required />
                  </div>
                </div>

                <!-- Security Code -->
                <div class="col-md-12 col-sm-12">
                  <div class="form-group">
                    <label>6 Haneli Kod (6-Digit Code): <strong style="font-size: 18px; color: #1d2657;">${securityCode}</strong></label>
                    <input type="tel" maxlength="6" minlength="6" class="form-control" placeholder="Lütfen 6 Haneli Kodu Giriniz." name="enteredCode" required />
                  </div>
                </div>

                <!-- Turnstile CAPTCHA -->
                ${
                  showCaptcha
                    ? `
                <div class="col-md-12 col-sm-12">
                  <div class="form-group">
                    <div class="cf-turnstile" id="turnstileContainer" data-sitekey="mock-sitekey" data-theme="dark">
                      <div class="turnstile-mock">
                        <input type="checkbox" id="turnstileCheck" />
                        <span>Ben robot değilim / I'm not a robot</span>
                      </div>
                    </div>
                  </div>
                </div>
                `
                    : ''
                }

                <!-- Submit -->
                <div class="col-sm-12">
                  <div class="form-group apbtn">
                    <button class="theme_btn" type="submit" id="submitBtn" ${showCaptcha ? 'disabled' : ''}>
                      Randevu Al (Book Appointment)
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </form>
        </div>
      </div>
    </section>

    <div id="countdown-timer">Kalan Süre: <span id="timer">09:00</span></div>
  </div>

  <script>
    // ===== GLOBALS (same as real portal) =====
    var dateDisabled = ${dateDisabledJS};
    var availableTimes = ${availableTimesJS};
    var expectedSecurityCode = "${securityCode}";
    var pageLoadTime;

    // ===== LOADING FUNCTIONS (exact match) =====
    function showLoading() {
      $('.appointment-form-wrapper').hide();
      $('.custom-loader-wrap').show();
    }
    function hideLoading() {
      $('.custom-loader-wrap').hide();
      $('.appointment-form-wrapper').show();
    }
    function showAppTimeLoading() {
      $('#AppTimeSelectForm').hide();
      $('.app-time-loader-wrap').show();
    }
    function hideAppTimeLoading() {
      $('.app-time-loader-wrap').hide();
      $('#AppTimeSelectForm').show();
    }
    function showSpinner() { $('.lds-ring').show(); }
    function hideSpinner() { $('.lds-ring').hide(); }

    // ===== TURNSTILE =====
    function onTurnstileSuccess(token) {
      $('#cfToken').val(token);
      $('#submitBtn').prop('disabled', false);
      $('#turnstileContainer').addClass('solved');
    }

    ${
      showCaptcha
        ? `
    $('#turnstileCheck').on('change', function() {
      if (this.checked) {
        onTurnstileSuccess('mock-cf-token-' + Date.now());
      } else {
        $('#cfToken').val('');
        $('#submitBtn').prop('disabled', true);
        $('#turnstileContainer').removeClass('solved');
      }
    });
    ${
      captchaAutoSolve
        ? `
    setTimeout(function() {
      if (!$('#turnstileCheck').is(':checked')) {
        $('#turnstileCheck').prop('checked', true).trigger('change');
        console.log('[Mock] CAPTCHA auto-solved');
      }
    }, ${captchaAutoSolveDelayMs});
    `
        : ''
    }
    `
        : ''
    }

    // ===== COUNTDOWN TIMER =====
    function startCountdown() {
      var timeLimit = 9 * 60;
      var remainingTime = timeLimit;
      var el = document.getElementById('timer');
      var interval = setInterval(function() {
        remainingTime--;
        var m = Math.floor(remainingTime / 60);
        var s = remainingTime % 60;
        el.textContent = m.toString().padStart(2, '0') + ':' + s.toString().padStart(2, '0');
        if (remainingTime <= 0) {
          clearInterval(interval);
          Swal.fire({ icon: 'warning', title: 'Süre Doldu!', text: 'Sayfa yenileniyor...', timer: 3000, showConfirmButton: false }).then(function() { window.location.reload(); });
        }
      }, 1000);
    }

    // ===== FETCH TIMES (mock) =====
    function tarihGetir() {
      showAppTimeLoading();
      var selectedDate = $('#datepicker').val();
      console.log('[Mock] Fetching times for:', selectedDate);

      setTimeout(function() {
        $('#AppointmentTime').empty();
        for (var i = 0; i < availableTimes.length; i++) {
          $('#AppointmentTime').append('<option value="' + availableTimes[i] + '">' + availableTimes[i] + '</option>');
        }
        $('#AppTime').show();
        $('#AppTimeSelectForm').show();
        $('#AppointmentTime').show();
        hideAppTimeLoading();
      }, 500);
    }

    // ===== DATEPICKER INITIALIZATION (EXACT match to real portal) =====
    $(function() {
      var date = new Date(), y = date.getFullYear(), m = date.getMonth();
      var firstDay = new Date(y, m, 1);
      var lastDay = new Date(y, m + 12, 0);

      // Initially hide #apDate (same as real portal JS)
      if ($('#TravelDate').val()) {
        $("#apDate").show();
      } else {
        $("#apDate").hide();
      }

      // Click on disabled day shows error (but not if it has orange-bg = available)
      $('body').on('click', '.day.disabled:not(.orange-bg)', function(e) {
        toastr.error('Seçim yapmak istediğiniz tarihi size veremiyoruz. Açık olan tarihlerde seçiminizi gerçekleştiriniz.');
      });
      
      // Force click handler for available dates (in case bootstrap disables them)
      $('body').on('click', '.day.orange-bg', function(e) {
        e.stopPropagation();
        var $this = $(this);
        var date = $this.data('date');
        console.log('[Mock] Orange-bg date clicked:', date, $this.text());
        
        // Format: day number is the text content
        var day = parseInt($this.text(), 10);
        var $datepicker = $this.closest('.datepicker');
        var currentMonth = $datepicker.find('.datepicker-switch').text();
        console.log('[Mock] Current month view:', currentMonth, 'day:', day);
        
        // Let bootstrap handle it if it's enabled
        if (!$this.hasClass('disabled')) {
          return; // Let default behavior work
        }
        
        // If disabled class exists but it's available, we need to force select
        var $input = $('#datepicker');
        var currentDate = $input.datepicker('getViewDate') || new Date();
        var newDate = new Date(currentDate.getFullYear(), currentDate.getMonth(), day);
        
        // Format as dd/mm/yyyy
        var formatted = ('0' + day).slice(-2) + '/' + ('0' + (newDate.getMonth() + 1)).slice(-2) + '/' + newDate.getFullYear();
        $input.val(formatted);
        $input.datepicker('hide');
        $input.trigger('change');
        $input.trigger('changeDate');
        console.log('[Mock] Forced date selection:', formatted);
      });

      // Travel Subject change - In MOCK, we don't apply strict date range restrictions
      // This makes testing easier. The real portal restricts appointment dates to 15-45 days before travel.
      // For mock portal, all dates in dateDisabled array are selectable regardless of TravelSubject.
      $('select[name=TravelSubject]').change(function() {
        var value = $(this).val();
        console.log('[Mock] TravelSubject changed:', value);
        // In mock, always allow full date range - remove restrictions
        $('#datepicker').datepicker("setStartDate", firstDay);
        $('#datepicker').datepicker("setEndDate", lastDay);
      });

      // ===== #datepicker - Appointment Date (container fixes position: opens below input) =====
      $("#datepicker").datepicker({
        weekStart: 1,
        autoclose: true,
        todayHighlight: true,
        format: "dd/mm/yyyy",
        startDate: firstDay,
        endDate: lastDay,
        language: 'tr',
        container: '#datepicker-container',
        orientation: 'bottom auto',
        beforeShowDay: function(date) {
          var today = new Date();
          today.setHours(0, 0, 0, 0);
          var current = new Date(date.getFullYear(), date.getMonth(), date.getDate());
          // Format: YYYY-M-D (no leading zeros) - same as real portal
          var formatted = date.getFullYear() + '-' + (date.getMonth() + 1) + '-' + date.getDate();

          if (current < today) {
            return { enabled: false, classes: 'disabled past-date red-bg white-text' };
          }
          if (current.getTime() === today.getTime()) {
            return { enabled: false, classes: 'disabled today-date red-bg white-text' };
          }
          // Check if date is in available dates
          if ($.inArray(formatted, dateDisabled) !== -1) {
            return { enabled: true, classes: 'orange-bg blue-text' };
          }
          return { enabled: false, classes: 'disabled red-bg white-text' };
        }
      }).on('changeDate', function() {
        tarihGetir();
      });

      // ===== #TravelDate (container fixes position: opens below input) =====
      var nextDay = new Date();
      nextDay.setDate(nextDay.getDate() + 1);
      
      $("#TravelDate").datepicker({
        weekStart: 1,
        autoclose: true,
        todayHighlight: true,
        language: 'tr',
        format: "dd/mm/yyyy",
        startDate: nextDay,
        container: '#TravelDate-container',
        orientation: 'bottom auto'
      }).on('changeDate', function() {
        console.log('[Mock] TravelDate changed:', $(this).val());
        $('#datepicker').val('');
        
        if ($('#TravelDate').val()) {
          $("#apDate").show();
        } else {
          $("#apDate").hide();
        }
        
        // In MOCK portal, no date range restrictions - all dates in dateDisabled are available
        console.log('[Mock] TravelDate set, showing appointment date section');
      });

      // ===== #AppointmentTabID change - trigger date fetch =====
      $('#AppointmentTabID').change(function() {
        showLoading();
        var id = $('#AppointmentTabID').val();
        console.log('[Mock] AppointmentTabID changed:', id);

        // Simulate AJAX delay
        setTimeout(function() {
          window.dateDisabled = dateDisabled; // Use pre-configured dates
          hideLoading();
          console.log('[Mock] Available dates loaded:', dateDisabled.length, 'dates');
        }, 500);
      });

      // #datepicker change
      $("#datepicker").on('change', function() {
        if ($("#datepicker").val()) {
          $("#AppTime").show();
        } else {
          $("#AppTime").hide();
        }
      });

      // ===== #NationalityTabID - field visibility =====
      $('#NationalityTabID').on('change', function() {
        var val = $(this).val();
        if (val === 'TÜRKİYE') {
          $('#tcKimlikNo, #retcKimlikNo').show();
        } else if (val && val !== 'null') {
          $('#tcKimlikNo, #retcKimlikNo').hide();
        }
      });

      // Initial trigger after 500ms
      setTimeout(function() {
        if ($('#AppointmentTabID').length > 0) {
          $('#AppointmentTabID').trigger('change');
        }
      }, 500);
    });

    // ===== FORM SUBMISSION =====
    $(document).ready(function() {
      pageLoadTime = new Date().getTime();
      $('#formStartTime').val(pageLoadTime);

      $('#apForm').submit(function(e) {
        e.preventDefault();

        // Validate security code
        var enteredCode = $('input[name=enteredCode]').val();
        if (enteredCode !== expectedSecurityCode) {
          Swal.fire({ title: 'Hata!', text: 'Güvenlik kodu hatalı!', icon: 'error', background: '#1d2657', color: '#f15a29' });
          return;
        }

        // Validate emails match
        if ($('input[name=Email]').val() !== $('input[name=reEmail]').val()) {
          Swal.fire({ title: 'Hata!', text: 'E-posta adresleri eşleşmiyor!', icon: 'error', background: '#1d2657', color: '#f15a29' });
          return;
        }

        // Validate TC Kimlik match if visible
        if ($('#tcKimlikNo').is(':visible') && $('input[name=TcKimlikNo]').val()) {
          if ($('input[name=TcKimlikNo]').val() !== $('input[name=reTCKN]').val()) {
            Swal.fire({ title: 'Hata!', text: 'T.C. Kimlik numaraları eşleşmiyor!', icon: 'error', background: '#1d2657', color: '#f15a29' });
            return;
          }
        }

        ${
          !skipBotDetection
            ? `
        var elapsedTime = (new Date().getTime() - pageLoadTime) / 1000;
        if (elapsedTime < 40) {
          Swal.fire({ icon: 'warning', title: 'Şüpheli İşlem', text: 'İşleminiz çok hızlı yapıldığı için sistemimiz sizi bot olarak algıladı.', background: '#1d2657', color: '#f15a29' });
          return;
        }
        `
            : ''
        }

        var $btn = $(this).find('[type="submit"]');
        $btn.prop('disabled', true);
        showSpinner();

        Swal.fire({
          title: 'UYARI!',
          text: 'Randevu başvurusu yapmak istediğinize emin misiniz?',
          icon: 'warning',
          background: '#1d2657',
          color: '#f15a29',
          showCancelButton: true,
          confirmButtonText: 'Evet',
          cancelButtonText: 'Hayır'
        }).then(function(result) {
          if (result.isConfirmed) {
            document.getElementById('apForm').submit();
          } else {
            hideSpinner();
            $btn.prop('disabled', false);
          }
        });
      });
    });

    // ===== PAGE INIT =====
    document.addEventListener('DOMContentLoaded', function() {
      ${
        skipInfoPopup
          ? `
      setTimeout(function() {
        document.getElementById('preloader').style.display = 'none';
        document.getElementById('initialLoader').style.display = 'none';
        document.getElementById('formWrapper').style.display = 'block';
        startCountdown();
      }, 500);
      `
          : `
      // Show popup first, then form
      setTimeout(function() {
        document.getElementById('preloader').style.display = 'none';
        document.getElementById('initialLoader').style.display = 'none';
        document.getElementById('formWrapper').style.display = 'block';
        startCountdown();
      }, 3000);
      `
      }

      // Block copy/paste
      ['reEmail', 'reTCKN'].forEach(function(name) {
        var input = document.getElementsByName(name)[0];
        if (input) {
          input.addEventListener('copy', function(e) { e.preventDefault(); });
          input.addEventListener('paste', function(e) { e.preventDefault(); });
        }
      });
    });

    console.log('[Mock Portal] AS-Visa Page 1 loaded');
    console.log('[Mock Portal] dateDisabled:', dateDisabled);
    console.log('[Mock Portal] availableTimes:', availableTimes);
  </script>
  <!-- Mimic AS-Visa script path -->
  <script type="text/javascript" src="/WebSite/assets/js/main.js"></script>
</body>
</html>`;
}

function generateToken(): string {
  return 'CfDJ8' + Array.from({ length: 80 }, () => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 62)]).join('');
}

function generateSecurityCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}
