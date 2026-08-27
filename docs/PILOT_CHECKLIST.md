# Checklista för v0.2-piloten

Använd checklistan med en `Ledare`, ett separat medlemskonto och vid behov ett gästkonto. Kör
piloten i `#zwift-rides` och `#spontan-rides` efter att kanaler och roller har konfigurerats enligt
[Discord-guiden](DISCORD_SETUP.md).

## Före testet

- [ ] Driftsätt senaste `main`, kör databasmigreringarna och registrera Discord-kommandona.
- [ ] Ställ in roll-ID:n för `Ledare` och `System Admin`; lämna dem inte tomma i piloten.
- [ ] Skapa kanalerna och behörigheterna manuellt, inklusive läsbehörighet utan skriv-/reaktionsrätt
      för `Gäst` i `#spontan-rides`.

## Acceptanstest

1. [ ] Skapa ett riktigt eller testbaserat CK UNI Club Event i Zwift.
2. [ ] Kopiera Zwift-evenemangets URL och uppgifter.
3. [ ] Kör `/ride create` som `Ledare`. Kontrollera att aktiva mallar visas med namn och att
       `Kopiera senaste passet`, `Skapa nytt pass` och `Avbryt` visas på både mobil och desktop.
4. [ ] Välj en mall, ett kopierat pass eller ett nytt pass. Ange separat datum och tid, välj passtyp
       och klistra in Zwift-länken utan särskilda fritextprefix.
5. [ ] Kontrollera previewn och rätt målkanal. Kontrollera från ett annat konto att inget publikt
       passkort eller Scheduled Event finns innan `Publicera` väljs.
6. [ ] Redigera grunduppgifter och detaljer från previewn. Kontrollera att previewn uppdateras och
       att utkastet fortfarande är privat.
7. [ ] Välj `Publicera` och kontrollera att exakt ett passkort visas i `#zwift-rides` och exakt ett
       Discord Scheduled Event skapas med rätt tid, längd och detaljer.
8. [ ] Dubbelklicka eller försök publicera samma preview igen. Kontrollera att ingen dubblett av
       ride, passkort eller Scheduled Event skapas.
9. [ ] Skapa och avbryt ett separat utkast. Kontrollera att det inte kan publiceras.
10. [ ] Välj `Jag kommer` och sedan `Kanske` från ett annat Discord-konto. Kontrollera att valet och
       räknarna uppdateras.
11. [ ] Kontrollera behörigheterna för alla fyra rollerna: `Ledare` och `System Admin` får skapa,
       redigera och ställa in; `CK UNI Rider` och `Gäst` får inte göra det.
12. [ ] Kör `/ride edit`. Kontrollera efter omladdning att databasens uppgifter, samma passkort och
       samma Scheduled Event har uppdaterats utan dubbletter.
13. [ ] Kör `/ride cancel`. Kontrollera att passkortet tydligt visar **INSTÄLLT**, knapparna är
       avstängda och Scheduled Event är borttaget/inställt.
14. [ ] Skapa ett utkast, starta om boten och fortsätt flödet. Skapa därefter ett framtida pass och
       kontrollera att passet och
       deltagarvalen finns kvar och att inga dubbletter publiceras.
15. [ ] Skapa ett testpass ungefär 35 minuter framåt. Låt boten köra och kontrollera att den svenska
         30-minuterspåminnelsen skickas en gång, även om boten startas om efter att den skickats.
16. [ ] Skriv ett vanligt meddelande om ett spontanpass i `#spontan-rides`, gärna med en Zwift- eller
         Meetup-länk.
17. [ ] Kontrollera att en annan `CK UNI Rider` kan svara och reagera utan boten, och att `Gäst` kan
         läsa men inte skriva eller reagera.

## Pilotens utfall

Dokumentera deltagare, datum, fel och konkret återkoppling i pilotärendet. Den verkliga CK UNI-
piloten och dess exitkriterier kan inte godkännas enbart genom repositorytester.
