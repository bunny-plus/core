# WebRTC cutover

The application, controller and encrypted URLs must move together. Publishing the
app alone while the backend still has the old HLS URL will fail startup. Applying
the new playback Secret to the old image has the same problem. Plan an idle window;
the frontend deployment may publish immediately when core is pushed.

Prepared in core:

- WHIP controller with H.264 baseline/Opus, bounded FIFO recovery and a patched
  FFmpeg that resets WHIP handshake state when reconnecting.
- Authenticated WHEP signaling, native browser playback and explicit session
  teardown. The permanent endpoint remains on the backend.
- No HLS dependency, HLS fallback, fixed-delay setting or recording-cleanup job.
- Unit and local WHIP integration tests, including recovery after HTTP 503.

Prepared in dotfiles:

- `secrets/cloudflare-stream-output-url.age`: new WHIP publishing credential.
- `k3s/cluster/applications/bunny-plus/bunny-plus.sops.yaml`: consolidated Secret
  with the matching private WHEP endpoint and existing registered signing key.
- Lapi's controller settings: libx264 and a 6 Mbps video ceiling.
- Workloads select their required keys from the consolidated `bunny-plus` Secret.
  The generic account API token stays encrypted for provisioning and is not
  passed to the backend; source token files are preserved.

The separate Cloudflare live input is private, with recording mode off. The old
input stays intact for rollback. Do not publish its URL or either input ID.

## Deployment order

1. Finish the current screening. Suspend Flux's `applications` Kustomization
   before publishing core so automatic image updates cannot mix old secrets and
   the new image. Capture the currently deployed image digest for rollback.
2. Commit/push core and wait for its production image. The user handles publishing.
3. In dotfiles, run `nix flake update bunny-plus` after the core commit is available.
   Set the backend image to the exact new digest and commit the prepared encrypted
   credentials, controller configuration and lock update together.
4. Apply the updated Lapi configuration so its controller uses the new WHIP
   credential and patched FFmpeg. Updating the flake lock alone does not activate
   a NixOS service. Do not start a screening until the backend cutover is ready.
5. With the backend stopped, apply the consolidated encrypted Secret and the updated
   Deployment/image together, then start it and verify `/healthz`. Resume Flux
   only after its Git configuration matches the deployed image and secrets.
6. Start a short screening. Verify private playback, elapsed time, audio,
   reconnecting, and returning to the idle clip. Verify the new live input has
   no recordings. Check/delete any final completed recordings on the old input.

The UI's elapsed time is estimated from encoder progress and may differ by the
receiver's small buffer. WebRTC latency is managed by the transport; it does not
provide the previous seekable HLS timeline or external HLS-player link.

## Rollback

Stop the screening. Restore the old backend/frontend version, old encrypted
playback URL and previous Lapi controller configuration/ingest credential as a
coordinated change. The old input and signing key are retained. Restoring only
one side will leave playback unavailable. Keep D1, Discord and cinema data as-is.
