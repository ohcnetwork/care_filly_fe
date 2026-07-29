# care_filly_fe

> AI-powered clinical documentation (Scribe) plugin for the [CARE](https://github.com/ohcnetwork/care_fe) EMR.

`care_filly_fe` is a **Care Frontend plugin** that brings AI **Scribe** capabilities to OHCN's EMR. A clinician records a consultation, the audio is transcribed and structured by a scribe backend implementing the open **MedScribe Alliance protocol** (e.g. [care_filly](https://github.com/ohcnetwork/care_filly)), and the extracted values are automatically matched and filled into CARE questionnaire forms — saving manual data entry and letting clinicians focus on the patient.

It runs as a **Vite Module Federation remote** loaded by [`care_fe`](https://github.com/ohcnetwork/care_fe) and adds a floating microphone control that records, transcribes, and auto-fills forms.

---

## What it does

-  **Record consultations** — a floating mic button captures the doctor–patient conversation; audio is uploaded to the backend in chunks while recording.
-  **Batch transcription** — when the recording is stopped, the backend transcribes the audio and the plugin polls for the transcript via the [`med-scribe-alliance-ts-sdk`](https://www.npmjs.com/package/med-scribe-alliance-ts-sdk) (there is no live/streaming transcript during recording).
- **Structured extraction** — a dynamic AI template (built from the current form's fields) instructs the model to return structured JSON (vitals, notes, etc.).
- **Auto-fill forms** — extracted values are fuzzy-matched to CARE questionnaire fields and written into the form, then highlighted and scrolled into view for clinician review.
- **Scribe history** — past sessions (transcript, extracted values, audio) are stored server-side and can be re-applied or re-processed from the history panel.
- **Quotas & opt-in** — per-facility/per-user token quotas with admin management pages, and a per-user scribe opt-in (with TnC consent) on the profile/settings page.

---

## How it works (in brief)

```text
care_fe (host)  ──loads remoteEntry.js──▶  manifest.ts  ──extends "Scribe(care_filly)"──▶  ScribeController
                                                                                     │
                                          useScribe + template-builder ◀─────────────┘
                                                     │
                                   med-scribe-alliance-ts-sdk ──▶ Scribe backend (care_filly)
```

1. `care_fe` loads this plugin as a federated remote and renders `ScribeController` on questionnaire forms.
2. The user records a consultation; audio is uploaded in chunks to the **scribe backend** through the **MedScribe Alliance SDK**.
3. A **dynamic template** built from the current form's fields tells the AI what JSON to return.
4. When recording stops, the plugin **polls the session** until the transcript and structured results are ready.
5. Extracted values are **fuzzy-matched** to question labels and written into CARE form responses, then **highlighted and scrolled into view** for review.

---

## Usage flow

Filly is opt-in at two levels — a facility admin must first enable it for the
facility, and each user must then individually opt in before the floating
button appears for them.

1. **Admin: enable Filly for a facility.** A superuser opens the **Filly
   Quotas** admin page (`/admin/filly/quotas`) and creates/edits a quota
   entry for the facility — setting the monthly token pool (`tokens`) and the
   per-user allowance (`tokens_per_user`), and toggling **Allow Scribe** on
   for that facility.

  ![admin panel](image.png)

2. **User: gets access once their facility has a quota.** Once their
   facility has an active quota with Allow Scribe on, the user is eligible —
   they now have a monthly token allowance to use, but Filly is still hidden
   until they opt in themselves (see next step).

3. **User: enable Filly from the user menu.** From their own user menu, the
   user opens **Filly** (`/facility/:facilityId/users/:user/filly`), which
   shows the **Enable Filly** toggle.

   <!-- screenshot: user menu — "Filly" entry -->
   ![user menu](image-1.png)
   <!-- screenshot: Filly settings page — Enable Filly toggle -->
   ![Enable Filly toggle](image-2.png)

4. **User: accept the consent dialog.** Turning the toggle on opens a Terms
   & Conditions dialog; the preference is only saved as enabled once the
   user accepts. If the TnC text is later updated, the user is asked to
   re-consent.

   <!-- screenshot: TnC consent dialog -->
   ![TnC consent dialog](image-3.png)

5. **Use it.** The floating **Filly** button now appears on questionnaire
   forms for that user. Recording, transcription, and history all work
   exactly as described above.

### Moving the Filly button

The floating button can be **dragged** anywhere on screen — useful when it's
sitting on top of a page's own submit button. It snaps back to a reachable
position if dragged near a screen edge.

To reset it back to its default corner:

- **Double-click / double-tap** the button, or
- Use the **Reset Filly position** button on the same **Filly** settings
  page used to enable it (user menu → Filly).

---

## Getting started

### Prerequisites

- **Node.js ≥ 22.9.0**
- A running **[care_fe](https://github.com/ohcnetwork/care_fe)** instance configured to load this plugin
- The **[care_filly](https://github.com/ohcnetwork/care_filly)** CARE backend plugin — auto-detected via `window.CARE_API_URL`, served under `/api/care_filly/v1`

### Setup

```bash
# 1. Configure environment (optional — e.g. REACT_SCRIBE_LANGUAGES transcription hint)
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

> Vite bakes `REACT_*` variables in at **build time** — rebuild after editing `.env`.

## care_fe registration

Register the plugin in care_fe via the admin panel:

```json
{
  "url": "http://localhost:10122/assets/remoteEntry.js",
  "name": "care_filly_fe"
}
```

care_fe resolves the package, loads `remoteEntry.js`, and mounts `ScribeController` on forms that expose the `Scribe` extension point.

---

## Project structure

```text
src/
├── manifest.ts              # Plugin manifest (routes, extends, nav items)
├── routes.tsx               # Admin quota pages + user scribe settings page
├── index.tsx                # Module-federation entry + exports
├── hooks/
│   ├── useScribe.ts         # MedScribe Alliance SDK integration
│   ├── useQuota.ts          # Facility/user quota gating
│   └── useScribePreference.ts # Per-user scribe opt-in
├── components/
│   ├── admin/               # Quota management pages (superuser)
│   └── scribe/
│       ├── ScribeController.tsx   # Floating widget + form auto-fill
│       ├── HistoryPanel.tsx       # Past sessions (re-apply / re-run)
│       ├── ScribeProfileSection.tsx # Profile opt-in section
│       └── ScribeSettingsPage.tsx   # User settings page
└── lib/
    ├── scribe-be.ts         # Backend URL resolution (CARE + /api/care_filly)
    ├── template-builder.ts  # Dynamic extraction prompt from form fields
    ├── quota-api.ts         # Quota / preference API client
    ├── scribe-history.ts    # Server-side history API client
    ├── structured/          # Structured data matching & form fill
    └── types/scribe.ts
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

---

## Tech stack

React 19 · TypeScript · Vite · Module Federation · TailwindCSS · Radix UI · `med-scribe-alliance-ts-sdk`
