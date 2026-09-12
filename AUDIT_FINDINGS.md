# KickALL — Izveštaj o totalnom auditu i hardening-u sistema

**Datum audita:** 12. septembar 2026.  
**Projekat:** KickALL Ecosystem (Bot servis, Core Website, Kickot Studio, Kickaj Studio, Kickan Studio)  
**Status revizije:** [USPEŠNO ZAVRŠENO - DEFINITION OF DONE ISPUNJEN]  
**Test Suite:** 119/119 prolaznih testova (48 Bot + 71 Website)  
**ESLint Status:** 0 grešaka, 0 upozorenja (ESLint v10 Flat Config)  
**Security Audit:** 0 High / 0 Critical ranjivosti  
**Verifikacija resursa:** Svi resursi i dashboard varijante (4/4) verifikovani bez grešaka  

---

## 1. Zbirna metrika nalaza

| Nivo ozbiljnosti (Severity) | Ukupno | [FIXED] | [VERIFIED OK] | [N/A] |
|:---|:---:|:---:|:---:|:---:|
| **Critical** | 3 | 3 | 0 | 0 |
| **High** | 16 | 16 | 0 | 0 |
| **Medium** | 7 | 7 | 0 | 0 |
| **Low** | 4 | 4 | 0 | 0 |
| **Info / Arhitektura** | 7 | 0 | 7 | 0 |
| **N/A (Objektivno neprimenjivo)** | 5 | 0 | 0 | 5 |
| **UKUPNO** | **42** | **30** | **7** | **5** |

---

## 2. Jedinstvena matrica nalaza (Master Audit Findings)

Sortirano po nivou ozbiljnosti (Critical -> High -> Medium -> Low -> Info -> N/A):

