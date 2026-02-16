function checkAlreadyHaveAppointment(fdata, callback) {
    $.ajax({
        url: '/tr/randevu-kontrol',
        processData: false,
        contentType: false,
        type: 'POST',
        data: fdata,
        success: (response) => {
            // hali hazirda bir randevu yok randevuyu al
            console.log('onceden alinmis randevu yok')
            callback(fdata)
        },
        error: (response) => {
            // randevu zaten var
            console.log('onceden alinmis randevu var')
            Swal.fire({
                title: 'Hata!',
                text: response.responseJSON.errorMessage,
                icon: 'error',
                confirmButtonText: 'Tamam',
            })
        }
    })
}

function showLoading() {
	$('.appointment-form-wrapper').hide()
	$('.custom-loader-wrap').show()
}

function hideLoading() {
	$('.custom-loader-wrap').hide()
	$('.appointment-form-wrapper').show()
}

function showAppTimeLoading() {
	$('#AppTimeSelectForm').hide()
	$('.app-time-loader-wrap').show()
}

function hideAppTimeLoading() {
	$('.app-time-loader-wrap').hide()
	$('#AppTimeSelectForm').show()
}

function showSpinner() {
	$('.lds-ring').show();
}

function hideSpinner() {
	$('.lds-ring').hide();
}

