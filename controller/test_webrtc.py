"""Real, offline WHIP interoperability: FFmpeg -> ICE/DTLS/SRTP -> decoded frames."""
import asyncio
import importlib.util
import os
from pathlib import Path
import subprocess
import tempfile
import threading
import unittest
from unittest.mock import patch

from aiohttp import web
from aiortc import RTCConfiguration, RTCPeerConnection, RTCSessionDescription


class WhipTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        root = Path(self.directory.name)
        (root / "control-secret").write_text("integration-test")
        self.ffmpeg = os.environ["BUNNY_TEST_FFMPEG"]
        with patch.dict(os.environ, {
            "CREDENTIALS_DIRECTORY": str(root), "BUNNY_FFMPEG": self.ffmpeg,
            "BUNNY_FFPROBE": self.ffmpeg, "BUNNY_STREAMLINK": "unused",
            "BUNNY_OUTPUT_URL_CREDENTIAL": "", "BUNNY_OUTPUT_PASSWORD_CREDENTIAL": "0",
            "BUNNY_VIDEO_ENCODER": "libx264",
        }):
            spec = importlib.util.find_spec("controller")
            self.controller = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(self.controller)
        self.frames = {"audio": 0, "video": 0}
        self.audio_timing = []
        self.video_timing = []
        # Nix sandboxes expose only loopback, which aioice normally filters out.
        # Keep this fixture local even on a host with public network interfaces.
        addresses = patch("aioice.ice.get_host_addresses", return_value=["127.0.0.1"])
        addresses.start()
        self.addCleanup(addresses.stop)
        self.requests = 0
        self.deletes = 0
        self.reject_first = False
        self.disconnect_first = False
        self.peers = set()
        self.tasks = set()
        self.loop = asyncio.new_event_loop()
        self.thread = threading.Thread(target=self.loop.run_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.shutdown)
        self.port = asyncio.run_coroutine_threadsafe(self.start_server(), self.loop).result(10)
        self.controller.OUTPUT_URL = f"http://127.0.0.1:{self.port}/publish"
        self.controller.OUTPUT_FORMAT = "whip"
        self.source = str(root / "source.mkv")
        self.make_source()

    def make_source(self, audio_codec="aac", frame_rate="30"):
        subprocess.run([
            self.ffmpeg, "-y", "-hide_banner", "-loglevel", "error",
            "-f", "lavfi", "-i", f"testsrc2=size=160x90:rate={frame_rate}",
            "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000",
            "-t", "8", "-c:v", "libx264", "-preset", "ultrafast",
            "-c:a", audio_codec, "-strict", "-2",
            *(["-bsf:a", "setts=ts=TS-mod(N\\,2)*0.001/TB"]
              if audio_codec == "dca" else []),
            self.source,
        ], capture_output=True, check=True, timeout=20)

    async def start_server(self):
        async def receive(track, peer):
            while True:
                try:
                    frame = await track.recv()
                    self.frames[track.kind] += 1
                    if track.kind == "audio":
                        self.audio_timing.append((frame.pts, frame.samples))
                    else:
                        self.video_timing.append(frame.pts * frame.time_base)
                    if self.disconnect_first and track.kind == "video" and self.frames["video"] == 15:
                        self.disconnect_first = False
                        asyncio.create_task(peer.close())
                except Exception:
                    return

        async def publish(request):
            self.requests += 1
            if self.reject_first and self.requests == 1:
                return web.Response(status=503)
            peer = RTCPeerConnection(RTCConfiguration(iceServers=[]))
            self.peers.add(peer)

            @peer.on("track")
            def on_track(track):
                task = asyncio.create_task(receive(track, peer))
                self.tasks.add(task)
                task.add_done_callback(self.tasks.discard)

            await peer.setRemoteDescription(RTCSessionDescription(sdp=await request.text(), type="offer"))
            await peer.setLocalDescription(await peer.createAnswer())
            return web.Response(status=201, text=peer.localDescription.sdp,
                                content_type="application/sdp", headers={"Location": "/session"})

        async def stop(request):
            self.deletes += 1
            await asyncio.gather(*(peer.close() for peer in self.peers))
            return web.Response(status=204)

        app = web.Application()
        app.router.add_post("/publish", publish)
        app.router.add_delete("/session", stop)
        self.runner = web.AppRunner(app)
        await self.runner.setup()
        site = web.TCPSite(self.runner, "127.0.0.1", 0)
        await site.start()
        return site._server.sockets[0].getsockname()[1]

    def shutdown(self):
        async def close():
            await asyncio.gather(*(peer.close() for peer in self.peers))
            if hasattr(self, "runner"):
                await self.runner.cleanup()
            for task in self.tasks:
                task.cancel()
            await asyncio.gather(*self.tasks, return_exceptions=True)
        asyncio.run_coroutine_threadsafe(close(), self.loop).result(10)
        self.loop.call_soon_threadsafe(self.loop.stop)
        self.thread.join(5)
        self.loop.close()

    def publish(self):
        command = self.controller.relay_command(self.source, None, None, 1, False)
        result = subprocess.run(command, capture_output=True, text=True, timeout=25)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertGreater(self.frames["video"], 15, result.stderr)
        self.assertGreater(self.frames["audio"], 15, result.stderr)
        self.assertGreaterEqual(self.deletes, 1, "WHIP resource must be deleted at EOF")

    def test_whip_decodes_audio_video_and_closes_the_resource(self):
        self.publish()
        self.assertEqual(self.requests, 1)

    def test_dts_in_matroska_has_a_continuous_opus_sample_clock(self):
        # DTS frames span 10 2/3 ms. Model a source with millisecond timestamps
        # and 1 ms jitter; passing it through to RTP makes browsers discard audio.
        self.make_source("dca")
        self.publish()
        self.assertGreater(len(self.audio_timing), 100)
        for (pts, samples), (next_pts, _) in zip(self.audio_timing, self.audio_timing[1:]):
            self.assertEqual(next_pts - pts, samples, "Opus frames must not overlap or leave gaps")

    def test_film_keeps_its_source_frame_cadence_with_eac3_audio(self):
        self.make_source("eac3", "24000/1001")
        self.publish()
        self.assertGreater(len(self.video_timing), 100)
        for previous, current in zip(self.video_timing, self.video_timing[1:]):
            self.assertAlmostEqual(float(current - previous), 1001 / 24000, delta=0.001)

    def test_encoder_recovers_when_the_initial_publish_is_temporarily_unavailable(self):
        self.reject_first = True
        self.publish()
        self.assertGreaterEqual(self.requests, 2)

    def test_encoder_recovers_after_a_connected_peer_disconnects(self):
        self.disconnect_first = True
        self.publish()
        self.assertGreaterEqual(self.requests, 2)
        self.assertGreater(self.frames["video"], 30)


if __name__ == "__main__":
    unittest.main()
