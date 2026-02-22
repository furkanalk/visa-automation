<!-- 1) Staff tabında, mail update'i super_admin olanlar yapabilmeli. Eğer izni yoksa No permission granted falan yazsın kırmızı bence.  -->

2) Staff sekmesinde kullanıcılara şifre giriliyor mu? sadece super admin editleyebilmeyi şifreyi dediğin gibi. Mantık şu olmalı:
Staff listesine yeni bir kullanıcı eklendiğinde, girilen maile bir e posta atılacak ve bu postaya tıklandığında biizm portalda bir register tarzında şifre girme (şifre gir ve şifre gir tekrar) tarzında bir portala yönlendirip ondan sonra kayıt gerçekleşecek tamamen. Bu adımı yapmayan kişi staff listesinde pending olarak duracak. Ne zaman şifresi kayıt olursa database'e (encrypted olarak, ve tabi ki şifre check ederken dycrpyt edileiblmesi bilmiyorum en düzgün şekilde sen yap) pendingden çıkıp normal şekilde listede durabilir bence. Mantık iyi mi? BELKİ EN DAHA İYİ RAFİNE EDEBİLİRİSN.

3) Staff sekmesinde suspend gerçekten girişi engelliyor mu? giriş ypamaya çalışan kişi this account suspended almalı. Contact administrator to get help. falan yazsın.

5) Portals sekmeisnde portallar listeleniyor, bu listelenme kısmında portallarda rate limit enabled disabled, OTP ve CAPTHA modları yazabilir. ayrıca rengini eski haline çevirelim. url gözüken kısım kalsın beğendim.

2) Drainingi check et

3) Şifre kısmı sadece super_admin tarafından editlenebilmeli ve görüntülenebilmeli, diğerleri redacted **** olarak görmeli. super adminde göz işareti olsun tıkalyınca göreiblsin.

staff listesinden birisi super_admin yapmaya açalışınca bunu alıyorum:
{"level":50,"time":1771192848492,"pid":29,"hostname":"ccdc0d57d42b","reqId":"req-1o","req":{"method":"PATCH","url":"/cp/staff/7c473eff-c961-4bd0-94cf-bc3124eadf8a","hostname":"localhost:3001","remoteAddress":"172.23.0.1","remotePort":47538},"res":{"statusCode":500},"err":{"type":"DatabaseError","message":"invalid input syntax for type json","stack":"error: invalid input syntax for type json\n    at /app/node_modules/pg/lib/client.js:588:17\n    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)\n    at async PostgresConnection.executeQuery (file:///app/node_modules/kysely/dist/esm/dialect/postgres/postgres-driver.js:72:28)\n    at async file:///app/node_modules/kysely/dist/esm/query-executor/query-executor-base.js:35:28\n    at async DefaultConnectionProvider.provideConnection (file:///app/node_modules/kysely/dist/esm/driver/default-connection-provider.js:10:20)\n    at async DefaultQueryExecutor.executeQuery (file:///app/node_modules/kysely/dist/esm/query-executor/query-executor-base.js:34:16)\n    at async UpdateQueryBuilder.execute (file:///app/node_modules/kysely/dist/esm/query-builder/update-query-builder.js:453:24)\n    at async UpdateQueryBuilder.executeTakeFirst (file:///app/node_modules/kysely/dist/esm/query-builder/update-query-builder.js:472:26)\n    at async Object.<anonymous> (/app/apps/cp/src/routes/staff.ts:265:19)\n    at PostgresConnection.executeQuery (file:///app/node_modules/kysely/dist/esm/dialect/postgres/postgres-driver.js:92:41)\n    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)\n    at async file:///app/node_modules/kysely/dist/esm/query-executor/query-executor-base.js:35:28\n    at async DefaultConnectionProvider.provideConnection (file:///app/node_modules/kysely/dist/esm/driver/default-connection-provider.js:10:20)\n    at async DefaultQueryExecutor.executeQuery (file:///app/node_modules/kysely/dist/esm/query-executor/query-executor-base.js:34:16)\n    at async UpdateQueryBuilder.execute (file:///app/node_modules/kysely/dist/esm/query-builder/update-query-builder.js:453:24)\n    at async UpdateQueryBuilder.executeTakeFirst (file:///app/node_modules/kysely/dist/esm/query-builder/update-query-builder.js:472:26)\n    at async Object.<anonymous> (/app/apps/cp/src/routes/staff.ts:265:19)","length":201,"name":"error","severity":"ERROR","code":"22P02","detail":"Expected \":\", but found \",\".","where":"JSON data, line 1: {\"captcha\",...\nunnamed portal parameter $3 = '...'","file":"jsonfuncs.c","line":"646","routine":"json_errsave_error"},"msg":"invalid input syntax for type json"}

super adminde o eski vezir görüebilir güzeldi

Email SMTP için domain alınmalı.

3) Mouse hareket etmeli birkaç kere CHECK mock server log

4) min 40 saniye kuralı var, 40.1 CHECK

5) Payments tab

6) Scout job'ları sadece "slot var mı?" kontrolü; asıl önemli olan slot bulununca oluşan müşteri job'ları. Job listesinde hepsinin görünmesi kafa karıştırıyor. Öneri: Job listesinde slot-check job'larını varsayılan olarak gizleyelim; isteğe bağlı "Slot-check job'larını göster" ile açılabilsin.
Varsayılan olarak slot-check job'larını listeden çıkarıyoruz; isteğe bağlı "Slot-check job'larını göster" ile gösterilebilecek.

7) headless olarak sayfa 2 test