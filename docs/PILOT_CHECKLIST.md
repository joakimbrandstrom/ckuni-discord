# Checklista för v0.2-piloten

Använd checklistan med en `Ledare`, ett separat medlemskonto och vid behov ett gästkonto. Kör
piloten i de befintliga kanalerna `#zwift-ride` och `#allmänt` efter att kanal-ID:n, behörigheter och
roller har konfigurerats enligt [Discord-guiden](DISCORD_SETUP.md).

## Före testet

- [ ] Driftsätt senaste `main`, kör databasmigreringarna och registrera Discord-kommandona.
- [ ] Ställ in roll-ID:n för `Ledare` och `System Admin`; lämna dem inte tomma i piloten.
- [ ] Kontrollera behörigheterna i de befintliga kanalerna; boten ska inte skapa nya kanaler.

## Acceptanstest

1. [ ] Skapa ett riktigt eller testbaserat CK UNI Club Event i Zwift.
2. [ ] Kopiera Zwift-evenemangets URL och uppgifter.
3. [ ] Kör `/ride create` som `Ledare`, fyll i formuläret och klistra in Zwift-uppgifterna.
4. [ ] Kontrollera att exakt ett passkort visas i `#zwift-ride` och exakt ett Discord Scheduled
       Event skapas med rätt tid, längd och detaljer.
5. [ ] Välj `Jag kommer` och sedan `Kanske` från ett annat Discord-konto. Kontrollera att valet och
       räknarna uppdateras.
6. [ ] Kontrollera behörigheterna för alla fyra rollerna: `Ledare` och `System Admin` får skapa,
       redigera och ställa in; `CK UNI Rider` och `Gäst` får inte göra det.
7. [ ] Kör `/ride edit`. Kontrollera efter omladdning att databasens uppgifter, samma passkort och
       samma Scheduled Event har uppdaterats utan dubbletter.
8. [ ] Kör `/ride cancel`. Kontrollera att passkortet tydligt visar **INSTÄLLT**, knapparna är
       avstängda och Scheduled Event är borttaget/inställt.
9. [ ] Skapa ytterligare ett framtida pass, starta om boten och kontrollera att passet och
       deltagarvalen finns kvar och att inga dubbletter publiceras.
10. [ ] Skapa ett testpass ungefär 35 minuter framåt. Låt boten köra och kontrollera att den svenska
        30-minuterspåminnelsen skickas en gång, även om boten startas om efter att den skickats.
11. [ ] Skriv ett vanligt meddelande om ett spontanpass i `#allmänt`, gärna med en Zwift- eller
         Meetup-länk.
12. [ ] Kontrollera att en annan medlem kan svara och reagera utan att boten skapar passkort,
         Scheduled Event eller påminnelser för förslaget.

## Pilotens utfall

Dokumentera deltagare, datum, fel och konkret återkoppling i pilotärendet. Den verkliga CK UNI-
piloten och dess exitkriterier kan inte godkännas enbart genom repositorytester.
