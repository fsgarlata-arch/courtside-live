# Courtside Live

App web installabile (PWA) per iPhone e Android: calendario, risultati e punteggio live delle partite di basket giovanile.
I genitori aprono un link e seguono la partita **senza registrarsi**. Solo i segnapunti accedono, con email e password (o con un link via email).

## Stato attuale

- Progetto Supabase **Courtside** (regione Parigi, `ncktmkytappbnqyfsmxt`) creato, schema applicato, `config.js` già compilato.
- Manca: pubblicare la cartella e impostare l'indirizzo in *Authentication → URL Configuration* (vedi sotto).
- Le email di Supabase senza SMTP personalizzato non si possono modificare e contengono solo un link: per questo l'accesso consigliato è **con password**, che funziona anche dentro l'app installata su iPhone. L'email serve solo una volta, per confermare l'account.

## File

| File | A cosa serve |
|---|---|
| `index.html`, `styles.css`, `app.js` | l'app |
| `config.js` | URL e chiave del tuo progetto Supabase (da compilare) |
| `supabase/schema.sql` | tabelle, regole di sicurezza (RLS) e realtime |
| `manifest.webmanifest`, `sw.js`, `icons/` | installazione sul telefono |

## 1. Prepara Supabase (5 minuti)

1. **SQL Editor** → incolla tutto `supabase/schema.sql` → *Run*.
2. **Project Settings → API**: copia *Project URL* e la chiave **anon / publishable** in `config.js`.
   Non usare mai la chiave `service_role`.
3. **Authentication → Sign In / Providers → Email**: deve essere attivo (lo è di default).
4. (Facoltativo, richiede un SMTP personalizzato) **Authentication → Emails → Magic link or OTP**: aggiungi il codice nel testo dell'email, così anche l'accesso con link funziona dentro l'app installata. Per esempio:
   ```html
   <h2>Il tuo codice Courtside</h2>
   <p style="font-size:28px;letter-spacing:6px"><b>{{ .Token }}</b></p>
   <p>Oppure <a href="{{ .ConfirmationURL }}">tocca qui per entrare</a>.</p>
   ```
5. **Authentication → URL Configuration**: imposta *Site URL* all'indirizzo dove pubblichi l'app (passo 2), e aggiungilo anche a *Redirect URLs*.

> L'email integrata di Supabase invia pochi messaggi l'ora: per 2-3 segnapunti basta. Se ne servono di più, configura un SMTP tuo in *Authentication → Emails → SMTP Settings*.

## 2. Pubblica l'app

Serve un hosting statico in **HTTPS** (necessario per installarla sul telefono). Il più semplice:

- **Netlify Drop**: vai su app.netlify.com/drop e trascina la cartella `app`. Ottieni subito un indirizzo `https://…netlify.app`.
- In alternativa: Vercel, Cloudflare Pages o GitHub Pages (basta caricare la cartella così com'è, non c'è build).

Dopo la pubblicazione, rimetti l'indirizzo in *Site URL* su Supabase (passo 1.5).

## 3. Primo utilizzo

1. Apri l'app → **Segnapunti** → email e una password → **Crea account**. Conferma l'indirizzo dal link nell'email, poi torna nell'app e tocca **Entra**.
2. **Imposta squadra**: nome, logo (con ritaglio), colore, categoria, roster facoltativo, e l'indirizzo breve (es. `varese-u13`).
3. **Invita i genitori**: il pulsante condivide il link `https://tuo-sito/?squadra=varese-u13` su WhatsApp o dove preferisci.
4. Altri segnapunti: in **Squadra → Segnapunti** aggiungi la loro email. Creano il loro account con password come hai fatto tu.

## Installazione sul telefono

- **iPhone (Safari)**: Condividi → *Aggiungi alla schermata Home*.
- **Android (Chrome)**: compare il pulsante *Installa* nell'app, oppure menu ⋮ → *Installa app*.

## Note tecniche

- Lettura pubblica e scrittura riservata sono garantite da RLS: anche con la chiave anon nessuno può modificare dati senza essere proprietario o segnapunti della squadra.
- Chiunque può creare un account e una propria squadra: non tocca la tua.
- Il punteggio arriva ai genitori tramite Supabase Realtime. Quando un telefono torna in primo piano l'app ricarica i dati, così non perde aggiornamenti.
- Ogni partita è una riga con un campo JSON (`data`) che contiene anche la cronaca azione per azione. Il punteggio si ricalcola dalla cronaca, quindi "Annulla ultima" è sempre coerente.
- Dopo una modifica ai file, incrementa `CACHE` in `sw.js` (es. `courtside-v2`) per forzare l'aggiornamento sui telefoni.