document.addEventListener("DOMContentLoaded", function () {

    function showInfoBox() {
        // Karartma (overlay) ekle
        const overlay = document.createElement('div');
        overlay.setAttribute('id', 'overlay');
        overlay.style.position = 'fixed';
        overlay.style.top = '0';
        overlay.style.left = '0';
        overlay.style.width = '100%';
        overlay.style.height = '100%';
        overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
        overlay.style.zIndex = '9998';
        document.body.appendChild(overlay);

        // Pop-up içerigi
        const infoBox = document.createElement('div');
        infoBox.innerHTML = `
            <div style="
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                background-color: #1d2657;
                color: #ffffff;
                padding: 20px;
                border-radius: 10px;
                box-shadow: 0 0 20px rgba(0,0,0,0.5);
                width: 90%;
                max-width: 600px;
                /* Aşağıdaki 2 satır sayesinde her zaman scroll bar olur (içerik taşarsa) */
                max-height: 80%;
                overflow-y: auto;
                
                font-family: Arial, sans-serif;
                z-index: 9999;
                text-align: left;
                box-sizing: border-box;
            ">
                <h2 style="color: #ff6600; text-align: center; font-size: 1.5em;">Önemli Bilgilendirme</h2>
                <p style="color: #ff8c00; font-size: 1.2em;">Randevu isleminizle ilgili önemli güncellemeler:</p>
                <ul style="color: #ffffff; font-size: 1em; padding-left: 20px;">
                    <li style="color:#fff">
                        <strong style="color:darkorange">Randevu Alma Süreci:</strong><br>
                        Randevularınızı yalnızca masaüstü veya dizüstü bilgisayarlarınız üzerinden oluşturabileceğinizi bildiririz. Telefon ve tablet cihazlarından randevu alma işlemi, bot saldırıları nedeniyle geçici olarak kaldırılmıştır. Bu sebeple, randevu almak için cihazınızı değiştirme imkânınız var ise, bunu yapmanızı rica ederiz.
                    </li>
                    <li style="color:#fff">
                        <strong style="color:darkorange">Randevu Alma Süreci:</strong><br>
                        Dipnot: Web sitemizde, sağ tıklayıp "Sayfa Kaynağını Görüntüle" işlemini gerçekleştirmeniz durumunda da aynı hatayı almanız olasıdır. Bu işlemi yaptıysanız, sistemimiz tarafından IP adresiniz 15 dakika süreyle izinsiz işlem tespiti nedeniyle geçici olarak engellenmiş olacaktır.
                    </li>
                    <li style="color:#fff">
                        <strong style="color:darkorange">Randevu Onay Süreci:</strong><br>
                        Randevu onay kagidiniz görüntülenene kadar lütfen bu sayfada kaliniz. Onay kagidi ekrana geldiginde, sag alt kisimda “Yazdir”, “Mail Gönder” ve “Anasayfa” olmak üzere üç buton yer alacaktir. Randevu bilgileriniz artik otomatik olarak e-posta adresinize gönderilmemekte olup, yalnizca talep etmeniz hâlinde sistem tarafindan “Mail Gönder” seçenegi üzerinden iletilecektir. Randevu bilgilerinin kaybolmasi veya erisilememesi durumunda firmamizin sorumluluk kabul etmedigini önemle hatirlatir, bu nedenle gerekli takibi yapma yükümlülügünün tarafiniza ait oldugunu bildiririz.
                    </li>
                    <li style="color:#fff">
                        <strong style="color:darkorange;">Randevu Aldiktan Sonra:</strong><br/>
                        Sayin yetkili, randevu aldiginizda randevu kagidi önünüze gelmemesi durumunda sayfamizda bulunan 
                        <strong style="color:darkorange">Randevu Kayit Sorgula</strong> menüsüne tiklayarak açilan sayfada 
                        Pasaport Numaraniz ve Vatandaslik Numaranizi girerek kagidiniza ulasabilirsiniz.
                    </li>
                    <li style="color:#fff">
                        <strong style="color:darkorange">Ad/Soyad Yazim Kurallari:</strong><br>
                        Formda yer alan “Adiniz Soyadiniz” alanina, isminizin ve soyisminizin ilk harflerini büyük, geri kalan harflerini küçük olacak sekilde yaziniz 
                        (Örnek: “Atilla Yıldızoğlu”).
                    </li>
                    <li style="color:#fff">
                        <strong style="color:darkorange">SSL Sertifikasi Kaynakli Erisim Sorunlari:</strong><br>
                        Sitemize SSL sertifikasi kaynakli bir erisim sorunu yasamaniz hâlinde, 
                        lütfen <strong style="color:darkorange">teknik@as-visa.com</strong> adresine e-posta göndererek destek talebinde bulununuz.
                    </li>
                    <li style="color:#fff">
                        <strong style="color:darkorange">Randevu Iptalleri:</strong><br>
                        Iptal ettiginiz randevulara iliskin olarak, sistem IP adresiniz ve kullandiginiz cihaz bilgilerini tespit edebilmektedir. 
                        Bu nedenle iptal edilen randevulariniz yok sayilacak olup, firmamizin bu konuda herhangi bir sorumlulugu bulunmamaktadir.
                    </li>
                    <!-- 45 saniyelik geri sayimi gösterecek alan: -->
                    <li style="color: #ffffff; margin-top: 10px;">
                        Pop-up kapanmasina kalan süre: <span id="popupTimer" style="font-weight:bold;color:#ff6600;">3</span> saniye
                    </li>
                </ul>
                <p style="color: #ff8c00; text-align: center; font-size: 1.1em;">Iyi günler dileriz,</p>
                <p style="text-align: center;"><strong style="color: #ff6600; font-size: 1.3em;">As-Visa Solutions Destek Ekibi</strong></p>
            </div>
        `;

        document.body.appendChild(infoBox);

        // 45 saniyelik geri sayim
        let timeLeft = 3;
        const popupTimerEl = infoBox.querySelector('#popupTimer');

        const intervalId = setInterval(() => {
            timeLeft--;
            if (popupTimerEl) {
                popupTimerEl.textContent = timeLeft.toString();
            }

            if (timeLeft <= 0) {
                clearInterval(intervalId);
                document.body.removeChild(infoBox);
                document.body.removeChild(overlay);
                startCountdown(); // 9 dakika sayaç
                startSuspiciousCheck(); // 👈 Burayı EKLE
            }
        }, 1000);
    }

    function startCountdown() {
        const timeLimit = 9 * 60;  // 9 dakika
        let remainingTime = timeLimit;

        const countdownElement = document.getElementById('timer');

        const countdownInterval = setInterval(() => {
            remainingTime--;

            const minutes = Math.floor(remainingTime / 60);
            const seconds = remainingTime % 60;

            countdownElement.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

            if (remainingTime <= 0) {
                clearInterval(countdownInterval);
                Swal.fire({
                    icon: 'warning',
                    title: 'Süre Doldu!',
                    text: 'Belirtilen süre içinde isleminizi tamamlamadiginiz için randevu alma ekranina yönlendiriliyorsunuz.',
                    background: '#1d2657',
                    color: '#fff',
                    timer: 5000,
                    showConfirmButton: false,
                    allowOutsideClick: false,
                    allowEscapeKey: false,
                    allowEnterKey: false,
                    willClose: () => {
                        window.location.href = window.location.href;
                    }
                });
            }
        }, 1000);

        window.addEventListener('beforeunload', () => {
            clearInterval(countdownInterval);
        });

        return countdownInterval;
    }

    function startSuspiciousCheck() {
        let userHasMovedMouse = false;

        document.addEventListener("mousemove", function () {
            userHasMovedMouse = true;
        });

        function isFormFilled() {
            const inputs = document.querySelectorAll("#apForm input, #apForm select");
            let filledCount = 0;
            for (const input of inputs) {
                if (input.type !== "hidden" && input.value.trim().length > 0) {
                    filledCount++;
                }
            }
            return filledCount >= 3;
        }

        setTimeout(() => {
            const suspiciousInterval = setInterval(() => {
                const formFilled = isFormFilled();

                if (!userHasMovedMouse && formFilled) {
                    clearInterval(suspiciousInterval);

                    Swal.fire({
                        icon: 'warning',
                        title: 'Şüpheli İşlem Tespit Edildi',
                        html: `Sistemimiz olağan dışı bir etkileşim algıladı. Güvenlik politikalarımız gereği işlem sonlandırılmıştır.`,
                        confirmButtonText: 'Tamam',
                        background: '#1d2657',
                        color: '#f15a29',
                        allowOutsideClick: false,
                        allowEscapeKey: false,
                        allowEnterKey: false
                    }).then(() => {
                        window.location.href = 'https://www.google.com';
                    });
                }
            }, 2000);
        }, 10000);
    }




    function checkForNewVersion() {
        fetch(window.location.href, { cache: "no-store" })
            .then(response => response.text())
            .then(content => {
                const parser = new DOMParser();
                const doc = parser.parseFromString(content, "text/html");
                const newVersionMeta = doc.querySelector("meta[name='version']");
                const currentVersionMeta = document.querySelector("meta[name='version']");

                const newVersion = newVersionMeta ? newVersionMeta.getAttribute("content") : null;
                const currentVersion = currentVersionMeta ? currentVersionMeta.getAttribute("content") : null;

                if (newVersion && currentVersion && newVersion !== currentVersion) {
                    console.log("Yeni sürüm algilandi, sayfa yenileniyor...");
                    window.location.reload(true);
                }
            })
            .catch(error => console.error("Sürüm kontrolü yapilamadi:", error));
    }

    // Sürekli yeni sürüm kontrolü (1 dk arayla)
    setInterval(checkForNewVersion, 60000);

    // Sayfa açilir açilmaz pop-up göster
    showInfoBox();

    // F12, Ctrl+Shift+I/J, Ctrl+U engelleme
    window.addEventListener('keydown', function (e) {
        if (
            e.key === 'F12' ||
            (e.ctrlKey && e.shiftKey && (e.key === 'I' || e.key === 'J')) ||
            (e.ctrlKey && e.key === 'U')
        ) {
            e.preventDefault();
        }
    });
});

