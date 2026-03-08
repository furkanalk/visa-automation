6) snapshot history temizleyince archived da temizleniyor

5) booking için redirection page url bak (headless olarak sayfa 2 test)

8) Problem net: canUseTelegramActionButtons HTTPS + non-localhost zorunluluğu koyuyor çünkü Telegram inline button URL'leri bu kısıtlamayı enforce ediyor. Dev ortamında notify_action_base_url ya set edilmemiş ya da http://localhost:... gibi bir değer.

Bu kısıtlamayı kaldırmak mümkün değil — Telegram Bot API gerçekten HTTPS non-localhost URL'den başka kabul etmiyor inline keyboard button için. Dolayısıyla dev'de butonlar göremezsin, bu beklenen bir davranış.

Telegram Bot API hakikaten HTTPS non-localhost URL zorunlu tutuyor butonlar için — bu kısıtlama API tarafında. Dev ortamında butonlar çalışmaz, bu normal.