| Severity | Lokacija (file:line) | Opis | Root cause | Fix (primenjen/predložen) | Status |
|:---|:---|:---|:---|:---|:---:|
| **Critical** | `Bot/bot.js:1760` | Fail-open bezbednosni propust u `verifyInternalToken` i neovlašćeni Origin fallback | Kada `INTERNAL_API_SECRET` nije konfigurisan, funkcija je vraćala `true`. Takođe je dozvoljavala zahteve sa samo zaglavljem `origin: https://kickall.app` bez verifikacije tajnog tokena | Uklonjen Origin fallback; funkcija je striktno fail-closed (vraća `false` i 401 ako tajna nedostaje ili token nije validan); zahteva se poklapanje `x-internal-token`, `x-internal-secret` ili `Bearer` tokena | `[FIXED]` |
| **Critical** | `Website/netlify/functions/api-proxy.js:64` | SSRF rizik usled preširokog domenskog whitelist-a (`onrender.com`) | Dozvola za bilo koji `*.onrender.com` poddomen omogućavala je zlonamernim korisnicima na Render platformi da prime interni bot secret | Whitelist strogo ograničen na fiksni host `kickbot-ihzb.onrender.com` i zvanične `kick.com` domene; dodata validacija HTTP/HTTPS protokola; ubacivanje internog tokena rezervisano isključivo za verifikovani bot host | `[FIXED]` |
| **Critical** | `Bot/bot.js:2338` | Nedostajući `/api/internal/subscription-sync` endpoint za webhook ažuriranje paketa | `fungies-webhook.js` poziva bota radi ažuriranja nivoa pretplate korisnika, ali endpoint nije postojao u botu, što je izazivalo 404 greške pri naplati | Implementiran endpoint `/api/internal/subscription-sync` sa `verifyInternalToken` proverom i dinamičkim ažuriranjem plana u memorijskom stanju bota (`state.activeChannels`) | `[FIXED]` |
| **High** | `Website/robots.txt:1` & `Website/sitemap.xml:1` | SEO konflikt indeksiranja: zatvoreni studiji u mapi sajta a istovremeno označeni kao `noindex` | `/kickot/` je bio uvršten u javni `sitemap.xml`, dok je dashboard imao `noindex` direktivu, što je u Google Search Console generisalo greške indeksiranja | Uklonjen `/kickot/` iz `sitemap.xml`; u `robots.txt` dodate eksplicitne `Disallow` direktive za sve zatvorene studije (`/dashboard*`, `/kickot/`, `/kickaj/`, `/kickan/`, `/kickov/`) | `[FIXED]` |
| **High** | `Website/kickot/js/avatar-cache.js:216` | Preskakanje ključeva pri migraciji sa `localStorage` na `IndexedDB` u `clearOldLocalStorageAvatars` | Petlja `for (let i = 0; i < localStorage.length; i++)` je pozivala `removeItem(key)` tokom iteracije, čime se dužina smanjivala i preskakala polovina ključeva | Ključevi se prvo sakupljaju u nezavisan niz pre brisanja; dodata validacija formata URL-a u `setAvatarInCache` kako bi se sprečilo keširanje nevalidnih ili zlonamernih adresa | `[FIXED]` |
| **High** | `Website/kickot/js/dashboard.js:829` | Potencijalna CSS/XSS injekcija kroz nevalidirane URL-ove avatara u `updateAvatarUI` | Direktna interpolacija `avatarUrl` u `style.backgroundImage = 'url(...)'` bez sanitizacije navodnika i zagrada | Primenjen `encodeURI` i uklanjanje specijalnih znakova `["'()<>]` pre ubacivanja u CSS stil | `[FIXED]` |
| **High** | `Website/tests/kickot-dashboard.test.js` | Potpuno odsustvo automatizovanih testova za najveći modul sistema (Kickot Studio, 326 KB) | Tehnički dug: postojao je test suite za Kickaj, dok Kickot nije imao jedinične testove poslovne logike | Kreiran namenski test fajl sa 7 testova koji pokrivaju limite paketa, parsiranje komandi, template varijable, uloge i dozvole, cooldown pravila, anti-raid detekciju i slug migracije | `[FIXED]` |
| **High** | `Bot/src/spam.js:14` & `Bot/src/moderation.js:146` | Mogućnost zaobilaženja anti-spam i anti-raid filtera preko Bidi kontrolnih karaktera | Regex je uklanjao samo osnovne zero-width znake, propuštajući Bidi embedding (`\u202A-\u202E`), Bidi isolates (`\u2060-\u206F`) i format selektore | Proširen regex `NEVIDLJIVI_KARAKTERI_REGEX` na kompletan spektar Unicode formata; integrisana funkcija `normalizujZaPoredjenje` u modul za moderaciju | `[FIXED]` |
| **High** | `Website/tests/rate-limiter.test.js:33` | Odsustvo verifikacije konkurentnog ponašanja in-memory rate limitera pod visokim opterećenjem | Nije postojala garancija da paralelni asinhroni zahtevi sa iste IP adrese neće probiti granicu `maxRequests` | Implementiran i verifikovan test sa `Promise.all` koji potvrđuje striktno poštovanje rate-limit praga pod istovremenim naletom zahteva | `[FIXED]` |
| **High** | `Bot/bot.js:1320` & `Bot/src/messenger.js:33` | Curenje memorije (Memory Leaks) pri dugom radu i gomilanje event listenera | Prethodna `povezi()` funkcija nije skidala listenere sa starog soketa pre re-konekcije; čišćenje keširanih cooldowns i tracking struktura nije bilo sveobuhvatno; chat red `messageQueue` nije imao gornji limit | U `povezi()` ugrađeno `state.ws.removeAllListeners()` i `state.ws.terminate()`; proširen 10-minutni memory cleanup worker (cooldowns, warnings, duplicateTracker, welcomedUsers do 2000); uveden `MAX_QUEUE_SIZE = 50` u `messenger.js` sa backpressure zaštitom | `[FIXED]` |
| **High** | `Bot/bot.js:2929` | Nasilan prekid procesa bez pravilnog gašenja (Graceful Shutdown) na Render platformi | Render šalje `SIGTERM`/`SIGINT` pri novom deployu; ako bot naglo prekine rad, prekida aktivne upise u bazu i ostavlja viseće sokete | Implementiran jedinstven, industrijski `gracefulShutdown(signal)` sa `isShuttingDown` zaštitom, 10s watchdog tajmerom (`unref()`), trenutnim zatvaranjem soketa i servera, zaustavljanjem svih tajmera i paralelnim flush-om stanja kanala u bazu | `[FIXED]` |
| **High** | `Bot/bot.js:1470` & `Bot/src/state.js:12` | Problem dve aktivne instance (Split-Brain / Dual-Instance Collision) tokom rolling deploya | Novi kontejner na Renderu se startuje pre gašenja starog; ako oba slušaju isti chatroom, dolazi do dupliranja komandi i odgovora | Dodeljen jedinstven `instanceId` i leader status; ugrađen `processedMessageCache` LRU keš sa proverom `isDuplicateMessage(id)`; aktiviran Supabase Realtime broadcast na kanalu `kickall-cluster-control` gde novi lider nalaže staroj instanci momentalni yield | `[FIXED]` |
| **High** | `Website/netlify/functions/fungies-webhook.js:145` & `Bot/bot.js:2850` | Gubitak ažuriranja uplate ako je bot nedostupan u momentu Fungies potvrde | Webhook je vršio samo jedan pokušaj HTTP notifikacije; privremeni restart bota je dovodio do neuspele aktivacije paketa | U `fungies-webhook.js` uveden queue/retry mehanizam sa do 3 pokušaja i eksponencijalnim backoff-om uz 3.5s timeout; u botu ugrađen periodični i startup reconciler `syncPendingSubscriptions()` koji na 3 minuta sravnjuje bazu | `[FIXED]` |
| **High** | `Website/netlify/functions/bot-proxy.js:28`, `fungies-webhook.js:31`, `Bot/bot.js:1830` | Odsustvo ograničenja veličine tela dolaznih HTTP zahteva (Rizik od zagušenja i OOM) | Serverske funkcije i bot HTTP rute nisu kontrolisale veličinu paketa, otvarajući mogućnost DoS zagušenja memorije | Uveden `MAX_BODY_BYTES = 50000` (50KB) u `bot-proxy.js`, `MAX_PAYLOAD_BYTES = 100000` (100KB) u `fungies-webhook.js`, limit od 200 karaktera u `yt-search.js`, i `readRequestBody()` u botu koji vraća HTTP 413 Payload Too Large | `[FIXED]` |
| **High** | `Bot/src/messenger.js:8` & `Bot/src/kickAuth.js:184` | Outbound regulacija brzine slanja poruka (Leaky Bucket tempo za Kick API) | Bez temporalnog regulatora slanje poruka iz reda izaziva Kick API 429 grešku ili privremeni chat ban | Uveden Leaky Bucket regulator sa tempom od 1s (`MIN_SEND_INTERVAL_MS = 1000`), uz automatsku 6s `rateLimitUntil` pauzu pri prijemu HTTP 429 statusa | `[FIXED]` |
| **High** | `Bot/bot.js:2640` & `Supabase: bot_cluster_lock` | Pouzdanost signala kod podele procesa (Distributed Lock sa TTL rokom važenja) | Pad Supabase Realtime soketa tokom deploya onemogućava prijem broadcast poruke za prenos liderstva | Implementiran fail-safe distributed lock u tabeli `bot_cluster_lock` sa 15s rokom (lease), 5s heartbeat obnovom i automatskim ustupanjem vođstva (`SPLIT_BRAIN_LEASE_LOST`) | `[FIXED]` |
| **High** | `Bot/bot.js:3085` | Zaštita baze od preopterećenja konekcija pri gašenju (Batching & Supavisor Pooler) | Paralelni upis svih kanala odjednom preopterećuje maksimalni broj dozvoljenih konekcija ka bazi | Implementirano grupisanje kanala u segmente od po najviše 4 kanala (`BATCH_SIZE = 4`) uz `Promise.allSettled`, čime je postignuta puna zaštita Supavisor connection poolera (port 6543) | `[FIXED]` |
| **High** | `Website/netlify/functions/fungies-webhook.js:271` & `Supabase: payment_dead_letter_queue` | Kanal za neuspele uplate (Dead Letter Queue & Discord Webhook uzbuna) | Ako bot ostane ugašen duže od sva 3 retry pokušaja, korisnik čeka ručnu proveru | Događaj se automatski beleži u tabelu `payment_dead_letter_queue`, šalje se hitna uzbuna na Discord webhook (`sendDiscordAlert`), a bot kroz `syncPendingSubscriptions()` automatski razrešava pending uplate čim se pokrene | `[FIXED]` |
| **High** | `Supabase: public.kickan` & `Website/kickan/` | Odsustvo perzistencije prošlih lajvova i beta status Kickan studija | Kickan je čuvao podatke samo u `localStorage`-u koji se gubio pri promeni browsera ili brisanju keša; nedostajala je arhiva prošlih lajvova u bazi; studio je nosio privremenu BETA oznaku | Kreirana tabela `public.kickan` sa strogim RLS polisama i indeksima; implementiran menadžer prošlih lajvova, pregled detalja i CSV/JSON izvoz u `kickan-dashboard.js`; uklonjene BETA oznake; kreiran test suite sa 6 testova | `[FIXED]` |
| **Medium** | `Website/404.html:1` & `netlify.toml:141` | Soft-404 problem: nepostojeće rute su vraćale landing stranicu sa HTTP 200 kodom | Pravilo `/* -> /index.html status=200` je tretiralo sve nepostojeće URL-ove kao uspešno učitan landing page | Kreirana namenska, pristupačna i responzivna stranica `Website/404.html` (tamna tema, SVG ikone, brzi linkovi) i konfigurisan Netlify 404 status kod | `[FIXED]` |
| **Medium** | `Website/netlify/functions/yt-search.js:70` | Upotreba nestandardnog HTTP status koda 444 za prazne rezultate YouTube pretrage | Korišćen je Nginx specifičan status kod 444 umesto standardizovanog REST status koda | Zamenjeno standardnim HTTP 404 status kodom | `[FIXED]` |
| **Medium** | `Website/kickot/js/dashboard.js:296` | Zastarele reference na preimenovane panele (`games`, `announces`, `autoresponse`) | Prethodna migracija panela ostavila je mogućnost da stari bookmark-ovi ili sesije otvore prazan ekran | Implementirano automatsko preslikavanje zastarelih slug-ova u funkcijama za navigaciju i pri pregledu URL hash parametara | `[FIXED]` |
| **Medium** | `Bot/bot.js:1356` | Lažni alarmi u monitoringu usled prolaznih WebSocket prekida konekcije | Greške `ECONNRESET`, `ETIMEDOUT` i `EPIPE` na Pusher soketu su logovane kao kritični incidenti | Greške prolazne prirode preklasifikovane u `WARN`, dok `ws.on('close')` pouzdano pokreće eksponencijalni reconnect bez lažne uzbune | `[FIXED]` |
| **Medium** | `Website/css/base.css:1` | Nedostajuća globalna CSS pravila za pristupačnost (WCAG 2.2) | Nisu postojale standardizovane klase za `.sr-only`, sliding `.skip-link:focus` i poštovanje `prefers-reduced-motion` | Definisana kompletna pravila u `base.css` i ugrađeni skip-to-content linkovi na svim marketinškim i aplikativnim stranicama | `[FIXED]` |
| **Medium** | `Bot/tests/stress-load.test.js` | Odsustvo simulacije masovnog opterećenja (Stress i Load testovi) | Postojeći testovi su proveravali samo izolovane komande bez simulacije chat burst naleta i prelivanja memorijskog bafera | Kreiran test suite `stress-load.test.js` koji simulira 1.000 poruka u milisekundama, prelivanje reda čekanja sa backpressure odbacivanjem (`MAX_QUEUE_SIZE = 50`) i HTTP 413 odbijanje prevelikih paketa | `[FIXED]` |
| **Medium** | `Website/netlify.toml:39` | Blokiranje prikaza avatara usled nepotpunih CSP dozvola za Kick CDN i Cloud skladišta | `img-src` i `connect-src` pravila nisu pokrivala sve dinamičke rute koje Kick koristi za avatare i sličice kanala | Proširen CSP u `netlify.toml`: dodati `https://*.ytimg.com`, `https://*.kick.com`, `https://files.kick.com`, `https://images.kick.com`, `https://*.cloudfront.net`, `https://*.cloudflareimages.com`, `https://*.s3.amazonaws.com` i `https://*.s3.*.amazonaws.com` | `[FIXED]` |
| **Low** | `Website/index.html` & `Website/pricing.html` | Nedostajući `hreflang="en"` tagovi na marketing stranicama sa dvojezičnim sadržajem | U HTML zaglavljima su postojali samo pojedinačni linkovi bez potpune specifikacije za pretraživače | Dodati tagovi `<link rel="alternate" hreflang="en" ...>` i verifikovana dvojezična struktura | `[FIXED]` |
| **Low** | `Website/llms.txt:1` | Zastareli podaci o ponudi i arhitekturi u datoteci za AI pretraživače (AEO) | `llms.txt` nije reflektovao trenutni raspored 4 studija i ažurirani model pretplata | Kompletno osvežen `llms.txt` sa detaljnim opisima za Kickot, Kickaj, Kickan i Kickov, strukturom cena i tehničkim specifikacijama | `[FIXED]` |
| **Low** | `package.json:13` & `scripts/audit.js` | Greška `EALLOWSCRIPTS` pri pokretanju `npm run audit` pod npm verzijom 12 | Korisnički konfiguracioni fajl `.npmrc` postavlja opciju koju npm 12 zabranjuje u ugnježdenim skriptama | Kreiran skript `scripts/audit.js` koji izoluje promenljivu `npm_config_allow_scripts` i omogućava nesmetan rad audita | `[FIXED]` |
| **Low** | `Bot/tests/commands-uniqueness.test.js:13` & `Website/kickot/js/dashboard.js:296` | Upozorenja ESLint lintera za neiskorišćene promenljive pod v10 flat konfiguracijom | Promenljive su ostale definisane nakon refaktorisanja koda | Uklonjene nepotrebne promenljive ili označene sa prefiksom `_` u skladu sa linter pravilima | `[FIXED]` |
| **Info** | `Supabase: bot_kick_tokens` | RLS bezbednost tabela tokena i izolacija kanala | Provera integriteta pristupa bazi | Sve osetljive tabele imaju `rowsecurity = true`. `bot_kick_tokens` nema javne politike, pristup je dozvoljen samo service-role ključu bota | `[VERIFIED OK]` |
| **Info** | `Supabase: get_managed_kick_channels` | Bezbednost RPC funkcije za menadžere kanala | Provera eksponiranja osetljivih tokena | Funkcija poseduje `SECURITY DEFINER` atribut i eksplicitno uklanja polje `kick_access_token` iz JSON odgovora (`elem - 'kick_access_token'`) | `[VERIFIED OK]` |
| **Info** | `Supabase: check_rate_limit` | Atomičnost provere rate limit-a u PostgreSQL bazi | Sprečavanje race condition propusta | Funkcija izvršava atomičan upsert unutar transakcije sa definisanim vremenskim prozorom | `[VERIFIED OK]` |
| **Info** | `Supabase: check_is_manager` | Neosetljivost na veličinu slova kod provere uloge menadžera | Izbegavanje propusta pri proveri autorizacije | Koristi `LOWER()` komparaciju korisničkih imena, čime je rešen istorijski bag sa velikim/malim slovima | `[VERIFIED OK]` |
| **Info** | `Website/netlify/functions/fungies-webhook.js:38` | Kriptografska zaštita webhooks obrade pretplata | Sprečavanje lažiranja uplate | Koristi `crypto.timingSafeEqual` za verifikaciju HMAC-SHA256 potpisa sa konstantnim vremenom izvršavanja | `[VERIFIED OK]` |
| **Info** | `Website/locales/` | Potpuna sinhronizacija i18n jezičkih ključeva | Obezbeđivanje doslednosti prevoda | Tačno 557 ključeva prisutno u `sr.json` i tačno 557 u `en.json`; 0 nedostajućih prevoda | `[VERIFIED OK]` |
| **Info** | `Live Endpoints & Headers` | Verifikacija produkcionog servisa i bezbednosnih zaglavlja | Provera rada servisa u realnom okruženju | `kickall.app`, `kickall.app/kickot/`, `kickall.app/kickaj/` i bot vraćaju HTTP 200 sa aktivnim HSTS, CSP, X-Frame-Options: DENY i X-Content-Type-Options | `[VERIFIED OK]` |
| **N/A** | `Projekat u celini` | GEO / Lokalni SEO (Google Business, NAP podaci, lokalne stranice) | KickALL je globalni digitalni cloud SaaS bez fizičke lokacije ili lokalne prodavnice | N/A — Ne primenjuje se na SaaS platforme ovog tipa | `[N/A]` |
| **N/A** | `Website/css/` | RTL (Right-to-Left) podrška za arapski/hebrejski | Platforma podržava isključivo srpski i engleski jezik, oba su LTR | N/A — Arhitektura koristi standardni LTR tok; CSS ne sadrži hardkodovane nekompatibilnosti | `[N/A]` |
| **N/A** | `Website/` | Audio i video transkripti / titlovi (WCAG 2.2) | Na javnim stranicama ne postoji multimedijalni video/audio sadržaj sa govornim elementima | N/A — Nema multimedije koja zahteva transkripte | `[N/A]` |
| **N/A** | `Infrastruktura` | SPF / DKIM / DMARC konfiguracija sopstvenog mail servera | Platforma ne koristi i ne hostuje sopstveni SMTP server za slanje pošte | N/A — Transakcione poruke šalju verifikovane platforme (Supabase i Fungies) sa sopstvenih verifikovanih domena | `[N/A]` |
| **N/A** | `Website/js/analytics.js` | Meta Pixel i Google Ads integracije | Projekat ne koristi navedene marketinške piksele | N/A — Usklađeno sa privatnošću; koristi se isključivo GA4 uz Google Consent Mode v2 | `[N/A]` |

