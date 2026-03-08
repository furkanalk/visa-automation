LOG_LEVEL ayarı	trace	debug	info	warn	error
trace	✅	✅	✅	✅	✅
debug	❌	✅	✅	✅	✅
info	❌	❌	✅	✅	✅
Yani LOG_LEVEL=debug ise debug + info + warn + error loglanır, trace loglanmaz.

Kural:

trace → polling döngüleri, her tick'te tekrar eden iç detaylar
debug → lifecycle adımları (start/stop/init/hydrate), state geçişleri, job assignment
info → iş açısından anlamlı olaylar (job başladı/bitti, slot bulundu, HITL tetiklendi, retry planlandı)
warn → beklenmedik ama kurtarılabilir durumlar
error → gerçek hatalar
agent-pool.ts


Ortam	Level	Ne görürsün
dev	debug	lifecycle + iş olayları (şu an bu)
test	info	sadece iş olayları
prod	info	sadece iş olayları