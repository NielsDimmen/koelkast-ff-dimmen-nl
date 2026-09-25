# Changelog

## 1.0.4

- Tankstations/rustplaatsen zoeken tot ~80 km vooruit langs de snelweg, los van de bocht-lookahead (seconden). UI-label verduidelijkt; spur-zoektocht alleen vooruit.

## 1.0.3

- Resterende kilometers zonder GEO tellen nu terug: gereden GPS-afstand wordt van de geplande DESCRIPTION-km afgetrokken.

## 1.0.2

- Tankstations/rustplaatsen: Overpass-box verruimd van ~40 km naar ~90 km, pad zoekt tot 80 km vooruit, cache ververst eerder zodat verder gelegen stops zichtbaar blijven.
- Resterende kilometers: zonder GEO op het nightliner-event wordt de geplande km uit de DESCRIPTION gebruikt (bijv. `Nightliner drive to Amsterdam 203km`).

## 1.0.1

- Docker-build hersteld: runtime-stage gebruikt een vaste HA-base image i.p.v. `${BUILD_FROM}` (BuildKit zag die ARG niet tussen stages).

## 1.0.0

- Eerste versie van De Koelkastbeveiligger: PWA die links groen, rechts rood en rechtdoor oranje kleurt, met afstand tot het volgende tankstation en de volgende rustplaats aan dezelfde rijbaan.
- Bocht blijft in beeld tot je hem voorbij bent (geen 1-seconde hysterese meer).
- Stops via ref-scoped Overpass; demo A2 heeft lokale corridor-data zodat tankstation/rustplaats altijd tonen.
- Kleine kaart tijdens het rijden, km resterend, en server-side agenda-proxy voor nightliners.