//$("#datepicker").datepicker({
//    format: 'dd/mm/yyyy'
//})



function tarihGetir() {
    showAppTimeLoading()
    var id = $('#datepicker').val();
    $.ajax({
        url: '/AnBir/Macaristan/SaatGetir',
        data: { dateTab: id },
        type: 'Post',
        dataType: 'Json',
        success: function (data) {
            console.log(data);
            $('#AppointmentTime').empty();
            for (var i = 0; i < data.length; i++) {
                $('#AppointmentTime').append("<option value'" + data[i].value + "'>" + data[i].text + "</option>");
            }
            hideAppTimeLoading()
        },
        error: () => hideAppTimeLoading()
    });
}

var dateDisabled = [];
$('#AppointmentTabID').change(function () {
    showLoading()
    var id = $('#AppointmentTabID').val();
    var cid = $('#NationalityTabID').val();
    var token = $('input[name="__RequestVerificationToken"]').val();
    $.ajax({
        url: '/AnBir/Macaristan/TarihGetir',
        data: { tabId: id, countryid: cid },
        headers: {
            'RequestVerificationToken': token
        },
        type: 'Post',
        dataType: 'json',
        success: function (data) {
            hideLoading();
            window.dateDisabled = data;
        },
        error: function (xhr) {
            hideLoading();
            if (xhr.status === 403) {
                alert('Güvenlik doğrulaması başarısız. Lütfen sayfayı yenileyin.');
            } else {
                alert('Tarih bilgileri alınamadı. Lütfen tekrar deneyin.');
            }
        }
    })
})