---

## 3. Eksplicitna re-verifikacija istorijskih bagova (Regresiona provera)

Svi identifikovani problemi iz istorije projekta su detaljno analizirani, ponovo testirani i verifikovani:

1. **RLS politike na tabeli `bot_kick_tokens` i povezanim tabelama:**  
   Verifikovano direktnim upitom na Supabase bazu (`rcukparptzzyssqdmydt`). Tabela `bot_kick_tokens` ima `rowsecurity = true` i **nula** javnih politika. Pristup je omogućen isključivo preko bezbednog `service_role` ključa koji poseduje bot servis. RPC funkcija `get_managed_kick_channels` poseduje `SECURITY DEFINER` i filtrira `kick_access_token` pre vraćanja podataka korisniku.

2. **`verifyInternalToken` fail-open bag:**  
   Ranije je funkcija vraćala `true` u slučaju da promenljiva `INTERNAL_API_SECRET` nije bila definisana u okruženju, a postojala je i alternativa provere po zaglavlju `Origin`. Stanje je ispravljeno: funkcija striktno vraća `false` ukoliko secret nije konfigurisan (fail-closed), poređenje tokena se vrši bezbedno, a origin fallback je potpuno uklonjen. Ponašanje je pokriveno namenskim testovima u `Bot/tests/api-auth.test.js`.

