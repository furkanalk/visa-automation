# Selektör doğrulama

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
