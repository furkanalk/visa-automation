/**
 * AS-VISA Make Appointment sayfası selektörleri (Ankara Bireysel / randevu formu).
 * Mock / canlı site ile uyumlu; .bin/as-visa.html ve as-visa.js referans alındı.
 *
 * Form: #apForm
 * Önemli id/name: NationalityTabID, AppointmentTabID, TravelSubject, TravelDate, datepicker,
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
} as const;
