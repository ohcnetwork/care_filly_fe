# care_filly_fe

> AI-powered clinical documentation (Filly) plugin for the [CARE](https://github.com/ohcnetwork/care_fe) EMR.

`care_filly_fe` is a **Care Frontend plugin** that brings AI **Filly** capabilities to OHCN's EMR. A clinician records a consultation, the audio is transcribed and structured by the [Medispeak](https://medispeak.in) API, and the extracted values are automatically matched and filled into CARE questionnaire forms — saving manual data entry and letting clinicians focus on the patient.

It runs as a **Vite Module Federation remote** loaded by [`care_fe`](https://github.com/ohcnetwork/care_fe) and adds a floating microphone control that records, transcribes, and auto-fills forms.

---

## Configuring the Medispeak API URL

The browser uploads audio straight to Medispeak, so it needs the API root.
Without it, recording fails immediately — there is no fallback pipeline.

**Preferred — plugin config in CARE.** No rebuild, and it can differ per
environment. Add a `config` bag to the plugin's registration:

```json
{
  "url": "http://localhost:10122/assets/remoteEntry.js",
  "name": "care_filly_fe",
  "config": {
    "MEDISPEAK_API_URL": "https://api.medispeak.example/api/v2"
  }
}
```

care_fe publishes this to plugins as `window.__CARE_PLUGIN_RUNTIME__`, and
the value is read at call time — so changing it takes effect on reload.

**Fallback — build-time env var**, for local development:

```bash
cp .env.example .env
# set REACT_MEDISPEAK_API_URL=http://localhost:3000/api/v2
npm run build
```

> Vite bakes `REACT_*` variables in at **build time** (`envPrefix: "REACT_"`) —
> **rebuild after editing `.env`.** Editing it without rebuilding changes nothing.
> This is exactly why the plugin config above is preferred for deployments.

The plugin config wins when both are set.

The [care_filly](https://github.com/ohcnetwork/care_filly) backend plugin needs
its own `MEDISPEAK_BASE_URL` and `MEDISPEAK_API_KEY` (the account secret, which
never reaches the browser), or session creation returns 502.

---

## What it does

- **Record consultations** — a floating mic button captures the doctor–patient conversation; an in-house **client-side VAD** (Silero via `@ricky0123/vad-web`) segments speech into utterances that are uploaded to Medispeak as they finish, while recording continues.
- **Transcription** — each uploaded utterance is transcribed as it arrives; the plugin polls the session for the assembled transcript.
- **Structured extraction** — the current form's fields are sent as a Medispeak `form` output spec, so the model returns structured JSON keyed to those fields.
- **Auto-fill forms** — extracted values are fuzzy-matched to CARE questionnaire fields and written into the form, then highlighted and scrolled into view for clinician review.
- **Per-user opt-in** — Filly is hidden until the user enables it on their own settings page.

---

## How it works (in brief)

```text
care_fe (host) ──loads remoteEntry.js──▶ manifest.ts ──extends "Scribe"──▶ FillyController
                                                                        │
                                        useFilly + template-builder ◀───┘
                                                    │
              ┌─────────────────────────────────────┴──────────────────────────┐
              ▼                                                                ▼
  care_filly backend (CARE JWT)                                    Medispeak API (scoped token)
  create session + mint token                                   audio chunks, commit, poll results
```

The account secret never reaches the browser. `care_filly` creates the session
server-side and mints a short-lived, session-scoped token; everything after
that goes directly from the browser to Medispeak.

1. `care_fe` loads this plugin as a federated remote and renders `FillyController` on questionnaire forms.
2. On record, the plugin asks the `care_filly` backend for a session + scoped token.
3. The **VAD recorder** segments speech and uploads each utterance straight to Medispeak.
4. On stop, a final silence marker is uploaded, the session is committed, and the plugin polls until results are ready.
5. Extracted values are **fuzzy-matched** to question labels and written into CARE form responses, then **highlighted and scrolled into view** for review.

---

## Usage flow

Filly is gated two ways: the `can_use_filly` facility permission (granted by
role, enforced by the backend) and the user's own opt-in.

1. **User: enable Filly from the user menu.** From their own user menu, the
   user opens **Filly** (`/facility/:facilityId/users/:user/filly`), which
   shows the **Enable Filly** toggle. It is off by default.

   The flag is stored on CARE core's `User.preferences` under the `filly`
   key — there is no plugin-side preference model.

2. **Use it.** The floating **Filly** button appears on questionnaire forms
   for that user.

### Moving the Filly button

The floating button can be **dragged** anywhere on screen — useful when it's
sitting on top of a page's own submit button. It snaps back to a reachable
position if dragged near a screen edge.

To reset it back to its default corner:

- **Double-click / double-tap** the button,
- **Press and hold** the button for about 2 seconds (a ring fills in
  around it while held, as a touch-friendly alternative to double-tap), or
- Use the **Reset Filly position** button on the same **Filly** settings
  page used to enable it (user menu → Filly).

---

## Getting started

### Prerequisites

- **Node.js ≥ 22.9.0**
- A running **[care_fe](https://github.com/ohcnetwork/care_fe)** instance configured to load this plugin
- The **[care_filly](https://github.com/ohcnetwork/care_filly)** CARE backend plugin — auto-detected via `window.CARE_API_URL`, served under `/api/care_filly/v1`
- A **Medispeak** API root and account key (the key goes on the backend, never here)

### Setup

```bash
# 1. Configure environment (optional — see "Configuring the Medispeak API URL")
cp .env.example .env

# 2. Install dependencies
npm install

# 3. Start the dev server (build:watch + preview on port 10122)
npm start
```

`npm start` runs two processes concurrently:

| Script        | What it does                                            |
| ------------- | ------------------------------------------------------- |
| `build:watch` | Nodemon watches `src/` and runs `vite build` on changes |
| `preview`     | Serves built assets on **port 10122** with CORS enabled |

## care_fe registration

Register the plugin in care_fe via the admin panel:

```json
{
  "url": "http://localhost:10122/assets/remoteEntry.js",
  "name": "care_filly_fe",
  "config": {
    "MEDISPEAK_API_URL": "https://api.medispeak.example/api/v2"
  }
}
```

care_fe resolves the package, loads `remoteEntry.js`, and mounts `FillyController` on forms that expose the `Scribe` extension point. Anything under `config` is published to the plugin at runtime via `window.__CARE_PLUGIN_RUNTIME__`.

---

## Project structure

```text
src/
├── manifest.ts               # Plugin manifest (routes, extends, nav items)
├── routes.tsx                # User filly settings page
├── index.tsx                 # Module-federation entry + exports
├── hooks/
│   ├── useFilly.ts           # VAD recorder + Medispeak session lifecycle
│   └── useFillyPreference.ts # Per-user opt-in via CARE core User.preferences
├── components/
│   └── filly/
│       ├── FillyController.tsx     # Floating widget + form auto-fill
│       ├── FillyProfileSection.tsx # Profile opt-in section
│       └── FillySettingsPage.tsx   # User settings page
└── lib/
    ├── filly-be.ts           # care_filly backend URL (from window.CARE_API_URL)
    ├── plugin-config.ts      # Host-supplied runtime plugin config
    ├── medispeak-api.ts      # Session/token seam + direct Medispeak calls
    ├── filly-engine.ts       # VadRecorder (Silero VAD)
    ├── template-builder.ts   # Form fields → Medispeak FieldSpec[]
    ├── structured/           # Structured data matching & form fill
    └── types/filly.ts
```

---

## Scripts

- `npm start` — Build in watch mode + preview server
- `npm run build` — Production build (`vite build`)
- `npm run preview` — Serve built assets on port 10122
- `npm run lint` — Run ESLint over `src/`
- `npm run lint-fix` — Run ESLint with `--fix`
- `npm run format` — Format `src/` with Prettier
- `npm run sort-locales` — Sort `public/locale/*.json` keys

Type-check with `npx tsc -p tsconfig.app.json --noEmit`. A bare
`tsc --noEmit` is a vacuous pass — the root `tsconfig.json` is a solution
file with `files: []`.

---

## Tech stack

React 19 · TypeScript · Vite · Module Federation · TailwindCSS · Radix UI · `@ricky0123/vad-web`