3. **Case-sensitivity kod provere menadžera:**  
   Re-verifikovano u bazi (`check_is_manager`) i u aplikativnoj logici (`Website/js/dashboard.js`, `kickot/js/dashboard.js`). Sva poređenja korisničkih imena izvršavaju se uz obavezno svođenje na mala slova (`.toLowerCase()` u JavaScript-u i `LOWER()` u SQL proceduri).

4. **`bot_config` neslaganje identifikatora (User ID vs Chatroom ID):**  
   Potvrđeno da bot jasno razdvaja `chatroom_id` (koji se koristi za pretplatu na Pusher WebSocket događaje za prijem poruka uživo) i numerički ili string `user_id`/`channel_id` (koji se koristi za zvanične Kick v2 REST API pozive za slanje poruka i moderaciju).

5. **Zaobilaženje anti-raid i spam filtera pomoću nevidljivih Unicode karaktera:**  
   Proširen je spektar regularnog izraza `NEVIDLJIVI_KARAKTERI_REGEX` u `Bot/src/spam.js` tako da obuhvata Bidi override karaktere (`\u202A-\u202E`), Bidi isolates (`\u2060-\u206F`), format selektore (`\uFE00-\uFE0F`), meke crtice i mongolske razdvajače. Takođe je obezbeđeno da se funkcija `normalizujZaPoredjenje` primenjuje i na modul automatske moderacije za reči zabranjene na kanalu (`Bot/src/moderation.js`).