$(function () {
    var date = new Date(), y = date.getFullYear(), m = date.getMonth();
    var firstDay = new Date(y, m, 1);
    var lastDay = new Date(y, m + 12, 0);
    console.log("last day =", lastDay)

    $('body').on('click', '.day.disabled', function (e) {
        toastr.error('Seçim yapmak istediğiniz tarihi size veremiyoruz. Açık olan tarihlerde seçiminizi gerçekleştiriniz.')
    });

    if ($('#TravelDate').val()) {
        $("#apDate").show();
    }
    else {
        $("#apDate").hide();
    }

    $('select[name=TravelSubject]').change(() => {
        const value = $('select[name=TravelSubject]').val();
        if (value === 'İş (Ticari)') {
            $('#datepicker').datepicker("setEndDate", lastDay);
        }
        else {
            const travelDate = new Date($('#TravelDate').datepicker('getDate'));
            const copyTravelDate1 = new Date(travelDate);
            const copyTravelDate2 = new Date(travelDate);
            const startDate = new Date(copyTravelDate1.setDate(travelDate.getDate() - 45))
            const endDate = new Date(copyTravelDate2.setDate(travelDate.getDate() - 15))
            $('#datepicker').datepicker("setStartDate", startDate);
            $('#datepicker').datepicker("setEndDate", endDate);
        }
    })

    $("#datepicker").datepicker({
        weekStart: 1,
        autoclose: true,
        todayHighlight: true,
        format: "dd/mm/yyyy",
        startDate: firstDay,
        endDate: lastDay,
        language: 'tr',
        beforeShowDay: function (date) {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const current = new Date(date.getFullYear(), date.getMonth(), date.getDate());
            const formatted = date.getFullYear() + '-' + (date.getMonth() + 1) + '-' + date.getDate();

            if (current < today) {
                return { enabled: false, classes: 'disabled past-date red-bg white-text' };
            }

            if (current.getTime() === today.getTime()) {
                return { enabled: false, classes: 'disabled today-date red-bg white-text' };
            }

            if ($.inArray(formatted, dateDisabled) !== -1) {
                return { enabled: true, classes: 'orange-bg blue-text' };
            }

            return { enabled: false, classes: 'disabled red-bg white-text' };
        },
    }).on('changeDate', function () {
        tarihGetir();
    });

    var nextmonth = new Date()
    $("#TravelDate").datepicker({
        weekStart: 1,
        autoclose: true,
        todayHighlight: true,
        language: 'tr',
        format: "dd/mm/yyyy",
        startDate: new Date(nextmonth.setDate(nextmonth.getDate() + 1)),
    }).on('changeDate', function () {
        console.log('date changed')
        $('#datepicker').val('')
        if ($('#TravelDate').val()) {
            $("#apDate").show();
        }
        else {
            $("#apDate").hide();
        }

        const value = $('select[name=TravelSubject]').val();
        if (value !== 'İş (Ticari)') {
            const travelDate = new Date($('#TravelDate').datepicker('getDate'));
            const copyTravelDate1 = new Date(travelDate);
            const copyTravelDate2 = new Date(travelDate);
            const startDate = new Date(copyTravelDate1.setDate(travelDate.getDate() - 45))
            const endDate = new Date(copyTravelDate2.setDate(travelDate.getDate() - 15))
            $('#datepicker').datepicker("setStartDate", startDate);
            $('#datepicker').datepicker("setEndDate", endDate);
        }
        else {
            $('#datepicker').datepicker("setEndDate", lastDay);
        }
    });

    setTimeout(() => {
        if ($('#AppointmentTabID').length > 0) {
            $('#AppointmentTabID').trigger('change');
        }
    }, 500);
})

