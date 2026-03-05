2) Staff sekmesinde kullanıcılara şifre giriliyor mu? sadece super admin editleyebilmeyi şifreyi dediğin gibi. Mantık şu olmalı:
Staff listesine yeni bir kullanıcı eklendiğinde, girilen maile bir e posta atılacak ve bu postaya tıklandığında biizm portalda bir register tarzında şifre girme (şifre gir ve şifre gir tekrar) tarzında bir portala yönlendirip ondan sonra kayıt gerçekleşecek tamamen. Bu adımı yapmayan kişi staff listesinde pending olarak duracak. Ne zaman şifresi kayıt olursa database'e (encrypted olarak, ve tabi ki şifre check ederken dycrpyt edileiblmesi bilmiyorum en düzgün şekilde sen yap) pendingden çıkıp normal şekilde listede durabilir bence. Mantık iyi mi? BELKİ SEN DAHA İYİ RAFİNE EDEBİLİRİSN.

3) Staff sekmesinde suspend gerçekten girişi engelliyor mu? giriş ypamaya çalışan kişi this account suspended almalı. Contact administrator to get help. falan yazsın.

5) Portals sekmeisnde portallar listeleniyor, bu listelenme kısmında portallarda rate limit enabled disabled, OTP ve CAPTHA modları yazabilir. ayrıca rengini eski haline çevirelim. url gözüken kısım kalsın beğendim.

2) Drainingi check et

3) Şifre kısmı sadece super_admin tarafından editlenebilmeli ve görüntülenebilmeli, diğerleri redacted **** olarak görmeli. super adminde göz işareti olsun tıkalyınca göreiblsin.

3) Mouse hareket etmeli birkaç kere CHECK mock server log

4) min 40 saniye kuralı var, 40.1 CHECK

6) snapshot history temizleyince archived da temizleniyor

5) booking için redirection page url bak (headless olarak sayfa 2 test)

8) Problem net: canUseTelegramActionButtons HTTPS + non-localhost zorunluluğu koyuyor çünkü Telegram inline button URL'leri bu kısıtlamayı enforce ediyor. Dev ortamında notify_action_base_url ya set edilmemiş ya da http://localhost:... gibi bir değer.

Bu kısıtlamayı kaldırmak mümkün değil — Telegram Bot API gerçekten HTTPS non-localhost URL'den başka kabul etmiyor inline keyboard button için. Dolayısıyla dev'de butonlar göremezsin, bu beklenen bir davranış.

Telegram Bot API hakikaten HTTPS non-localhost URL zorunlu tutuyor butonlar için — bu kısıtlama API tarafında. Dev ortamında butonlar çalışmaz, bu normal.