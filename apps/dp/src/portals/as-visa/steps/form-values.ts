/**
 * Maps customer preferences (Visa Information + portal-specific) to AS-VISA form field values.
 * Keys match AS_VISA_SELECTORS.inputs and AS_VISA_SELECTORS.selects so fill-form can iterate and fill.
 *
 * Customer form stores: idNo, passportNumber, name, surname, middleName, birthDate, email, phone,
 * travelDateMode, travelDateAlgorithm, travelDateSingle, travelDateFrom, travelDateTo,
 * plus portal-specific keys: nationality, appointment, travelSubject, travelDate, appointmentDate, appointmentTime.
 */
export function buildAsVisaFormValues(applicantData: Record<string, unknown>): Record<string, string> {
  const get = (key: string): string => {
    const v = applicantData[key];
    if (v === undefined || v === null) return '';
    return String(v).trim();
  };

  const birthDate = get('birthDate');
  const yearFromBirthDate = birthDate ? birthDate.slice(0, 4) : '';

  return {
    // Visa Information (generic) → selector keys
    name: get('name'),
    surname: get('surname'),
    passportNumber: get('passportNumber'),
    tcKimlikNo: get('idNo') || get('tcKimlikNo'),
    dogumYili: yearFromBirthDate || get('dogumYili'),
    phone: get('phone'),
    email: get('email'),

    // Portal-specific (schema keys align with selectors)
    nationality: get('nationality'),
    appointment: get('appointment'),
    travelSubject: get('travelSubject'),
    travelDate: get('travelDate') || get('travelDateSingle') || get('travelDateFrom') || '',
    appointmentDate: get('appointmentDate'),
    appointmentTime: get('appointmentTime'),
  };
}
