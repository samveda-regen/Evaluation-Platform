# LiveKit webcam recording deployment

The portal starts one LiveKit Participant Egress per proctored attempt. It records the
candidate camera and microphone (`screenShare: false`) into a local MP4. Screen sharing
continues to work for live monitoring but is not part of the recording.

## Backend environment

```env
LIVEKIT_URL=wss://live.talentstaq.ai
LIVEKIT_API_KEY=your-key
LIVEKIT_API_SECRET=your-secret
LIVEKIT_EGRESS_ENABLED=true
LIVEKIT_EGRESS_WEBHOOK_URL=https://your-api-domain/api/webhooks/livekit-egress
RECORDING_DIR=/var/lib/talentstaq/recordings
```

Apply the Prisma migration and regenerate the client before restarting the backend:

```bash
cd backend
npx prisma migrate deploy
npx prisma generate
npm run build
```

## Filesystem requirement

The backend and Egress process must see the same persistent directory at the exact path
configured by `RECORDING_DIR`. If Egress is in Docker, mount the host directory at that
same path:

```yaml
volumes:
  - /var/lib/talentstaq/recordings:/var/lib/talentstaq/recordings
```

Create and permission the host directory for the Egress writer and backend reader. Do not
place recordings inside the application release directory.

## Egress request lifecycle

1. The candidate initializes proctoring and requests their existing LiveKit publish token.
2. The backend starts Participant Egress for `candidate:{attemptId}` in room
   `proctoring:{testId}:{attemptId}`.
3. Egress writes `{testId}/{attemptId}/webcam-{timestamp}.mp4` below `RECORDING_DIR`.
4. Manual submit, auto-submit, expiry, admin force-submit, or proctor-session end requests
   Egress finalization. Participant departure also stops Participant Egress.
5. The signed LiveKit webhook marks the file ready. Attempt Details also reconciles status
   with LiveKit if a webhook was missed.
6. Admin playback/download uses ten-minute, recording-scoped URLs. The stream endpoint
   supports HTTP byte ranges and checks test ownership before opening the file.

## Rollout checks

- Confirm Egress has the same Redis configuration as the LiveKit server.
- Confirm the Egress container can write a test file into `RECORDING_DIR` and the backend
  can read it.
- Ensure the public webhook URL reaches the backend without a proxy body transformation.
- Keep `VITE_LEGACY_BROWSER_RECORDING` unset/false so browser chunk uploads stay disabled.
- Run one short test, submit it, and verify the recording changes from `recording` to
  `ready`, plays with seeking, downloads, and contains no screen-share video.
