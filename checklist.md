2) sadece super admin editleyebilmeyi admin hesaplarını, adminler de staff hesaplarını. Admin - Admin hesap bilgisi değiştirme yok.
Şifre kısmı sadece super_admin tarafından editlenebilmeli ve görüntülenebilmeli, diğerleri redacted olarak görmeli. super adminde bu alanlar için göz işareti olsun tıkalyınca göreiblsin.

3) Staff sekmesinde suspend gerçekten girişi engelliyor mu? giriş ypamaya çalışan kişi this account suspended almalı. Contact administrator to get help. falan yazsın.

5) Portals sekmeisnde portallar listeleniyor, bu listelenme kısmında portallarda rate limit enabled disabled, OTP ve CAPTHA modları yazabilir. ayrıca rengini eski haline çevirelim. url gözüken kısım kalsın beğendim.

2) Drainingi check et

3) Mouse hareket etmeli birkaç kere CHECK mock server log

4) min 40 saniye kuralı var, 40.1 CHECK

6) snapshot history temizleyince archived da temizleniyor

5) booking için redirection page url bak (headless olarak sayfa 2 test)

8) Problem net: canUseTelegramActionButtons HTTPS + non-localhost zorunluluğu koyuyor çünkü Telegram inline button URL'leri bu kısıtlamayı enforce ediyor. Dev ortamında notify_action_base_url ya set edilmemiş ya da http://localhost:... gibi bir değer.

Bu kısıtlamayı kaldırmak mümkün değil — Telegram Bot API gerçekten HTTPS non-localhost URL'den başka kabul etmiyor inline keyboard button için. Dolayısıyla dev'de butonlar göremezsin, bu beklenen bir davranış.

Telegram Bot API hakikaten HTTPS non-localhost URL zorunlu tutuyor butonlar için — bu kısıtlama API tarafında. Dev ortamında butonlar çalışmaz, bu normal.