/*
Birincisi  Gidiş Tarihi Var olan tarih Bugün 26.09.2023 bundan 15 gün sonrasına atıcaksın bu tarihi
Gidiş Tarihi En Erken Var olan günün 15 gün sonrasında olacak
ikinciside Gidiş Tarihine En Geç 15 Gün Kalaya kadar göstericez

30.10.2023 // Gidiş Tarihi
Başvuru Tarihi // 15 in üzerinde başvuru yapamasın. 16 10.2023 Bu adam başvuru yapamayacak.
Müsait olmayan tarihe tıklandığında Hata Mesajı Yazdır.
*/


/*
Birincisi  Gidiş Tarihi Var olan tarih Bugün 26.09.2023 bundan 15 gün sonrasına atıcaksın bu tarihi
Gidiş Tarihi En Erken Var olan günün 15 gün sonrasında olacak
ikinciside Gidiş Tarihine En Geç 15 Gün Kalaya kadar göstericez

30.10.2023 // Gidiş Tarihi
Başvuru Tarihi // 15 in üzerinde başvuru yapamasın. 16 10.2023 Bu adam başvuru yapamayacak.
Müsait olmayan tarihe tıklandığında Hata Mesajı Yazdır.
*/

$("#AppointmentTabID").on('change', function () {

    if ($("#AppointmentTabID").val() != null) {
        $("#datepicker").show();
        document.querySelector("#datepicker").style.display = "block"
    }
    else {
        $("#AppointmentTabID").hide();
        document.querySelector("#datepicker").style.display = "none"
    }
});

$("#datepicker").on('change', function () {

    if ($("#datepicker").val() != null) {
        $("#AppTime").show();
        document.querySelector("#AppTime").style.display = "block"
    }
    else {
        $("#AppTime").hide();
        document.querySelector("#AppTime").style.display = "none"
    }
});

$("#AppointmentTabID").on('change', function () {

    if ($("#AppointmentTabID").val() != null) {
        $("#datepicker").show();
        document.querySelector("#datepicker").style.display = "block"
    }
    else {
        $("#datepicker").hide();
        document.querySelector("#datepicker").style.display = "none"
    }
});

$("#NationalityTabID").on('change', function () {

    if ($("#NationalityTabID").val() == 'TÜRKİYE') {
        $("#tcKimlikNo").show();
        $("#retcKimlikNo").show();
        $("#dogumYili").show();
        $("#PassaportNo").show();
        $("#Adi").show();
        $("#Soyadi").show();
        $("#Telefon").show();
        $("#Eposta").show();
        $("#reEposta").show();
        document.querySelector("#tcKimlikNo").style.display = "block"
        document.querySelector("#retcKimlikNo").style.display = "block"
        document.querySelector("#dogumYili").style.display = "block"
        document.querySelector("#PassaportNo").style.display = "block"
        document.querySelector("#Adi").style.display = "block"
        document.querySelector("#Soyadi").style.display = "block"
        document.querySelector("#Telefon").style.display = "block"
        document.querySelector("#Eposta").style.display = "block"
        document.querySelector("#reEposta").style.display = "block"
    }
    else if ($("#NationalityTabID").val() != null) {
        $("#PassaportNo").show();
        $("#Adi").show();
        $("#dogumYili").show();
        $("#Soyadi").show();
        $("#Telefon").show();
        $("#Eposta").show();
        $("#tcKimlikNo").hide();
        $("#retcKimlikNo").hide();
        $("#reEposta").show();

        document.querySelector("#tcKimlikNo").style.display = "none"
        document.querySelector("#retcKimlikNo").style.display = "none"
        document.querySelector("#PassaportNo").style.display = "block"
        document.querySelector("#Adi").style.display = "block"
        document.querySelector("#dogumYili").style.display = "block"
        document.querySelector("#Soyadi").style.display = "block"
        document.querySelector("#Telefon").style.display = "block"
        document.querySelector("#Eposta").style.display = "block"
        document.querySelector("#reEposta").style.display = "block"
    }
    else {
        $("#tcKimlikNo").show();
        $("#retcKimlikNo").show();
        $("#PassaportNo").show();
        $("#Adi").show();
        $("#dogumYili").show();
        $("#Soyadi").show();
        $("#Telefon").show();
        $("#Eposta").show();
        $("#reEposta").show();

        document.querySelector("#tcKimlikNo").style.display = "block"
        document.querySelector("#retcKimlikNo").style.display = "block"
        document.querySelector("#PassaportNo").style.display = "block"
        document.querySelector("#Adi").style.display = "block"
        document.querySelector("#dogumYili").style.display = "block"
        document.querySelector("#Soyadi").style.display = "block"
        document.querySelector("#Telefon").style.display = "block"
        document.querySelector("#Eposta").style.display = "block"
        document.querySelector("#reEposta").style.display = "block"
    }
});