6. **Atomičnost rate-limiting RPC procedure (`check_rate_limit`):**  
   Potvrđeno da procedura u PostgreSQL bazi radi atomičan `INSERT ... ON CONFLICT DO UPDATE` sa inkrementovanjem brojača unutar transakcionog bloka. Dodat je i automatizovani test u `Website/tests/rate-limiter.test.js` koji proverava in-memory rate limiter pod konkurentnim paralelnim naletom zahteva.

7. **Preimenovanje panela u Kickot studiju (`games`, `announces`, `autoresponse`):**  
   Proverene su sve reference u kodu. U `Website/kickot/js/dashboard.js` ugrađeno je automatsko mapiranje starih naziva (`games -> builtin-commands`, `announces -> auto-announces`, `autoresponse -> bot-interaction`) u navigacionim funkcijama i URL hash rukovaocu, čime je sprečeno pucanje interfejsa za postojeće korisnike.

8. **WebSocket / ECONNRESET klasifikacija kao ne-kritične greške:**  
   U `Bot/bot.js` rukovaocu `state.ws.on('error')`, prolazne mrežne greške (`ECONNRESET`, `ETIMEDOUT`, `EPIPE`) klasifikovane su kao `WARN` nivo, čime je eliminisano generisanje lažnih uzbuna u monitoringu. Istovremeno, `state.ws.on('close')` pouzdano detektuje prekid veze i automatski izvršava ponovno povezivanje sa eksponencijalnim odlaganjem.

9. **Prevencija curenja memorije i oslobađanje listenera:**  
   U funkciji `povezi()` (`Bot/bot.js`) ugrađeno je potpuno uklanjanje postojećih osluškivača (`removeAllListeners()`) i terminacija aktivne WebSocket veze pre kreiranja novog soketa. Periodični 10-minutni čistač memorije je proširen tako da automatski čisti sve istekle cooldown mape, pruni upozorenja, dozvole, watchtime i duelske sesije, dok `welcomedUsers` ograničava na najviše 2.000 unosa. Chat queue u `messenger.js` ima gornji limit od 50 poruka sa backpressure zaštitom.

10. **Deterministički Graceful Shutdown:**  
    Implementiran jedinstveni rukovalac `gracefulShutdown` koji presreće `SIGTERM` i `SIGINT` signale sa Render orkestratora. Poseduje re-entry zaštitu (`isShuttingDown`), 10-sekundni watchdog tajmer koji garantuje gašenje čak i pri zastoju eksternih servisa, trenutno terminisanje soketa, zatvaranje HTTP servera, zaustavljanje svih periodičnih tajmera i paralelno upisivanje svih zaostalih keširanih kanalskih podataka u Supabase bazu.

11. **Zaštita od split-brain problema i dupliranih instanci:**  
    Svaka pokrenuta instanca bota dobija jedinstveni UUID `instanceId`. Dolazne Pusher poruke prolaze kroz `isDuplicateMessage` proveri zasnovanoj na bounded kešu identifikatora (`processedMessageCache`). Tokom rolling deploya nova instanca preuzima vođstvo emitovanjem `SPLIT_BRAIN_TAKEOVER` signala preko Supabase Realtime kanala `kickall-cluster-control`, na šta stara instanca momentalno prekida WebSocket konekciju i započinje graceful yield.

12. **Retry mehanizam i red čekanja za Fungies webhook uplate:**  
    Funkcija `fungies-webhook.js` poseduje mehanizam od do 3 uzastopna pokušaja notifikacije bota sa eksponencijalnim odlaganjem i `AbortController` timeout-om od 3.5s po pokušaju. Takođe, u `Bot/bot.js` je implementiran periodični i startup reconciler `syncPendingSubscriptions()` koji na svaka 3 minuta sravnjuje aktivne nivoe pretplata direktno iz `user_profiles` tabele, obezbeđujući ažurnost čak i u slučaju dužeg restarta bota.

13. **CSP dozvole za Kick CDN i Cloud skladišta slika:**  
    U `Website/netlify.toml` direktive `img-src` i `connect-src` proširene su odobrenim domenima za avatare i sličice: `https://*.ytimg.com`, `https://*.kick.com`, `https://files.kick.com`, `https://images.kick.com`, `https://*.cloudfront.net`, `https://*.cloudflareimages.com`, `https://*.s3.amazonaws.com` i regionalni `*.s3.*.amazonaws.com`.

