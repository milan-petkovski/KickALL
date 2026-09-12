# KickALL — Operativni priručnik za dugoročno održavanje (Operations Runbook)

Ovaj dokument sadrži operativne procedure, uputstva za konfiguraciju i korake za održavanje produkcionog ekosistema KickALL (Render bot servis, Netlify serverless funkcije i Supabase baza podataka).

---

## 1. Indeksi i optimizacija Dead Letter Queue (DLQ) tabele

Tabela `public.payment_dead_letter_queue` služi za perzistenciju neisporučenih Fungies webhook događaja u slučaju kada je bot servis privremeno nedostupan.

### Kreirani indeks
Za ubrzanje periodičnog sravnjivanja (koje bot pokreće na svaka 3 minuta preko funkcije `syncPendingSubscriptions()`), u bazi je definisan indeks:

```sql
CREATE INDEX IF NOT EXISTS idx_payment_dead_letter_queue_status_created 
ON public.payment_dead_letter_queue (status, created_at DESC);
```

* **Namena:** Eliminiše sekvencijalno skeniranje (Seq Scan) cele tabele i omogućava trenutno (Index Scan) dohvatanje zapisa koji čekaju obradu (`status = 'pending_bot_sync'`).
* **RLS pravila:** Tabela je osigurana Row Level Security (RLS) polisom koja dozvoljava pristup isključivo preko `service_role` ključa bota i Netlify webhook funkcije.

---

## 2. Čuvanje konzolnih logova nakon restarta (External Log Drain)

Render kontejneri su efemerni i brišu lokalnu istoriju konzole (`stdout`/`stderr`) prilikom svakog novog deploya ili restarta. Da bi istorija grešaka ostala trajno sačuvana i pretraživa, podržana su dva načina eksterne agregacije logova:

### Opcija A: Render Log Stream (Preporučeno — bez uticaja na performanse koda)
Render poseduje ugrađeni mehanizam za kontinuirano prosleđivanje svih konzolnih logova u realnom vremenu:

1. Registrujte se na besplatnom nalogu servisa [Better Stack (Logtail)](https://betterstack.com/logs) ili [Papertrail](https://papertrailapp.com/).
2. U Better Stack konzoli kreirajte novi **Source** (tip: *Render*). Dobićete Syslog ili HTTPS endpoint adresu i token.
3. U **Render Dashboard**-u:
   * Otvorite servis `kickbot-ihzb`.
   * U levom meniju izaberite **Settings** -> **Log Streams**.
   * Kliknite na **Add Log Stream**.
   * Izaberite provajdera (*Better Stack* ili *Syslog/Papertrail*) i unesite dobijeni URL i token.
4. Svi logovi (`INFO`, `WARN`, `ERR`, `MOD`, `BOT`) biće trajno skladišteni, indeksirani i pretraživi čak i nakon rušenja kontejnera.

### Opcija B: Aplikativni odvod preko promenljivih okruženja
U `Bot/src/utils.js` ugrađen je direktan asinhroni log shipper koji automatski šalje upozorenja i greške na eksterni servis ako su definisane sledeće varijable u Render `.env` podešavanjima:

* `BETTER_STACK_TOKEN`: Token izvora u Better Stack Logtail servisu (automatski šalje `POST` na `https://in.logs.betterstack.com`).
* `LOG_DRAIN_URL`: Alternativni HTTPS webhook endpoint za prijem logova.
* `LOG_ALL_TO_DRAIN=true`: Ako želite slanje svih logova a ne samo nivoa `WARN` i `ERR`.

---

## 3. Procedura rotacije tajnih ključeva bez prekida rada (Zero-Downtime Secret Rotation)

Zahvaljujući ugrađenoj podršci za listu razdvojenu zarezom (`comma-separated secrets`), rotacija tajnih ključeva između Netlify i Render servisa se izvodi bez ijednog odbačenog zahteva.

### A. Rotacija `INTERNAL_API_SECRET` (Komunikacija Netlify Proxy -> Bot)

Ovaj tajni ključ štiti administrativne rute bota (`/api/kick/*`, `/api/internal/subscription-sync`, `/api/channels`).

* **Korak 1 (Render):** Generišite novi jaki nasumični string (npr. `openssl rand -hex 32`). U Render Dashboard-u za bot servis ažurirajte promenljivu tako da sadrži **oba** ključa:
  ```env
  INTERNAL_API_SECRET="NOVI_TAJNI_TOKEN,STARI_TAJNI_TOKEN"
  ```
  Kliknite na **Save Changes**. Bot će se restartovati i prihvatati zahteve potpisane bilo novim, bilo starim ključem.
* **Korak 2 (Netlify):** U Netlify Dashboard-u (`Site configuration` -> `Environment variables`), promenite vrednost `INTERNAL_API_SECRET` na isključivo novu vrednost:
  ```env
  INTERNAL_API_SECRET="NOVI_TAJNI_TOKEN"
  ```
  Ponovo pokrenite deploy funkcija. Netlify funkcije odmah počinju da šalju novi ključ, koji bot prepoznaje i odobrava.
* **Korak 3 (Render čišćenje):** Kada se uverite u logovima da zahtevi stižu bez grešaka (HTTP 200), vratite se u Render Dashboard i uklonite stari ključ:
  ```env
  INTERNAL_API_SECRET="NOVI_TAJNI_TOKEN"
  ```
  Sačuvajte izmene. Rotacija je uspešno završena sa 0% prekida rada.

---

### B. Rotacija `FUNGIES_WEBHOOK_SECRET` (Potvrda uplata i pretplata)

Ovaj tajni ključ se koristi za verifikaciju HMAC-SHA256 potpisa u zaglavlju `x-fngs-signature` prilikom pristizanja uplata.

* **Korak 1 (Fungies Portal):** U Fungies Dashboard-u pod Webhook podešavanjima kreirajte ili regenerišite novi webhook secret (nemojte još brisati stari dok novi ne konfigurišete).
* **Korak 2 (Netlify):** U Netlify Environment Variables postavite oba ključa u promenljivu `FUNGIES_WEBHOOK_SECRET`:
  ```env
  FUNGIES_WEBHOOK_SECRET="NOVI_FUNGIES_SECRET,STARI_FUNGIES_SECRET"
  ```
  Funkcija `verifyFungiesSignature` automatski validira potpis naspram svih navedenih ključeva u nizu.
* **Korak 3 (Fungies Portal):** Sačuvajte novi secret kao aktivni u Fungies portalu. Novi webhook zahtevi stižu sa potpisom novog ključa i Netlify ih momentalno prihvata.
* **Korak 4 (Netlify čišćenje):** Uklonite stari ključ iz Netlify postavki ostavljajući samo novi:
  ```env
  FUNGIES_WEBHOOK_SECRET="NOVI_FUNGIES_SECRET"
  ```

---

## 4. Nadzor i provera Dead Letter Queue uplata

Ukoliko je bot servis bio isključen tokom prispeća webhooka, uplate se privremeno skladište u `payment_dead_letter_queue` tabeli.

* **Automatsko razrešavanje:** Čim se bot servis pokrene, funkcija `syncPendingSubscriptions()` automatski pronalazi sve zapise sa statusom `pending_bot_sync`, aktivira odgovarajući plan na kanalu korisnika i ažurira status u tabeli na `resolved` sa upisom `resolved_at`.
* **Discord obaveštenja:** Ako je u Netlify-ju definisana promenljiva `DISCORD_WEBHOOK_URL`, svaki preusmereni DLQ događaj šalje hitnu poruku u moderatorski Discord kanal, omogućavajući timu da prati status u realnom vremenu.
* **Ručna provera (SQL):**
  ```sql
  SELECT id, user_id, customer_email, plan, status, created_at, error_detail 
  FROM public.payment_dead_letter_queue 
  WHERE status = 'pending_bot_sync' 
  ORDER BY created_at DESC;
  ```