let pageLoadTime;

function onTurnstileSuccess(token) {
    $('#cfToken').val(token); // Cloudflare doğrulama token'ı inputa yaz
}

$(document).ready(function () {
    pageLoadTime = new Date().getTime();
    $('#formStartTime').val(pageLoadTime);

    $('#apForm').submit(function (e) {
        e.preventDefault();

        //const cfToken = $('#cfToken').val();
        //if (!cfToken) {
        //    Swal.fire({
        //        title: 'Doğrulama Eksik',
        //        text: 'Lütfen güvenlik doğrulamasını (reCAPTCHA) tamamlayınız.',
        //        icon: 'error'
        //    });
        //    return;
        //}

        const $submitButton = $(this).find('[type="submit"]');
        $submitButton.prop('disabled', true).css('visibility', 'hidden');

        showSpinner();

        const travelSubject = $('select[name=TravelSubject]').val();
        if (travelSubject === 'İş (Ticari)' && fifteenDaysBetweenDates()) {
            showWarning("Başvurunuz ile seyahatiniz arasında 15 günden az olduğu için başvuru esnasında konsolosluk onay verirse kabul edilecektir.", true);
        } else {
            showWarning("Randevu başvurusu yapmak istediğinize emin misiniz?", false);
        }
    });
});

function fifteenDaysBetweenDates() {
    const travelDate = $('#TravelDate').datepicker('getDate');
    const appointmentDate = $('#datepicker').datepicker('getDate');

    if (!travelDate || !appointmentDate) return false;

    const diffTime = travelDate.getTime() - appointmentDate.getTime();
    const diffDays = diffTime / (1000 * 3600 * 24);
    return diffDays <= 18;
}

function showWarning(message, isShortGap) {
    Swal.fire({
        title: 'UYARI!',
        text: message,
        icon: 'warning',
        background: '#1d2657',
        color: '#f15a29',
        showCancelButton: true,
        confirmButtonColor: '#3085d6',
        cancelButtonColor: '#d33',
        confirmButtonText: 'Evet',
        allowOutsideClick: false,
        allowEscapeKey: false,
        allowEnterKey: false
    }).then((result) => {
        if (result.isConfirmed) {
            createRequest(isShortGap);
        } else {
            hideSpinner();
            $('#apForm').find('[type="submit"]').prop('disabled', false).css('visibility', 'visible');
        }
    });
}