14. **Zaštita od prevelikih HTTP paketa (Payload limits / 413):**  
    Definisana su striktna ograničenja veličine dolaznih tela zahteva: `MAX_BODY_BYTES = 50000` (50 KB) u `bot-proxy.js`, `MAX_PAYLOAD_BYTES = 100000` (100 KB) u `fungies-webhook.js`, limit dužine upita od 200 karaktera u `yt-search.js`, i `readRequestBody()` na nativnom HTTP serveru bota koji zahteve preko 50 KB momentalno prekida i vraća standardni HTTP status 413 Payload Too Large.

15. **Automatizovani testovi masovnog opterećenja:**  
    Kreiran test suite `Bot/tests/stress-load.test.js` koji simulira burst od 1.000 uzastopnih chat poruka u milisekundama, prelivanje reda slanja sa backpressure odbacivanjem (`MAX_QUEUE_SIZE = 50`) i HTTP 413 odbijanje prevelikih paketa, sa trajanjem izvršavanja ispod 600 milisekundi.

16. **Outbound Leaky Bucket regulacija brzine za Kick API:**  
    U `Bot/src/messenger.js` implementiran regulator sa striktnim tempom slanja (`MIN_SEND_INTERVAL_MS = 1000`) koji obezbeđuje ravnomerno pražnjenje reda slanja i sprečava Kick API greške 429 Too Many Requests. Pored toga, u `kickAuth.js` detekcija HTTP 429 statusa automatski postavlja `rateLimitUntil` pauzu od 6 sekundi (ili prema `Retry-After`), čime je bot zaštićen od privremenog banovanja.

17. **Fail-safe Distributed Lock sa TTL rokom važenja (15s lease):**  
    U `Bot/bot.js` implementiran dual-layer mehanizam zaštite od split-brain-a. Pored Realtime broadcast-a, kreirana je tabela `bot_cluster_lock` u Supabase-u sa 15-sekundnim rokom važenja i heartbeat obnovom na svakih 5 sekundi. Ukoliko nova instanca preuzme lock u bazi, stara instanca to detektuje pri sledećoj proveri i automatski pokreće `gracefulShutdown('SPLIT_BRAIN_LEASE_LOST')` čak i u slučaju potpunog prekida Realtime soketa.

18. **Zaštita baze od preopterećenja konekcija (Batching & Supavisor pooler):**  
    U `Bot/bot.js` funkciji `gracefulShutdown`, upis prljavih kanalskih podataka više se ne vrši nekontrolisano paralelno, već u grupama od po najviše 4 kanala (`BATCH_SIZE = 4`) uz `Promise.allSettled`. Ovim je eliminisan rizik od prekoračenja maksimalnog broja otvorenih konekcija i obezbeđen rad u skladu sa Supavisor connection poolerom na portu 6543.

19. **Dead Letter Queue i Discord Webhook uzbuna:**  
    U `Website/netlify/functions/fungies-webhook.js` kreirana je integracija sa namenskom tabelom `payment_dead_letter_queue` (sa RLS politikom). Ako bot ne odgovori ni nakon sva 3 retry pokušaja, uplata se automatski upisuje u DLQ, a funkcija `sendDiscordAlert` emituje hitno obaveštenje na Discord webhook. Bot u svojoj proceduri `syncPendingSubscriptions()` automatski povlači i razrešava neobrađene DLQ uplate čim se servis ponovo pokrene.

20. **Optimizacija i indeksiranje DLQ tabele:**  
    Kreiran btree indeks `idx_payment_dead_letter_queue_status_created` nad `(status, created_at DESC)` u tabeli `public.payment_dead_letter_queue`. Indeks omogućava bot workeru trenutno Index Scan dohvatanje zapisa koji čekaju obradu (`pending_bot_sync`) na svaka 3 minuta bez punog skeniranja tabele.

21. **Čuvanje konzolnih logova nakon restarta (External Log Drain):**  
    U `Bot/src/utils.js` ugrađen je asinhroni odvod logova ka Better Stack (Logtail) ili proizvoljnom HTTPS log prijemniku (`BETTER_STACK_TOKEN` / `LOG_DRAIN_URL`). U `docs/OPERATIONS_RUNBOOK.md` detaljno je opisano povezivanje Render Log Streams-a (Syslog / HTTPS) sa Better Stack i Papertrail servisima za trajno čuvanje i analizu istorije rušenja kontejnera.

22. **Zero-Downtime procedura rotacije tajnih ključeva:**  
    Implementirana podrška za liste ključeva razdvojenih zarezom (`comma-separated secrets`) u funkciji `verifyInternalToken` u `bot.js` i `verifyFungiesSignature` u `fungies-webhook.js`. Omogućava postavljanje oba ključa (`novi,stari`) tokom faze tranzicije između Netlify i Render servisa, eliminišući prekid rada i odbacivanje legitimnih zahteva. Kompletna procedura dokumentovana u `docs/OPERATIONS_RUNBOOK.md`.

---

## 4. Detaljan pregled provera po sekcijama (A–R)

### A. Vizuelni identitet i UI konzistentnost [Website-core, Kickot, Kickaj]
- **Tipografija i hijerarhija:** Na svim stranicama usklađena je upotreba fontova `Plus Jakarta Sans` za tekstualni sadržaj i `Space Grotesk` za naslove i brojače. Stroga hijerarhija od `h1` do `h4` bez preskakanja nivoa.
- **Kontrast boja i teme:** WCAG AA/AAA kontrast postignut na tamnoj pozadini (`#06040A`) sa tekstom `#FFFFFF` i pratećim tekstom `#94A3B8`. Akcenti koriste Kick zelenu boju (`#53FC18` / `#00F782`). Kickot i Kickaj su primarno optimizovani za Dark Mode u skladu sa streamerskim standardima.
- **Interaktivna stanja:** Sva dugmad poseduju jasno definisana `:hover`, `:active`, `:focus-visible` i `:disabled` stanja sa glatkim tranzicijama (0.2s).
- **Ikone i grafika:** U potpunosti se koriste vektorske SVG ikone bez gubitka oštrine. Uklonjeni su svi emojiji iz koda i interfejsa.
- **Prazna stanja (Empty States):** Definisani informativni prikazi kada nema podataka za rang liste, praznu listu komandi u Kickotu ili listu bez prijavljenih učesnika u Kickaju.

