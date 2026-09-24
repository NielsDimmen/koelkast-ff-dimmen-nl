# De Koelkastbeveiligger

Home Assistant-app die een mobiele webapp serveert. Tijdens het rijden kleurt het hele scherm op de bocht vóór je:

- groen: bocht naar links
- rood: bocht naar rechts
- oranje: rechtdoor

Daaronder staat hoelang het nog rijden is tot het volgende tankstation en de volgende rustplaats die direct aan jouw rijbaan liggen.

De webapp hoort op `https://koelkast.ff-dimmen.nl`. GPS en installeren als app werken op iOS alleen met HTTPS, en niet binnen het iframe van Home Assistant. Daarom heeft de app een eigen poort. Het optionele paneel in Home Assistant toont alleen status en logs.

## Lokaal draaien

Eenmalig, vanuit de root van deze repo:

```bash
npm install
npm install --prefix koelkast/web
npm install --prefix koelkast/server
npm run icons
```

Web en server los. De Vite-devserver proxyt `/api` naar poort 8099.

```bash
npm run dev:server
npm run dev:web
```

Open http://127.0.0.1:5173. Zonder HTTPS weigert de telefoon GPS en installatie; gebruik daarvoor de publieke URL of de demo.

De hele app als image:

```bash
docker build -t koelkast koelkast
docker run --rm -p 8099:8099 -p 8098:8098 -v koelkast-data:/data koelkast
```

De webapp staat dan op http://127.0.0.1:8099, de statuspagina op http://127.0.0.1:8098. Opties komen uit `/data/options.json`. Zonder dat bestand gelden de standaardwaarden.

Tests:

```bash
npm test
```

## In Home Assistant

1. Instellingen → Apps → App-store → rechtsboven de drie puntjes → Repositories.
2. Voeg de git-URL van deze repository toe. `repository.yaml` staat in de root, de app staat in de map `koelkast`.
3. Zoek De Koelkastbeveiligger en installeer hem. Architecturen: aarch64 en amd64.
4. Start de app. Poort 8099/tcp wordt standaard op de host gepubliceerd als 8099.
5. Het zijpaneel De Koelkastbeveiligger is alleen de statuspagina (draait hij, cache, laatste Overpass-verzoeken). De rij-app open je via HTTPS op poort 8099.

Bijwerken: nieuwe versie in de store installeren, of de app herstarten nadat je de repository hebt ververst. De webapp-cache op de telefoon ververst zichzelf (`autoUpdate`). Een harde refresh helpt als een oud serviceworker-bestand blijft hangen.

Opties:

| Optie | Standaard | Betekenis |
| --- | --- | --- |
| `overpass_url` | `https://overpass-api.de/api/interpreter` | Overpass-server |
| `overpass_fallback_url` | `https://overpass.kumi.systems/api/interpreter` | Tweede poging na een timeout. Leeg = geen fallback |
| `cache_hours` | 24 | Geldigheid van `/data/cache` |
| `bocht_drempel_graden` | 15 | Vanaf hoeveel graden het scherm van kleur wisselt |
| `lookahead_seconden` | 8 | Hoe ver vooruit de bocht wordt bekeken, minstens 150 m |

In de webapp kun je drempel en lookahead lokaal overschrijven.

## koelkast.ff-dimmen.nl

DNS en HTTPS zijn verplicht. Zonder certificaat geeft iOS geen locatie en kun je de site niet op het beginscherm zetten.

### Nginx Proxy Manager

1. DNS: een A-record `koelkast.ff-dimmen.nl` naar het publieke IP van het netwerk waar NPM draait. Poort 80 en 443 moeten NPM bereiken.
2. Hosts → Proxy Hosts → Add Proxy Host.
3. Domain: `koelkast.ff-dimmen.nl`. Scheme `http`. Forward naar het IP van de Home Assistant-host, poort `8099`.
4. Zet Websockets uit, Block Common Exploits aan, en stuur `X-Forwarded-For` en `X-Forwarded-Proto` mee (dat doet NPM standaard).
5. SSL-tab: vraag een Let's Encrypt-certificaat aan, Force SSL aan, HTTP/2 aan.
6. Test vanaf de telefoon, buiten je eigen wifi als de poort alleen via het publieke IP bereikbaar is.

Draait NPM zelf als Home Assistant-app, dan is het interne doel `http://koelkast:8099` (de app-slug op het Supervisor-netwerk). Lukt die naam niet, gebruik dan het LAN-IP van de host en de gepubliceerde poort 8099.

### Cloudflare Tunnel

In de Cloudflare Tunnel-app (cloudflared), naast je bestaande Home Assistant-host:

```yaml
additional_hosts:
  - hostname: koelkast.ff-dimmen.nl
    service: http://192.168.1.10:8099
```

Vervang het adres door het LAN-IP van de Home Assistant-host en poort 8099. De app maakt het DNS-record bij Cloudflare zelf aan. Zet er niet ook nog een A-record naar je thuis-IP naast, anders botsen ze.

Gebruik je een tunnel-token (remote managed), dan negeert de app `additional_hosts`. Voeg de hostname dan toe in het Cloudflare-dashboard: public hostname `koelkast.ff-dimmen.nl` → service `http://<HA-host>:8099`.

Cloudflare levert het certificaat aan de telefoon. De verbinding van de tunnel naar Home Assistant blijft HTTP op je eigen netwerk.

## Op de telefoon

1. Open `https://koelkast.ff-dimmen.nl` in Safari of Chrome. Niet in WhatsApp, Instagram of Facebook: die ingebouwde browsers kunnen de app niet installeren.
2. Volg de uitleg op het eerste scherm. Android: knop Installeren. iPhone Safari: Deel → Zet op beginscherm. iPhone Chrome: dezelfde stap, maar Deel zit rechtsboven.
3. Open De Koelkastbeveiligger vanaf het beginscherm. iOS vraagt daarna opnieuw om locatie; de app legt dat eerst kort uit.
4. Tik op Start en kies Bij gebruik. Het scherm blijft aan zolang de wake lock het toelaat.
5. Aan tafel: Demo A2, met 1×, 5× of 10×. De balk DEMO blijft zichtbaar. Zet in de instellingen de debug-kaart aan om de gematchte weg, de lookahead en per stop de reden (goedgekeurd, afrit, verkeerde kant, te ver weg) te zien.

## Demo opnieuw genereren

Het bestand `koelkast/web/public/demo/a2-maastricht-eindhoven.gpx` zit in de image, zodat de demo ook werkt als Overpass plat ligt. Opnieuw maken:

```bash
npm run demo
```

Het script haalt de A2 (ook `A2;A67`) op tussen Maastricht en Eindhoven, volgt de noordelijke rijbaan van Maastricht-Noord naar Leenderheide, en schrijft één punt per seconde: 100 km/u tot de hoogte van Roermond, daarna 120, iets langzamer in bochten, met een paar meter GPS-ruis.
