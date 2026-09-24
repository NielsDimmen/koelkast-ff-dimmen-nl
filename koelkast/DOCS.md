# De Koelkastbeveiligger

Tijdens het rijden kleurt deze webapp het hele scherm:

- **groen** — er komt een bocht naar links
- **rood** — er komt een bocht naar rechts
- **oranje** — rechtdoor

Onderin staat de tijd en afstand tot het volgende tankstation en de volgende rustplaats die aan jouw rijbaan liggen. Afritten, carpoolplaatsen en stops aan de overkant tellen niet mee.

Open de rij-app op `https://koelkast.ff-dimmen.nl`, niet in het paneel van Home Assistant. Locatie en installeren als webapp werken niet in dat iframe. Het paneel hier is alleen status: of de server draait, hoe groot de Overpass-cache is, en de laatste verzoeken.

## Installeren en bijwerken

1. Instellingen → Apps → App-store → ⋮ → Repositories. Plak de git-URL van deze repository.
2. Installeer **De Koelkastbeveiligger** en start hem. De app luistert op poort **8099/tcp**, standaard ook op de host als 8099.
3. Een nieuwe versie installeer je vanuit de store nadat de repository is ververst. Herstart daarna de app.

Opties staan onder Configuratie:

- `overpass_url` — standaard `https://overpass-api.de/api/interpreter`
- `overpass_fallback_url` — tweede server bij een timeout. Standaard `https://overpass.kumi.systems/api/interpreter`. Maak het veld leeg om de fallback uit te zetten
- `cache_hours` — hoelang een Overpass-antwoord in `/data/cache` geldig blijft (standaard 24)
- `bocht_drempel_graden` — standaard 15
- `lookahead_seconden` — standaard 8. De kijkafstand is minstens 150 meter, of snelheid × deze seconden
- `agenda_url` — private iCalendar-URL (alleen op de server). De webapp ziet hem niet; alleen `/api/agenda` levert het huidige of volgende nightliner-event

Drempel en lookahead kun je op de telefoon nog lokaal wijzigen.

Een gevaarlijke bocht (richtingsverandering groter dan de drempel) kleurt het scherm zodra hij in de lookahead ligt, en blijft groen/rood tot je die bocht voorbij bent.

## Reverse proxy en HTTPS

iOS geeft alleen locatie en een beginscherm-icoon op een echte HTTPS-site. Een self-signed certificaat is niet genoeg.

### Nginx Proxy Manager

1. DNS: A-record `koelkast.ff-dimmen.nl` naar het publieke IP waar NPM op 443 bereikbaar is.
2. Proxy Host: domein `koelkast.ff-dimmen.nl`, scheme `http`, forward hostname het IP van de Home Assistant-host, poort `8099`.
3. SSL: Let's Encrypt, Force SSL aan.
4. NPM stuurt `X-Forwarded-For` mee. Daarop limiteert De Koelkastbeveiligger het aantal Overpass-verzoeken per bezoeker.

Staat NPM als app naast De Koelkastbeveiligger, dan kun je forwarden naar `http://koelkast:8099`. Werkt die naam niet, gebruik het LAN-IP van de host en poort 8099.

### Cloudflare Tunnel

Extra public hostname in de Cloudflare Tunnel-app:

```yaml
additional_hosts:
  - hostname: koelkast.ff-dimmen.nl
    service: http://192.168.1.10:8099
```

Gebruik het LAN-IP van de Home Assistant-host. De tunnel maakt het DNS-record. Laat een bestaand A-record naar hetzelfde thuisadres niet naast de tunnel bestaan.

Met een tunnel-token (remote managed) negeert de app dit blok. Voeg de hostname dan toe in het Cloudflare Zero Trust-dashboard, service `http://<HA-host>:8099`. Het certificaat naar de telefoon komt van Cloudflare. Binnen je netwerk blijft het HTTP naar poort 8099.

## Lokaal draaien

Web en server apart, vanuit de repository:

```bash
npm install
npm install --prefix koelkast/web
npm install --prefix koelkast/server
npm run dev:server
npm run dev:web
```

De site op http://127.0.0.1:5173 praat via de proxy met de server op poort 8099.

Of alles in één container:

```bash
docker build -t koelkast koelkast
docker run --rm -p 8099:8099 -p 8098:8098 -v koelkast-data:/data koelkast
```

Poort 8098 is de statuspagina die in Home Assistant via ingress binnenkomt.

## Op de telefoon testen

1. Open `https://koelkast.ff-dimmen.nl` in Safari of Chrome.
2. Installeer via de uitleg op het eerste scherm. In WhatsApp of Instagram: kopieer de link en open hem in Safari of Chrome.
3. Start De Koelkastbeveiligger vanaf het beginscherm, tik op Start en sta locatie toe. Op iOS komt die vraag pas na het installeren opnieuw.
4. Zonder te rijden: **Demo A2**, snelheid 1×, 5× of 10×. De gele balk DEMO hoort zichtbaar te blijven. Onder Instellingen kun je een eigen GPX laden en de debug-kaart aanzetten. Die kaart toont de gematchte weg, de lookahead en per stop waarom hij wel of niet meetelt.

## Demo opnieuw genereren

```bash
npm run demo
```

Dat schrijft `koelkast/web/public/demo/a2-maastricht-eindhoven.gpx`: de noordelijke A2 van Maastricht-Noord naar Leenderheide, één punt per seconde. Tot Roermond 100 km/u, daarna 120, met een kleine vertraging in bochten en ongeveer 3 m GPS-ruis. Het bestand hoort in git, zodat de demo in de image zit en ook werkt zonder Overpass.
