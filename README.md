# Canvas CLI

Canvas CLI är en personlig terminalapp för att läsa och navigera i Canvas. Den
visar bland annat kurser, moduler, uppgifter, announcements, diskussioner,
betyg, deltagare och kursinnehåll i ett interaktivt tvåkolumnsgränssnitt.

Appen körs lokalt på din dator. Det finns ingen mellanliggande server eller
databas. Den nuvarande utvecklingsversionen ansluter med projektutvecklarens
egen Canvas-adress och personliga access token.

> Projektet är i ett tidigt skede och har hittills främst testats mot KTH Canvas
> på Linux. Nuvarande tokenflöde är avsett för personlig utveckling och testning,
> inte en publik app för flera användare.

## Krav

- Git
- Node.js 26.4 eller senare
- npm
- En terminal med stöd för ett interaktivt TUI
- `xdg-open` för webblänkar och Okular för PDF-filer på Linux

## Installera för lokal utveckling

```bash
git clone https://github.com/erikgeee/canvas-cli.git
cd canvas-cli
npm install
npm run setup
```

Setup-kommandot frågar efter din Canvas-adress och personliga token. För KTH är
adressen `https://canvas.kth.se`. Token skrivs med dold inmatning och sparas
endast i den lokala filen `.env`, som Git ignorerar. Filen får privata
filrättigheter (`600`).

Kontrollera därefter anslutningen:

```bash
npm run check-token
```

Detta gör en autentiserad, läsande kontroll mot Canvas och visar om profilen och
kurserna kan hämtas. Starta sedan appen:

```bash
npm start
```

## Skapa en personlig Canvas-token för testning

I Canvas går du normalt till **Account → Settings → Approved Integrations → New
Access Token**. Om knappen saknas kan din Canvas-administratör ha stängt av
personliga tokens.

Canvas [officiella API-dokumentation](https://canvas.instructure.com/doc/api/file.oauth.html#manual-token-generation)
beskriver manuell token som ett alternativ för testning. Dokumentationen säger
också att en app som används av flera användare måste använda OAuth. Innan Canvas
CLI distribueras som en färdig app till andra behöver projektet därför en
godkänd Canvas Developer Key och ett OAuth-inloggningsflöde.

Behandla token som ett lösenord:

- skicka den aldrig till projektets utvecklare eller någon annan;
- lägg den aldrig i en issue, commit eller skärmbild;
- återkalla den i Canvas om du misstänker att den har läckt.

## Tangenter

| Tangent | Funktion |
| --- | --- |
| `↑`/`↓` eller `j`/`k` | Navigera |
| `Enter` eller `→` | Öppna |
| `Esc` eller `←` | Gå tillbaka |
| `Shift` + `↑`/`↓` | Hoppa mellan modulrubriker |
| `Tab` | Byt sektion på startsidan |
| `r` | Uppdatera aktuell vy |
| `l` | Välj en länk i öppnat innehåll |
| `o` | Öppna innehåll eller Canvas-resurs externt |
| `f` | Favoritmarkera en Canvas-sida lokalt |
| `q` | Avsluta |

Favoriter kan växlas både från modullistan och från en öppnad sida. De visas i
samma naturliga ordning som sidorna har i Moduler.

## Cache och uppdatering

Modullistor sparas under den pågående sessionen. När du öppnar Moduler igen
visas listan direkt medan appen kontrollerar ändringar i bakgrunden. Ändrade
rader uppdateras på plats och den valda sidan behålls. Varje kurs har 30
sekunders väntetid efter en kontroll innan en ny kan starta, även om kontrollen
misslyckas eller du trycker `r`.

Sidor och listor som nyligen öppnats visas direkt när du återvänder till dem.
Appen förhämtar högst tre resurser åt gången. Sparat innehåll som är äldre än
fem minuter visas medan Canvas kontrolleras i bakgrunden. Sessionscachen rymmer
högst 80 resurser sammanlagt.

Deltagarlistan visas efter första svarssidan medan resten hämtas. Antalet visas
som preliminärt tills hela listan har laddats. Om hämtningen avbryts behålls den
ofullständiga listan med ett felmeddelande och kan provas igen med `r`.

## Ljust och mörkt tema

Appen följer terminalens färgläge och uppdateras om läget ändras medan den körs.
Om terminalen inte rapporterar något färgläge används mörkt tema. Du kan också
välja tema själv:

```bash
CANVAS_THEME=light npm start
CANVAS_THEME=dark npm start
```

`CANVAS_THEME` kan sparas i `.env`. Använd `auto` eller ta bort inställningen
för att följa terminalen igen.

## Uppdatera

Hämta den senaste koden och synkronisera beroenden:

```bash
git pull
npm install
```

Din lokala `.env` och dina lokala sidfavoriter ska inte skrivas över av en
vanlig uppdatering.

## Utveckling

```bash
npm run dev
npm run check
npm test
```

`npm run dev` startar appen med automatisk omstart när koden ändras. Kör typ- och
testkontrollerna innan ändringar skickas till GitHub.

## Säkerhetsmodell

Canvas-token läses lokalt från `.env` och skickas som Bearer-token direkt till
den konfigurerade Canvas-instansen. Projektet har ingen egen server, databas
eller central lagring av tokens. Lokala sidfavoriter ändrar inte data i Canvas.
En framtida publik version behöver ersätta den manuella tokenkonfigurationen med
OAuth enligt Canvas regler.
