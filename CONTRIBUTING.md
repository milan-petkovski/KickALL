# CONTRIBUTING TO KICKALL ECOSYSTEM 🚀

Hvala vam što ste zainteresovani za doprinos KICKALL ekosistemu! Ovaj dokument pruža smernice za postavljanje lokalnog razvojnog okruženja, pisanje testova, proveru stila koda i podnošenje Pull Request-ova.

---

## 🛠️ Lokalno Razvojno Okruženje

### Zahtevi
- **Node.js**: v22.x ili novija
- **npm**: v10.x ili novija

### Kloniranje i Instalacija
```bash
# 1. Klonirajte repozitorijum
git clone https://github.com/milan-petkovski/kickALL.git
cd kickALL

# 2. Instalirajte zavisnosti za Bot i root projekat
npm install
cd Bot && npm install && cd ..
```

### Konfiguracija Okruženja
Kopirajte primere promenljivih okruženja:
```bash
cp Bot/.env.example Bot/.env
cp Website/.env.example Website/.env
```
Podesite `INTERNAL_API_SECRET` na podudarnu vrednost unutar oba `.env` fajla radi sigurne inter-service komunikacije.

---

## 🧪 Testiranje & Kvalitet Koda

Pre nego što pošaljete Pull Request, obavezno pokrenite sve automatizovane provere:

```bash
# Pokretanje svih nativnih unit testova (23+ testova)
npm test

# Generisanje izveštaja o pokrivenosti koda (Coverage)
npm run test:coverage

# Provera stila koda sa ESLint-om (mora proći sa 0 grešaka)
npm run lint

# Provera zavisnosti na bezbednosne ranjivosti
npm run audit

# Verifikacija i gradnja statičkih resursa
npm run build
```

---

## 📜 Pravila za Kod i Komite

1. **UTF-8 Enkodiranje**: Svi fajlovi moraju biti snimljeni u čistom UTF-8 formatu bez BOM-a uz očuvanje srpskih dijakritičkih karaktera (č, ć, š, đ, ž).
2. **Bezbednost po podrazumevanom pravilu**: Sve nove admin/operativne rute moraju koristiti `verifyInternalToken` sa fail-closed logikom.
3. **SVG Ikone**: Zabranjeno je korišćenje emoji simbola za grafičke komponente u UI-ju; uvek koristiti prilagođene SVG ikone.
4. **Unit Testovi**: Za svaku novu funkciju ili komandu u `Bot/src/` ili Netlify funkciju u `Website/netlify/functions/`, obavezno napišite nativni unit test u odgovarajućem `tests/` folderu.
