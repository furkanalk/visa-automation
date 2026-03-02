/**
 * AS-VISA Make Appointment page selectors (Ankara Individual / appointment form).
 * Aligned with mock and live site; .bin/as-visa.html and as-visa.js used as reference.
 *
 * Form: #apForm
 * Important id/name: NationalityTabID, AppointmentTabID, TravelSubject, TravelDate, datepicker,
 * AppointmentTime, PassaportNumber, Name, Surname, TcKimlikNo, reTCKN, DogumYili, Phone, Email, reEmail, enteredCode.
 */

export const AS_VISA_SELECTORS = {
  form: '#apForm',

  submit: '#apForm button[type="submit"]',

  loaders: {
    pageRing: '.lds-ring',
    customLoaderWrap: '.custom-loader-wrap',
    appointmentWrapper: '.appointment-form-wrapper',
  },

  selects: {
    nationality: '#NationalityTabID',
    appointment: '#AppointmentTabID',
    travelSubject: '#TravelSubject',
    appointmentTime: '#AppointmentTime',
  },

  inputs: {
    travelDate: '#TravelDate',
    appointmentDate: '#datepicker',
    cfToken: '#cfToken',
    formStartTime: '#formStartTime',
    requestVerificationToken: 'input[name="__RequestVerificationToken"]',

    passportNumber: 'input[name="PassaportNumber"]',
    name: 'input[name="Name"]',
    surname: 'input[name="Surname"]',
    tcKimlikNo: 'input[name="TcKimlikNo"]',
    reTckn: 'input[name="reTCKN"]',
    dogumYili: 'input[name="DogumYili"]',
    phone: 'input[name="Phone"]',
    email: 'input[name="Email"]',
    reEmail: 'input[name="reEmail"]',
    enteredCode: 'input[name="enteredCode"]',
  },

  sections: {
    appTime: '#AppTime',
    apDate: '#apDate',
  },

  security: {
    turnstile: '.cf-turnstile',
  },

  /** Confirmation page after booking (mock: #confirmationNumber or [data-confirmation]; live site may vary) */
  confirmation: {
    number: '[data-confirmation], #confirmationNumber, .confirmation-number',
  },

  /** SweetAlert2 confirm button when form submit shows "Randevu başvurusu yapmak istediğinize emin misiniz?" */
  swalConfirm: '.swal2-confirm',

  /** jQuery UI datepicker (widget-click fallback when #datepicker is readonly) */
  datepicker: {
    popup: '.ui-datepicker',
    /** Tüm tıklanabilir günler (diğer aylar dahil) */
    enabledDay: '.ui-datepicker td:not(.ui-datepicker-unselectable) a',
    /** Sadece bu ay (other-month yok; yanlış ay seçimini önler) */
    enabledDayCurrentMonth: '.ui-datepicker td:not(.ui-datepicker-unselectable):not(.ui-datepicker-other-month) a',
  },

  /** Bootstrap datepicker (mock portal uses bootstrap-datepicker 1.3.0, same as real site) */
  bootstrapDatepicker: {
    /** Popup wrapper — 1.3.0 uses .datepicker-dropdown, inner table div has .datepicker */
    popup: '.datepicker-dropdown',
    /** Enabled days (current + other months, not disabled) */
    enabledDay: '.datepicker td.day:not(.disabled)',
    /** Current month only (no old/new class) */
    enabledDayCurrentMonth: '.datepicker td.day:not(.disabled):not(.old):not(.new)',
  },
} as const;
