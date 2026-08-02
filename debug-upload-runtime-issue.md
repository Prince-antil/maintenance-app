# Debug Session: upload-runtime-issue
- Status: OPEN
- Started: 2026-07-29
- Issue: User reported a runtime issue and asked to run the app and check it.

## Reproduction Steps
1. Start backend with `npm run dev` in `server/`.
2. Start frontend with `npm run dev -- --host 127.0.0.1 --port 5173` in `client/`.
3. Probe `http://127.0.0.1:3001/api/reports/meta`.
4. Attempt login as `Prince / Prince123`.
5. Upload a sample PDF directly to `POST /api/reports` using a valid admin JWT.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | The active server process fails to boot or crashes before handling `/api/reports`. | High | Low | Rejected: backend starts and `/api/reports/meta` returns 200. |
| B | The active upload endpoint still returns non-JSON error bodies in the runtime path being used. | Medium | Medium | Rejected locally: direct multipart upload returns `201` with JSON body. |
| C | The client is serving a stale bundle that still assumes all failed upload responses are JSON. | Medium | Medium | Inconclusive: direct API path works; browser-triggered failure not reproduced yet. |
| D | Multipart parsing fails before the route handler completes. | Medium | Low | Rejected locally: sample PDF upload succeeds through `multer`. |
| E | The visible runtime failure is actually in authentication, not upload. | High | Low | Confirmed: `Prince / Prince123` returns `{"error":"Invalid credentials"}` against the current persisted DB. |

## Log Evidence
- Backend dev server started successfully on `http://localhost:3001`.
- Frontend dev server started successfully on `http://127.0.0.1:5173/`.
- `GET /api/reports/meta` returned `200` with JSON metadata.
- `POST /api/auth/login` with `Prince / Prince123` returned `{"error":"Invalid credentials"}`.
- `POST /api/reports` with multipart form data and admin JWT returned `201 Created` and a JSON report payload for `upload-test.pdf`.

## Verification Conclusion
- The upload route itself is working in the local Express runtime.
- The currently reproducible runtime issue is the persisted admin credential mismatch in `server/maintenance.db`.
- If the user still sees an upload error in the browser, the next most likely cause is a client-side/browser-specific path rather than the API handler itself.

## Additional Frontend Finding
- The deployed blank-page error `Uncaught ReferenceError: Cannot access 'f0' before initialization` was traced to `client/src/store.js`.
- Root cause: the store initialized `energy: loadLS(KEYS.energy, []).map(normalizeEnergyRecord)` before `normalizeEnergyRecord` was declared, which minified into a TDZ failure in the production bundle.
- Fix applied: moved the helper block (`uid`, `now`, `normalizeText`, `toIso`, `normalizeEnergyRecord`) above the initial `state` declaration.
- Verification: `npm run build` completed successfully and produced a new bundle `dist/assets/index-CO-lHRmF.js`.
