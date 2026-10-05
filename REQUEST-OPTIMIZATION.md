# WorkMonitor request optimization

## Target architecture

- Frontend: GitHub Pages
- Backend/API: Cloudflare Worker
- Screenshots: captured locally first, then uploaded in hourly batches
- No Cloudflare Pages hosting is required for the frontend.

## Backend URL

The frontend defaults to:

`https://codesdot-workmonitor.work-nest.workers.dev`

You can override it with `VITE_BACKEND_URL`.

## Request behavior

### Employee runtime

The employee dashboard no longer performs background polling for:

- `/api/capture-settings`
- `/api/tracker-time/:employeeId/:dateKey`
- activity history polling
- other automatic dashboard refresh calls

Employee login returns the capture policy once and caches it locally.

Screenshots are stored in IndexedDB first. The browser uploader checks once per minute locally, but it does **not** call Cloudflare unless an hourly upload is actually due. During the allowed India window (08:30–20:30 IST), queued screenshots are sent in batches. A batch contains up to 50 screenshots and is capped at about 80 MB to stay below the Worker request-body limit. Outside the window, screenshots remain local.

### Admin runtime

Admin login returns the initial employees, pending approvals, capture settings, and activity summary in the login response. The admin dashboard therefore does not start a 60-second polling loop.

Explicit admin actions (approve, reject, delete, save settings, manually open history, etc.) can still make API requests because those actions require server-side changes/data.

## Important

Do not run the legacy `local-sync.js` process at the same time as the browser screenshot queue unless you intentionally want a second screenshot synchronization process. The browser queue is now the primary screenshot uploader.

## GitHub Pages

`.github/workflows/deploy.yml` builds the Vite app and deploys `dist` to GitHub Pages on every push to `main`.