function createRequest(lessThanFifteenDays) {
    const currentTime = new Date().getTime();
    const elapsedTime = (currentTime - pageLoadTime) / 1000;

    if (elapsedTime < 40) {
        hideSpinner();
        Swal.fire({
            icon: 'warning',
            title: 'Şüpheli İşlem',
            text: 'İşleminiz çok hızlı yapıldığı için sistemimiz sizi bot olarak algıladı.',
            confirmButtonText: 'Tamam',
            background: '#1d2657',
            color: '#f15a29'
        }).then(() => {
            window.location.href = "https://www.google.com";
        });
        return;
    }

    const fdata = new FormData();
    fdata.append('Nationality', $('select[name=Nationality]').val());
    fdata.append('Appointment', $('select[name=Appointment]').val());
    fdata.append('TravelDate', $('input[name=TravelDate]').val());
    fdata.append('TravelSubject', $('select[name=TravelSubject]').val());
    fdata.append('AppointmentDate', $('input[name=AppointmentDate]').val());
    fdata.append('AppointmentTime', $('select[name=AppointmentTime]').val());
    fdata.append('TcKimlikNo', $('input[name=TcKimlikNo]').val());
    fdata.append('reTCKN', $('input[name=reTCKN]').val());
    fdata.append('PassaportNumber', $('input[name=PassaportNumber]').val());
    fdata.append('Name', $('input[name=Name]').val());
    fdata.append('Surname', $('input[name=Surname]').val());
    fdata.append('Phone', $('input[name=Phone]').val());
    fdata.append('Email', $('input[name=Email]').val());
    fdata.append('reEmail', $('input[name=reEmail]').val());
    fdata.append('DogumYili', $('input[name=DogumYili]').val());
    fdata.append('enteredCode', $('input[name=enteredCode]').val());
    fdata.append('verificationCodeServer', $('input[name=verificationCodeServer]').val());
    fdata.append('__RequestVerificationToken', $('input[name=__RequestVerificationToken]').val());
    fdata.append('formStartTime', $('input[name=formStartTime]').val());
    fdata.append('cfToken', $('#cfToken').val());
    fdata.append('lessThan15Days', lessThanFifteenDays);

    sendRequest(fdata);
}

function sendRequest(fdata) {
    const $submitButton = $('#apForm').find('[type="submit"]');

    $.ajax({
        url: '/tr/ankara-bireysel-basvuru',
        type: 'POST',
        processData: false,
        contentType: false,
        data: fdata,
        success: (response) => {
            hideSpinner();
            Swal.fire({
                title: 'Başarılı!',
                text: 'Randevu işleminizde son adım kalmıştır. Açılan Sayfadaki Talimatları yerine getirmeyi unutmayın.',
                icon: 'success',
                background: '#1d2657',
                color: '#f15a29',
                confirmButtonText: 'Tamam',
                allowOutsideClick: false,
                allowEscapeKey: false,
                allowEnterKey: false
            }).then(() => {
                window.location.href = response.url;
            });
        },
        error: (response) => {
            hideSpinner();
            Swal.fire({
                title: 'Hata!',
                text: response.responseJSON?.errorMessage || 'Bilinmeyen bir hata oluştu.',
                icon: 'error',
                background: '#1d2657',
                color: '#f15a29',
                confirmButtonText: 'Tamam',
                allowOutsideClick: false,
                allowEscapeKey: false,
                allowEnterKey: false
            });
            $submitButton.prop('disabled', false).css('visibility', 'visible');
        }
    });
}

function showSpinner() {
    $('#loader').show();
}

function hideSpinner() {
    $('#loader').hide();
}


#customKeyboard {
    position: fixed;
    bottom: 10px;
    left: 50%;
    transform: translateX(-50%);
    width: 90%;
    max-width: 600px;
    background: #1d2657;
    border: 1px solid #ccc;
    border-radius: 10px;
    box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
    padding: 10px;
    display: none;
    flex-direction: column;
    gap: 10px;
}

.keyboard-keys {
    display: flex;
    flex-direction: column;
    gap: 5px;
}

.keyboard-row {
    display: flex;
    justify-content: center;
    gap: 5px;
}

.keyboard-key {
    flex: 1;
    padding: 10px;
    font-size: 16px;
    text-align: center;
    background: #f15a29;
    border: none;
    color: #fff;
    border-radius: 5px;
    cursor: pointer;
    max-width: 40px;
}

    .keyboard-key:active {
        background: #f15a29;
    }

.controls-row {
    justify-content: center;
}