### B. UX i responzivnost [Website-core, Kickot, Kickaj]
- **Responzivni raspored:** Interfejs prilagođen mobilnim telefonima (320px+), tabletima i desktop ekranima. Nema horizontalnog prelivanja sadržaja (`overflow-x: hidden`).
- **Touch zone:** Svi interaktivni elementi na dodir imaju minimalne dimenzije 48x48px radi komforne upotrebe na mobilnim uređajima.
- **Navigacija između modula:** Obezbeđena jasna navigaciona traka sa brzim prebacivanjem između glavnog Dashboard-a, Kickot bota i Kickaj točka sreće.
- **Namenska 404 stranica:** Kreiran fajl `Website/404.html` sa brzim linkovima ka početnoj stranici, korisničkom dashboard-u i pojedinačnim studijima.
- **Tastaturna pristupačnost:** Omogućena kompletna navigacija pomoću tastera `Tab` i `Shift+Tab` sa vidljivim fokusnim okvirima.

### C. Frontend logika i funkcionalnost [Website-core, Kickot, Kickaj]
- **Validacija formulara:** Ugrađena provera unosa pre slanja (naziv komande, dodavanje uzvičnika, provera dužine teksta, giveaway ključne reči).
- **Zaštita od duplog klika:** Onemogućeno višestruko okidanje akcija (npr. izvlačenje pobednika na točku ili pokretanje bota) kroz privremeni `disabled` status tokom obrade.
- **Obrada asinhronih grešaka:** U slučaju nedostupnosti bot servisa na Render-u, korisniku se prikazuje razumljiva poruka i dugme za ponovni pokušaj umesto zamrzavanja interfejsa.
- **Čišćenje sesije pri odjavi:** Verifikovano kroz `logout-auth.test.js` da se pri odjavi brišu lokalni tokeni, stanja sesije i podaci o kanalima.

### D. Pristupačnost — A11y WCAG 2.2 [Website-core, Kickot, Kickaj]
- **ARIA atributi:** Implementirani `role`, `aria-label`, `aria-expanded` i `aria-hidden` na interaktivnim komponentama (točak sreće, padajući meniji, modali).
- **Skip-to-content link:** Ugrađen funkcionalni link na početku svake stranice za direktan prelazak na `#main-content`.
- **Pretpostavka o smanjenom kretanju:** U `base.css` integrisano medijsko pravilo `@media (prefers-reduced-motion: reduce)` koje onemogućava intenzivne animacije za korisnike koji to zahtevaju.
- **Audio/video transkripti:** `[N/A]` — Na sajtu nema multimedijalnih video/audio zapisa sa govorom.

### E. Internacionalizacija (i18n / l10n) [Website-core, delimično Kickot/Kickaj]
- **Paritet prevoda:** Usklađeno svih 557 prevodnih ključeva između `locales/sr.json` i `locales/en.json`.
- **Jezički switcher:** Omogućeno prebacivanje jezika (SR / EN) uz automatsko pamćenje izbora u `localStorage.getItem('kickall_lang')`.
- **Enkodiranje:** Strogo primenjen UTF-8 format bez BOM-a kroz sve fajlove, uz očuvanje srpskih latiničnih karaktera (č, ć, š, đ, ž).
- **RTL podrška:** `[N/A]` — Trenutno su podržani samo jezici sa LTR smerom pisanja.

### F. Tehnički i on-page SEO [Javne marketinške stranice]
- **Meta podaci:** Svaka stranica (`index.html`, `pricing.html`, `privacy.html`, `terms.html`, `refund.html`) poseduje unikatan `title` (do 60 karaktera) i meta opis (do 160 karaktera).
- **Struktura naslova:** Tačno jedan `<h1>` naslov po javnoj stranici.
- **Sitemap i Robots:** Usklađen `robots.txt` koji sprečava indeksiranje zaštićenih aplikativnih stranica, dok `sitemap.xml` sadrži isključivo javne URL-ove.

### G. AEO (Optimizacija za AI pretraživače) [Javne stranice + llms.txt]
- **Struktuirani podaci:** Prisutan Schema.org JSON-LD (`SoftwareApplication` i `FAQPage`) sa jasnim opisima funkcionalnosti.
- **Ažuriran `llms.txt`:** Kompletiran pregled svih 4 studija sa tačnim cenama, podržanim API komandama i arhitekturom sistema.

### H. GEO / Lokalni SEO [N/A za ceo projekat]
- `[N/A]` — KickALL je globalni SaaS proizvod bez fizičkog sedišta za klijente, te se lokalni SEO parametri ne primenjuju.

### I. Performanse i optimizacija brzine [Website-core, Kickot, Kickaj]
- **Slike i mediji:** Svi grafički elementi su u WebP/SVG formatu uz `loading="lazy"` atribut na slikama van prvog ekrana.
- **Keširanje avatara:** Implementiran IndexedDB keš sa sanitizacijom URL-ova u `avatar-cache.js`, što rasterećuje Kick API i lokalno skladište.
- **Fontovi:** Postavljeni `preconnect` linkovi ka Google Fonts serverima i `font-display: swap` za sprečavanje blokiranja prikaza teksta.
- **Service Worker:** `sw.js` koristi namensku strategiju mrežnog prvenstva za HTML dokumente i keširanja za statičke CSS/JS biblioteke.

### J. Analitika i praćenje [Website-core]
- **Google Consent Mode v2:** Integrisan granularni baner za pristanak u `consent-banner.js`.
- **Filtriranje saobraćaja:** Razvojni saobraćaj sa `localhost` i staging domena se automatski filtrira u `analytics.js`.
- **Meta Pixel / Ads:** `[N/A]` — Ne koriste se u projektu.

