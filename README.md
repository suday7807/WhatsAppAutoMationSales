# WA Outreach

A personal WhatsApp outreach tool for local businesses found on Google Maps. For each lead it sends:

1. a short intro message, picked from several variations (spintax + name),
2. a link to a demo website for that business's category,
3. two screenshots of that demo site.

Sending is slow on purpose: random gaps between people, breaks, a daily cap and fixed sending hours.

> ⚠️ This uses WhatsApp Web automation, which is unofficial and against WhatsApp's terms. **The number can get banned.**
> Use a separate SIM, never your main number. Warm the number up slowly (about 20 messages a day in week 1).

## Setup (first time)

1. Install **Node.js 22.5 or newer** (24 recommended; uses the built-in `node:sqlite`).
2. Open this folder in a terminal and run:
   ```
   npm install
   npm run build
   ```

## Run

Double-click **`start.bat`**, or run:

```
npm start
```

Then open **http://localhost:4000**.

- **WhatsApp** page → Connect → scan the QR code with the outreach phone (*Linked devices → Link a device*). You only scan once. After that the session is saved and reconnects on its own when the tool starts.
- Keep the terminal window open while campaigns run. Closing it stops sending. Starting again resumes from where it stopped and never sends the same part twice.
- Set Windows to **never sleep** while campaigns run: *Settings → System → Power → Screen and sleep → "When plugged in, put my device to sleep after: Never"*.

## Daily workflow

1. **Contacts** → Import → paste numbers or upload a CSV (exported from your Google Maps scraper). Set the category (e.g. `dentist`) and city, and put them in a list.
2. **Demo kits** (one time per category) → category + demo website URL + 2 homepage screenshots.
3. **Campaigns → New campaign**:
   - pick the list;
   - write 4–6 intro variations;
   - pick the demo kit;
   - set the timer and sending hours;
   - click **Start**.
4. Check **Replies** for interested people and follow up from your phone. Anyone who replies *STOP / not interested / band karo* is added to **Opt-outs** automatically and never messaged again.
5. **Overview** has the funnel, delivered/read/replied numbers, the best hour to send and an Excel export.

### Message variables

| Write | Becomes |
|---|---|
| `{{name}}` / `{{first_name}}` | Priya Sharma / Priya |
| `{{business}}`, `{{city}}`, `{{category}}` | from the contact |
| `{{name\|friend}}` | the name, or "friend" if the name is empty |
| `{Hi\|Hello\|Hey}` | one of the words, picked at random |
| `{{link}}` | the demo kit URL (link message only) |

## Where data lives

Everything is stored in `C:\Users\<you>\.wa-sales-data\`. The `db.sqlite` file, the uploaded screenshots and the WhatsApp session all live there. The folder is kept outside OneDrive on purpose, because syncing breaks the Chrome session.

Optional environment variables:

| Variable | Default | Use |
|---|---|---|
| `PORT` | `4000` | dashboard port |
| `DATA_DIR` | `~/.wa-sales-data` | data folder |
| `WA_SESSION_DIR` | `<DATA_DIR>/wa-session` | WhatsApp login folder. **Keep the path short** (under ~90 characters). Long paths make WhatsApp Web show "database error, relink your device". |
| `CHROME_PATH` | puppeteer's Chrome | use an installed Chrome/Edge instead |

## Development

```
npm run dev        # API on :4000 (auto-restart) + dashboard on http://localhost:5173
npm test           # unit + sender-engine tests
npm run typecheck
```

- `server/`: Express API, WhatsApp client (`whatsapp-web.js`), SQLite (`node:sqlite`) and the sender engine.
  - `src/engine/sender.ts` holds the queue, gaps, breaks, caps and crash-safe resume.
- `web/`: React + Tailwind dashboard.
