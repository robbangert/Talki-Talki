# LeesMee (Netlify-ready)

LeesMee is een browserapp om tekst te laten voorlezen, slim te filteren, samen te vatten en vragen te beantwoorden.

## Wat werkt nu

- Natuurlijke AI-stemmen via Netlify Function (`/api/tts`)
- Stemtestknop voor directe controle van de AI-stem
- Betrouwbaarder starten van stem op mobiel (met veilige herstartvertraging)
- Samenvatting met één klik
- Vraag-en-antwoord op basis van de geladen tekst
- Apart menu voor `Samenvatting` en `Vragen`
- Lokale documentopslag (Free: 5 documenten, hogere plannen: meer)
- Prijspagina (`pricing.html`) met Free/Premium/Zakelijk
- Mobiel-vriendelijke lay-out en grotere tap-doelen
- Optimalisatie voor lange teksten (chunking + sampling voor analyse)
- Offline caching via service worker
- Netlify configuratie inclusief SPA fallback

## Bestandsupload

Direct ondersteund:
- `.txt`
- `.md`
- `.pdf` (tekstgebaseerde PDF)
- `.docx`
- tekstbestanden (`text/*`)

Voor ePub of scans/afbeeldings-PDF:
- gebruik OCR of converteer eerst naar DOCX/PDF met tekstlaag

## Natuurlijke stemmen aanzetten

1. Open Netlify > Site settings > Environment variables.
2. Voeg toe: `OPENAI_API_KEY` met je OpenAI API key.
3. Deploy opnieuw.
4. In de app: zet `Gebruik natuurlijke AI-stem` aan en kies AI-stem + stijl (beste kwaliteit: `Marin` of `Cedar`).

Let op:
- Als de PDF een scan/foto is zonder echte tekstlaag, kan de app die niet direct uitlezen.
- Gebruik dan OCR of converteer naar een formaat met tekstlaag.

## Deploy op Netlify

1. Maak een nieuwe site in Netlify en koppel deze map of upload de map handmatig.
2. Build command: leeg laten.
3. Publish directory: `.`
4. Deploy starten.

Netlify gebruikt automatisch:
- `netlify.toml`
- `_redirects`