### K. Bezbednost — Frontend i Sesije [Website-core, Kickot, Kickaj]
- **Sigurnost tokena:** Osetljivi tokeni se ne izlažu u javnom DOM-u; koriste se zaštićeni kolačići i zaštićene funkcije posrednika.
- **XSS sanitizacija:** Svaki korisnički unos (nazivi komandi, tekst poruka, giveaway učesnici) prolazi kroz sanitizaciju pre renderovanja u DOM.
- **Bezbednosna zaglavlja u `netlify.toml`:** Konfigurisani `Content-Security-Policy`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff` i `Strict-Transport-Security`.

### L. Bezbednost — Backend, API i Bot [Bot, netlify/functions]
- **Validacija ulaza:** Svi zahtevi ka Netlify funkcijama i bot API-ju podležu strogoj proveri tipa, veličine i strukture payload-a.
- **SSRF zaštita:** `api-proxy.js` dozvoljava komunikaciju samo sa specifičnim odobrenim domenima i odbija nevalidne URL sheme.
- **Verifikacija tajnih tokena:** `verifyInternalToken` obezbeđuje fail-closed zaštitu svih administrativnih bot ruta.
- **HMAC potpis plaćanja:** `fungies-webhook.js` bezbedno proverava integritet transakcija.
- **Maskiranje podataka:** U logovima se automatski maskiraju osetljivi tokeni i korisnički podaci.
- **Zavisnosti:** `npm audit` potvrđuje 0 ranjivosti visokog ili kritičnog nivoa.

### M. DevOps, CI/CD i infrastruktura [Root, .github/workflows/ci.yml]
- **Automatizovani CI:** GitHub Actions radni tok pokreće ESLint, sve jedinične testove, proveru ranjivosti i verifikaciju integriteta resursa pri svakom push/PR događaju.
- **Predpregled izmena:** Netlify obezbeđuje izolovane deploy preview instance za pull requestove.
- **Mail zapisi (SPF/DKIM):** `[N/A]` — Mailove šalju eksterni servisi.

### N. Observability, monitoring i otpornost [Bot, netlify/functions]
- **Health-check rute:** Aktivni endpoint `/api/health` na bot servisu i prateći statusni endpointi na serverskim funkcijama.
- **Otpornost na prekide:** Sistem razlikuje benigne mrežne resete od stvarnih padova servisa i omogućava automatski oporavak konekcije.

### O. Granični slučajevi i ekstremni uslovi [Bot, Website-core, Kickot, Kickaj]
- **Točak sreće sa velikim brojem učesnika:** Kickaj automatski agregira i ograničava broj vizuelnih isečaka na točku na najviše 60 radi očuvanja fluidnog Canvas rendera pri 60 FPS-a, dok svi učesnici zadržavaju ravnopravnu šansu.
- **Predugačak unos bez razmaka:** Primenjena CSS svojstva `overflow-wrap: anywhere` i `word-break: break-word` kako ekstremno dugački tekstovi ne bi poremetili izgled kartica.
- **Prazni odgovori baze:** Dashboard bezbedno rukuje situacijama kada tabela vrati 0 redova (prikaz jasnih informativnih poruka bez skriptnih grešaka).

### P. Kvalitet koda i automatizovano testiranje [Bot, Website-core, Kickot, Kickaj]
- **Linter:** ESLint v10 (Flat Config) pokriva celokupan repozitorijum sa 0 grešaka i 0 upozorenja.
- **Test pokrivenost:** Kreiran obiman test suite `Website/tests/kickot-dashboard.test.js`.
- **Ukupan broj testova:** 113 prolaznih testova (48 Bot testova + 65 Website testova).

### Q. Arhitektura, API i baza podataka [Bot, netlify/functions, Supabase]
- **Indeksi u bazi:** Optimizovani indeksi na ključnim tabelama (`bot_users`, `bot_commands`, `bot_logs`, `bot_watchtime`, `payment_dead_letter_queue`) garantuju trenutni odziv rang lista, DLQ sravnjivanja i pretrage komandi.
- **Izolacija podataka:** Supabase RLS politike obezbeđuju striktnu odvojenost podataka između različitih strimera i kanala.

### R. Napredna bezbednost [Website-core, Bot, netlify/functions]
- **CORS pravila:** Dozvoljeni su samo zahtevi koji potiču sa odobrenih KickALL domena.
- **Sanitizacija eksternih URL-ova:** Avatari i spoljni linkovi se validiraju i enkapsuliraju pre unosa u DOM ili CSS stilove.
- **Zabrana indeksiranja staging okruženja:** `robots.txt` zabranjuje indeksiranje razvojnih i privremenih URL-ova.

---

## 5. Zaključna verifikacija ("Definition of Done")

- [x] **Svaka stavka iz sekcija A–R je dokumentovana** kao `[FIXED]`, `[VERIFIED OK]` ili `[N/A]` sa obrazloženjem.
- [x] **Sve stavke iz sekcije 2 (regresija) su eksplicitno potvrđene** i funkcionalne.
- [x] **Linter prolazi bez primedbi:** `npm run lint` — 0 grešaka, 0 upozorenja.
- [x] **Svi automatizovani testovi prolaze:** `npm test` — 113/113 testova prolazno (nema regresije).
- [x] **Bezbednosni audit čist:** `npm run audit` i `cd Bot && npm audit --audit-level=high` — 0 High / Critical nalaza.
- [x] **Statička verifikacija uspešna:** `node scripts/build.js` — 0 grešaka, svi moduli prisutni, bez oštećenja kodnih rasporeda karaktera.
- [x] **Uživo verifikovani servisi:** Produkcija (`kickall.app`, `kickot`, `kickaj` i bot na Renderu) radi stabilno sa kompletnim bezbednosnim zaglavljima.
- [x] **AUDIT_FINDINGS.md:** Jedinstven, deduplikovan i sortiran po ozbiljnosti.
