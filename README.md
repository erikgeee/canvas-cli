# Canvas CLI

Canvas i terminalen. Testat med Node.js 26.

```sh
npm ci
```

Lägg `CANVAS_BASE_URL` och `CANVAS_ACCESS_TOKEN` i `.env` och starta med `npm start`.
`.env` ignoreras av Git. `npm run check-token` kontrollerar anslutningen.

Navigera med piltangenterna eller j/k. Enter och högerpil öppnar det valda
innehållet, vänsterpil/Esc går tillbaka och q avslutar.
I Moduler hoppar Shift+uppil och Shift+nedpil till föregående respektive nästa
modulrubrik, även när en sida inuti en modul är markerad.

För att spara en kurssida som favorit: markera sidan i Moduler och tryck f.
Det fungerar också när sidan är öppnad. Sidan får en stjärna i modullistan och
visas under Favoriter i kursmenyn i samma ordning som i Moduler. Tryck f igen
för att ta bort favoriten.

Modullistor sparas under den pågående sessionen. När du öppnar Moduler igen
visas listan direkt medan appen kontrollerar ändringar i bakgrunden. Ändrade
rader uppdateras på plats och den valda sidan behålls. Varje kurs har 30 sekunders
väntetid efter en kontroll innan en ny kan starta, även om kontrollen misslyckas
eller du trycker r. Pågående kontroller återanvänds. Snabb navigering gör därför
inga extra anrop. Om kontrollen misslyckas kan du fortsätta använda den redan
laddade listan och trycka r för att försöka igen efter väntetiden.

Sidor och listor som nyligen öppnats visas direkt när du återvänder till dem.
Appen förhämtar högst tre resurser åt gången och värmer sidan eller kursfliken
som du stannar på. Sparat innehåll som är äldre än fem minuter visas medan
Canvas kontrolleras i bakgrunden. Tryck r för att kontrollera manuellt;
upprepade kontroller har 30 sekunders väntetid. Cachen finns bara under den
pågående sessionen och rymmer högst 80 resurser sammanlagt.

Deltagarlistan visas efter första svarssidan medan resten hämtas. Antalet
visas som preliminärt tills hela listan har laddats. Om hämtningen avbryts
behålls den ofullständiga listan med ett felmeddelande och kan provas igen med r.

## Ljust och mörkt tema

Appen följer terminalens färgläge och uppdateras även när läget ändras medan
den körs. Om terminalen inte rapporterar något färgläge används mörkt tema.
Det går också att välja tema själv:

```sh
CANVAS_THEME=light npm start
CANVAS_THEME=dark npm start
```

`CANVAS_THEME` kan sparas i `.env`. Använd `auto` eller ta bort inställningen
för att följa terminalen igen.

## Utveckling

`npm run dev` startar med automatisk omladdning. Kör `npm run check` och
`npm test` för typkontroll och tester, inklusive tangenttryckningar och temabyte.
