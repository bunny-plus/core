
import importlib.util
import json
import os
from pathlib import Path
import queue
import socket
import struct
import subprocess
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

from jellyfin import JellyfinSubtitleFiles


ASS = r"""[Script Info]
ScriptType: v4.00+
PlayResX: 320
PlayResY: 180
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,DejaVu Sans,18,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,2,10,10,10,1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,{\an7\pos(20,20)\p1}m 0 0 l 50 0 50 20 0 20
Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,Burned subtitles
"""


class RelayOutputTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.credentials = Path(self.directory.name)
        self.credentials.joinpath("control-secret").write_text("test-secret")

    def load_controller(self, **environment):
        with patch.dict(os.environ, {
            "CREDENTIALS_DIRECTORY": str(self.credentials),
            "BUNNY_FFMPEG": "ffmpeg",
            "BUNNY_FFPROBE": "ffprobe",
            "BUNNY_STREAMLINK": "streamlink",
            "BUNNY_OUTPUT_URL": "rtmp://legacy.test/bunny-plus?user=publisher",
            "BUNNY_OUTPUT_URL_CREDENTIAL": "",
            "BUNNY_OUTPUT_PASSWORD_CREDENTIAL": "0",
            "BUNNY_VIDEO_MAX_KBPS": "20000",
            **environment,
        }):
            spec = importlib.util.find_spec("controller")
            controller = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(controller)
            return controller

    def test_cloudflare_ingest_credential_and_bitrate_limit_apply_to_all_sources(self):
        output = "rtmps://live.cloudflare.com:443/live/test-private-stream-key"
        self.credentials.joinpath("output-url").write_text(output + "\n")
        controller = self.load_controller(
            BUNNY_OUTPUT_URL_CREDENTIAL="output-url", BUNNY_VIDEO_MAX_KBPS="10000",
        )
        for encoder in ("libx264", "h264_nvenc", "h264_vaapi"):
            with patch.object(controller, "VIDEO_ENCODER", encoder):
                for source in ("pipe:0", "https://torbox.test/file", "https://jellyfin.test/Videos/item/stream"):
                    for resolution, limit in ((None, 10000), (5, 6000), (6, 10000), (7, 10000)):
                        with self.subTest(encoder=encoder, source=source, resolution=resolution):
                            command = controller.relay_command(source, None, None, resolution, source != "pipe:0")
                            self.assertEqual(command[-1], output)
                            self.assertEqual(command[command.index("-maxrate:v") + 1], f"{limit}k")
                            self.assertEqual(command[command.index("-bufsize:v") + 1], f"{limit * 2}k")
                            self.assertEqual(command[command.index("-c:a") + 1], "aac")
                            self.assertEqual(command[command.index("-force_key_frames") + 1], "expr:gte(t,n_forced*2)")
                            self.assertEqual(command[command.index("-attempt_recovery") + 1], "1")
        self.assertNotIn("test-private-stream-key", json.dumps(controller.relay_status()))

    def test_vaapi_uses_explicit_device_and_uploads_after_tonemapping_and_subtitles(self):
        controller = self.load_controller(BUNNY_VIDEO_ENCODER="h264_vaapi", BUNNY_VIDEO_DEVICE="/dev/dri/renderD129")
        subtitles = JellyfinSubtitleFiles()
        self.addCleanup(subtitles.stop)
        subtitles.track.write_text(ASS)
        for transfer, dovi in ((None, False), ("smpte2084", False), ("arib-std-b67", False), (None, True)):
            command = controller.relay_command("pipe:0", None, None, 5, False, hdr_transfer=transfer, dolby_vision=dovi, subtitle_files=subtitles)
            self.assertEqual(command[command.index("-init_hw_device") + 1], "vaapi=bunny_gpu:/dev/dri/renderD129")
            self.assertEqual(command[command.index("-hwaccel") + 1], "vaapi")
            self.assertEqual(command[command.index("-pix_fmt") + 1], "vaapi")
            self.assertEqual(command[command.index("-fps_mode:v") + 1], "passthrough")
            self.assertEqual(command[command.index("-rc_mode") + 1], "CBR")
            filters = command[command.index("-vf") + 1]
            self.assertTrue(filters.endswith(",format=nv12,hwupload"))
            self.assertIn("ass=filename=", filters)

    def test_nvenc_decodes_on_nvidia_and_preserves_sdr_hdr_subtitles_and_cadence(self):
        controller = self.load_controller(BUNNY_VIDEO_ENCODER="h264_nvenc", BUNNY_VIDEO_MAX_KBPS="6000")
        subtitles = JellyfinSubtitleFiles()
        self.addCleanup(subtitles.stop)
        subtitles.track.write_text(ASS)
        for transfer, dovi in ((None, False), ("smpte2084", False), ("arib-std-b67", False), (None, True)):
            with self.subTest(transfer=transfer, dovi=dovi):
                command = controller.relay_command("pipe:0", None, None, 6, False, hdr_transfer=transfer, dolby_vision=dovi, subtitle_files=subtitles)
                for option, value in (("-hwaccel", "cuda"), ("-hwaccel_device", "0"), ("-gpu", "0"), ("-pix_fmt", "nv12"), ("-rc", "cbr"), ("-b:v", "6000k"), ("-maxrate:v", "6000k"), ("-bf", "0"), ("-forced-idr", "1"), ("-fps_mode:v", "passthrough"), ("-force_key_frames", "expr:gte(t,n_forced*2)")):
                    self.assertEqual(command[command.index(option) + 1], value)
                self.assertLess(command.index("-hwaccel"), command.index("-i"))
                filters = command[command.index("-vf") + 1]
                self.assertTrue(filters.endswith(",format=nv12"))
                self.assertIn(subtitles.video_filter(), filters)
                if dovi:
                    self.assertEqual(command[command.index("-init_hw_device") + 1], "vulkan=bunny_tone:NVIDIA")
                    self.assertEqual(command[command.index("-filter_hw_device") + 1], "bunny_tone")
                    self.assertIn("apply_dolbyvision=1", filters)
                    self.assertLess(filters.index("libplacebo"), filters.index("ass=filename="))
                else:
                    self.assertNotIn("-init_hw_device", command)
                    if transfer:
                        self.assertLess(filters.index("tonemap="), filters.index("ass=filename="))
                self.assertNotIn("-r", command)
                self.assertNotIn("-cq", command)

    def test_whip_uses_baseline_opus_and_reconnects_with_no_credentials_in_status(self):
        output = "https://customer-test.cloudflarestream.com/private-secret/webRTC/publish"
        self.credentials.joinpath("output-url").write_text(output)
        for encoder, tune in (("libx264", "zerolatency"), ("h264_nvenc", "ull")):
            with self.subTest(encoder=encoder):
                controller = self.load_controller(BUNNY_OUTPUT_URL_CREDENTIAL="output-url", BUNNY_VIDEO_ENCODER=encoder)
                command = controller.relay_command("pipe:0", None, None, 2, False)
                for option, expected in (("-fifo_format", "whip"), ("-c:a", "libopus"), ("-profile:v", "baseline"), ("-tune", tune), ("-bf", "0"), ("-attempt_recovery", "1"), ("-fps_mode:v", "passthrough"), ("-force_key_frames", "expr:gte(t,n_forced)")):
                    self.assertEqual(command[command.index(option)+1], expected)
                if encoder == "h264_nvenc":
                    self.assertEqual(command[command.index("-forced-idr") + 1], "1")
                    self.assertEqual(command[command.index("-rc") + 1], "cbr")
                    self.assertNotIn("-x264-params", command)
                    self.assertNotIn("-crf", command)
                self.assertNotIn("private-secret", json.dumps(controller.relay_status()))
        with self.assertRaisesRegex(ValueError, "libx264"):
            self.load_controller(BUNNY_OUTPUT_URL_CREDENTIAL="output-url", BUNNY_VIDEO_ENCODER="h264_vaapi")
        for path in ("/private-secret/webRTC/play", "/webRTC/publish", "/private-secret/webRTC/publish?key=secret"):
            self.credentials.joinpath("output-url").write_text("https://customer-test.cloudflarestream.com" + path)
            with self.assertRaisesRegex(ValueError, "complete WHIP"):
                self.load_controller(BUNNY_OUTPUT_URL_CREDENTIAL="output-url")

    def test_invalid_ingest_credentials_fail_without_exposing_them(self):
        for output in ("", "private-stream-key", "rtmp://live.cloudflare.com/live/private-stream-key", "rtmps://live.cloudflare.com", "rtmps://live.cloudflare.com/live/"):
            with self.subTest(output=output):
                self.credentials.joinpath("output-url").write_text(output)
                with self.assertRaisesRegex(ValueError, "complete RTMPS.*ingest URL") as error:
                    self.load_controller(BUNNY_OUTPUT_URL_CREDENTIAL="output-url")
                self.assertNotIn("private-stream-key", str(error.exception))

    def test_srt_ingest_uses_mpegts_and_keeps_passphrase_out_of_status(self):
        output = "srt://live.cloudflare.com:778?passphrase=test-private-passphrase&streamid=test-input&mode=caller"
        self.credentials.joinpath("output-url").write_text(output)
        controller = self.load_controller(BUNNY_OUTPUT_URL_CREDENTIAL="output-url")
        command = controller.relay_command("pipe:0", None, None, None, False)
        self.assertEqual(command[-1], output)
        self.assertEqual(command[command.index("-fifo_format") + 1], "mpegts")
        options = command[command.index("-format_opts") + 1]
        self.assertIn("mpegts_flags=+resend_headers", options)
        self.assertNotIn("flvflags", options)
        self.assertNotIn("-autobsf", options)
        self.assertNotIn("test-private-passphrase", json.dumps(controller.relay_status()))

    def test_srt_playback_or_incomplete_ingest_credentials_are_rejected(self):
        for query in ("", "streamid=test-input", "passphrase=test-private-passphrase", "streamid=playtest-input&passphrase=test-private-passphrase", "streamid=test-input&passphrase=short", "streamid=test-input&passphrase=test-private-passphrase&mode=listener"):
            with self.subTest(query=query):
                self.credentials.joinpath("output-url").write_text("srt://live.cloudflare.com:778?" + query)
                with self.assertRaises(ValueError) as error:
                    self.load_controller(BUNNY_OUTPUT_URL_CREDENTIAL="output-url")
                self.assertNotIn("test-private-passphrase", str(error.exception))

    def test_output_url_and_legacy_password_credentials_cannot_be_combined(self):
        self.credentials.joinpath("output-url").write_text("rtmps://live.cloudflare.com/live/private-stream-key")
        with self.assertRaisesRegex(ValueError, "cannot be combined"):
            self.load_controller(BUNNY_OUTPUT_URL_CREDENTIAL="output-url", BUNNY_OUTPUT_PASSWORD_CREDENTIAL="1")

    def test_legacy_rtmp_credentials_and_default_bitrate_remain_supported(self):
        self.credentials.joinpath("publisher-password").write_text("password&with?separators")
        controller = self.load_controller(BUNNY_OUTPUT_PASSWORD_CREDENTIAL="1")
        command = controller.relay_command("pipe:0", None, None, None, False)
        self.assertEqual(command[-1], "rtmp://legacy.test/bunny-plus?user=publisher&pass=password%26with%3Fseparators")
        self.assertEqual(command[command.index("-maxrate:v") + 1], "20000k")

    def test_invalid_bitrate_limit_fails_at_startup(self):
        for limit in ("0", "-1", "invalid"):
            with self.subTest(limit=limit), self.assertRaises(ValueError):
                self.load_controller(BUNNY_VIDEO_MAX_KBPS=limit)


@unittest.skipUnless(os.environ.get("BUNNY_TEST_FFMPEG"), "BUNNY_TEST_FFMPEG is not set")
class RelayRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        directory = Path(self.directory.name)
        (directory / "control-secret").write_text("integration-test")
        self.ffmpeg = os.environ["BUNNY_TEST_FFMPEG"]
        with patch.dict(os.environ, {
            "CREDENTIALS_DIRECTORY": str(directory),
            "BUNNY_FFMPEG": self.ffmpeg,
            "BUNNY_FFPROBE": self.ffmpeg,
            "BUNNY_STREAMLINK": "unused",
            "BUNNY_OUTPUT_PASSWORD_CREDENTIAL": "0",
            "BUNNY_VIDEO_ENCODER": "libx264",
        }):
            spec = importlib.util.find_spec("controller")
            self.controller = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(self.controller)
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            port = listener.getsockname()[1]
        self.controller.OUTPUT_URL = f"rtmp://127.0.0.1:{port}/recovery-test/stream"
        self.source = str(directory / "source.mkv")
        subprocess.run([
            self.ffmpeg, "-hide_banner", "-loglevel", "error",
            "-f", "lavfi", "-i", "testsrc2=size=160x90:rate=10",
            "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000",
            "-t", "18", "-c:v", "libx264", "-preset", "ultrafast",
            "-c:a", "aac", self.source,
        ], check=True, capture_output=True, timeout=20)

    def start(self, command):
        log = tempfile.TemporaryFile(mode="w+t")
        self.addCleanup(log.close)
        process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=log, text=True)

        def stop():
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=3)
            process.stdout.close()

        self.addCleanup(stop)
        return process, log

    def receiver(self, input_url=None):
        process, log = self.start([
            self.ffmpeg, "-hide_banner", "-loglevel", "error",
            "-progress", "pipe:1", "-stats_period", "0.1",
            "-analyzeduration", "100000", "-probesize", "100000",
            *(["-listen", "1"] if input_url is None else []),
            "-i", input_url or self.controller.OUTPUT_URL,
            "-copyts", "-f", "null", "-",
        ])
        progress = queue.Queue()

        def read():
            for line in process.stdout:
                if line.startswith("frame="):
                    progress.put(int(line.partition("=")[2]))

        threading.Thread(target=read, daemon=True).start()
        return process, log, progress

    def wait_for_frames(self, receiver):
        process, log, progress = receiver
        deadline = time.monotonic() + 12
        while time.monotonic() < deadline and process.poll() is None:
            try:
                if progress.get(timeout=0.2) >= 3:
                    return
            except queue.Empty:
                pass
        log.seek(0)
        self.fail("RTMP receiver did not decode video: " + log.read())

    def test_broken_output_reconnects_without_restarting_and_eof_still_finishes(self):
        first = self.receiver()
        files = JellyfinSubtitleFiles()
        self.addCleanup(files.stop)
        files.track.write_text(ASS)
        command = self.controller.relay_command(self.source, None, None, 1, False, subtitle_files=files)
        publisher, publisher_log = self.start(command)
        self.wait_for_frames(first)
        first[0].kill()
        first[0].wait(timeout=3)
        time.sleep(0.5)
        second = self.receiver()
        self.wait_for_frames(second)
        self.assertIsNone(publisher.poll(), "The original encoder must survive reconnecting")
        try:
            self.assertEqual(publisher.wait(timeout=25), 0)
        except subprocess.TimeoutExpired:
            self.fail("Relay kept retrying after normal input EOF")
        publisher_log.seek(0)
        self.assertNotIn("Unknown option", publisher_log.read())

    def test_encrypted_srt_output_is_decodable(self):
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as listener:
            listener.bind(("127.0.0.1", 0))
            port = listener.getsockname()[1]
        base = f"srt://127.0.0.1:{port}?passphrase=integration-test-passphrase&pbkeylen=16"
        receiver = self.receiver(base + "&mode=listener")
        self.controller.OUTPUT_URL = base + "&mode=caller&streamid=test-input"
        self.controller.OUTPUT_FORMAT = "mpegts"
        command = self.controller.relay_command(self.source, None, None, 1, False)
        command[-1:-1] = ["-t", "3"]
        publisher, log = self.start(command)
        self.wait_for_frames(receiver)
        try:
            code = publisher.wait(timeout=12)
        except subprocess.TimeoutExpired:
            self.fail("SRT publisher did not finish after input EOF")
        log.seek(0)
        self.assertEqual(code, 0, log.read())

    def test_burned_subtitles_appear_only_on_their_encoded_video_frames(self):
        files = JellyfinSubtitleFiles()
        self.addCleanup(files.stop)
        files.track.write_text(ASS)
        font = os.environ.get("BUNNY_TEST_FONT")
        if font:
            files.fonts.joinpath("font-9.ttf").write_bytes(Path(font).read_bytes())
        self.controller.OUTPUT_URL = str(Path(self.directory.name, "subtitles.flv"))
        command = self.controller.relay_command(
            "color=c=black:size=320x180:rate=10:duration=3", None, None, None, False,
            subtitle_files=files,
        )
        command.remove("-re")
        index = command.index("-i")
        command[index:index] = ["-f", "lavfi"]
        encoded = subprocess.run(command, capture_output=True, text=True, timeout=10)
        self.assertEqual(encoded.returncode, 0, encoded.stderr)
        decoded = subprocess.run([
            self.ffmpeg, "-hide_banner", "-loglevel", "error", "-i", self.controller.OUTPUT_URL,
            "-pix_fmt", "gray", "-f", "rawvideo", "-",
        ], check=True, capture_output=True, timeout=10)
        frame_size = 320 * 180
        self.assertEqual(len(decoded.stdout), 30 * frame_size)
        for index in range(30):
            frame = decoded.stdout[index * frame_size:(index + 1) * frame_size]
            self.assertEqual(max(frame) > 180, 10 <= index < 20, f"frame {index}")
            if font and 10 <= index < 20:
                self.assertGreater(max(frame[120 * 320:]), 180)

    def test_pgs_subtitles_scale_to_the_video_and_clear_at_their_end(self):
        directory = Path(self.directory.name)

        def segment(pts, kind, data=b""):
            return b"PG" + struct.pack(">IIBH", round(pts * 90_000), 0, kind, len(data)) + data

        def presentation(pts, count):
            data = struct.pack(">HHBHBBBB", 320, 180, 0x10, round(pts * 100), 0x80, 0, 0, count)
            if count:
                data += struct.pack(">HBBHH", 0, 0, 0, 20, 20)
            return segment(pts, 0x16, data)

        pixels = bytes([0, 0x80 | 50, 1, 0, 0]) * 20
        objects = struct.pack(">HBB", 0, 0, 0xc0) + (len(pixels) + 4).to_bytes(3, "big")
        objects += struct.pack(">HH", 50, 20) + pixels
        track = directory / "track.sup"
        track.write_bytes(
            presentation(1.05, 1)
            + segment(1.05, 0x17, struct.pack(">BBHHHH", 1, 0, 20, 20, 50, 20))
            + segment(1.05, 0x14, bytes([0, 0, 1, 235, 128, 128, 255]))
            + segment(1.05, 0x15, objects)
            + segment(1.05, 0x80)
            + presentation(2.05, 0)
            + segment(2.05, 0x80)
        )
        source = directory / "pgs.mkv"
        subprocess.run([
            self.ffmpeg, "-hide_banner", "-loglevel", "error",
            "-copyts",
            "-f", "lavfi", "-i", "color=c=black:size=640x360:rate=10:duration=3",
            "-i", str(track), "-map", "0:v", "-map", "1:s",
            "-c:v", "libx264", "-preset", "ultrafast", "-c:s", "copy", str(source),
        ], check=True, capture_output=True, timeout=10)
        self.controller.OUTPUT_URL = str(directory / "pgs.flv")
        command = self.controller.relay_command(
            str(source), None, None, 0, False, bitmap_subtitle_index=1,
        )
        command.remove("-re")
        encoded = subprocess.run(command, capture_output=True, text=True, timeout=10)
        self.assertEqual(encoded.returncode, 0, encoded.stderr)
        decoded = subprocess.run([
            self.ffmpeg, "-hide_banner", "-loglevel", "error", "-i", self.controller.OUTPUT_URL,
            "-pix_fmt", "gray", "-f", "rawvideo", "-",
        ], check=True, capture_output=True, timeout=10)
        width, height = 256, 144
        frame_size = width * height
        self.assertEqual(len(decoded.stdout), 30 * frame_size)
        for index in range(30):
            frame = decoded.stdout[index * frame_size:(index + 1) * frame_size]
            self.assertEqual(max(frame) > 180, 11 <= index < 21, f"frame {index}")
            if 11 <= index < 21:
                self.assertGreater(frame[20 * width + 30], 180)
                self.assertLess(frame[40 * width + 30], 30)

    def test_hdr_sources_produce_sdr_video_with_correct_colour_tags(self):
        probe = str(Path(self.ffmpeg).with_name("ffprobe"))
        for transfer in ("smpte2084", "arib-std-b67"):
            with self.subTest(transfer=transfer):
                source = str(Path(self.directory.name, transfer + ".mkv"))
                subprocess.run([
                    self.ffmpeg, "-hide_banner", "-loglevel", "error",
                    "-f", "lavfi", "-i", "testsrc2=size=160x90:rate=10",
                    "-t", "0.5", "-pix_fmt", "yuv420p10le", "-c:v", "ffv1",
                    "-color_trc", transfer, "-color_primaries", "bt2020",
                    "-colorspace", "bt2020nc", source,
                ], check=True, capture_output=True, timeout=10)
                self.controller.OUTPUT_URL = str(Path(self.directory.name, transfer + ".flv"))
                command = self.controller.relay_command(source, None, None, None, False, hdr_transfer=transfer)
                command.remove("-re")
                result = subprocess.run(command, capture_output=True, text=True, timeout=10)
                self.assertEqual(result.returncode, 0, result.stderr)
                result = subprocess.run([
                    probe, "-v", "error", "-select_streams", "v:0",
                    "-show_entries", "stream=pix_fmt,color_space,color_transfer,color_primaries",
                    "-of", "json", self.controller.OUTPUT_URL,
                ], check=True, capture_output=True, text=True, timeout=10)
                stream = json.loads(result.stdout)["streams"][0]
                self.assertEqual(stream["pix_fmt"], "yuv420p")
                for tag in ("color_space", "color_transfer", "color_primaries"):
                    self.assertEqual(stream[tag], "bt709")

    @unittest.skipUnless(os.environ.get("BUNNY_TEST_VULKAN_DRIVERS"), "Vulkan test drivers are not available")
    def test_dolby_vision_profile_five_produces_sdr_without_hdr_metadata(self):
        source = os.environ["BUNNY_TEST_DOVI_SAMPLE"]
        probe = str(Path(self.ffmpeg).with_name("ffprobe"))
        source_info = subprocess.run([
            probe, "-v", "error", "-show_streams", "-of", "json", source,
        ], check=True, capture_output=True, text=True, timeout=10)
        source_stream = json.loads(source_info.stdout)["streams"][0]
        self.assertNotIn("color_transfer", source_stream)
        dovi = next(side for side in source_stream["side_data_list"] if side["side_data_type"] == "DOVI configuration record")
        self.assertEqual(dovi["dv_profile"], 5)
        self.assertEqual(dovi["dv_bl_signal_compatibility_id"], 0)
        self.controller.OUTPUT_URL = str(Path(self.directory.name, "dovi.flv"))
        command = self.controller.relay_command(source, None, None, 0, False, dolby_vision=True)
        command.remove("-re")
        command[1:1] = ["-init_hw_device", "vulkan:llvmpipe"]
        result = subprocess.run(command, capture_output=True, text=True, timeout=30, env={
            **os.environ, "VK_DRIVER_FILES": os.environ["BUNNY_TEST_VULKAN_DRIVERS"],
        })
        self.assertEqual(result.returncode, 0, result.stderr)
        result = subprocess.run([
            probe, "-v", "error", "-show_streams", "-show_frames", "-of", "json", self.controller.OUTPUT_URL,
        ], check=True, capture_output=True, text=True, timeout=10)
        output = json.loads(result.stdout)
        stream = output["streams"][0]
        self.assertEqual((stream["width"], stream["height"]), (256, 144))
        self.assertEqual(stream["pix_fmt"], "yuv420p")
        for tag in ("color_space", "color_transfer", "color_primaries"):
            self.assertEqual(stream[tag], "bt709")
        self.assertGreater(len(output["frames"]), 0)
        for frame in output["frames"]:
            for side in frame.get("side_data_list", []):
                self.assertNotRegex(side["side_data_type"], "Dolby|DOVI|HDR|Mastering|Content light")

    def test_noisy_video_stays_within_the_bitrate_budget(self):
        self.controller.OUTPUT_URL = str(Path(self.directory.name, "bounded.flv"))
        command = self.controller.relay_command(
            "testsrc2=size=854x480:rate=24,noise=alls=60:allf=t", None, None, 3, False,
        )
        command.remove("-re")
        index = command.index("-i")
        command[index:index] = ["-f", "lavfi"]
        command[-1:-1] = ["-t", "6"]
        result = subprocess.run(command, capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stderr)
        probe = str(Path(self.ffmpeg).with_name("ffprobe"))
        result = subprocess.run([
            probe, "-v", "error", "-select_streams", "v:0", "-show_packets",
            "-show_entries", "packet=size", "-of", "json", self.controller.OUTPUT_URL,
        ], check=True, capture_output=True, text=True, timeout=10)
        packets = json.loads(result.stdout)["packets"]
        self.assertEqual(len(packets), 6 * 24)
        encoded_bits = sum(int(packet["size"]) for packet in packets) * 8
        self.assertLessEqual(encoded_bits, 1_800_000 * (6 + 2))
        self.assertGreater(encoded_bits, 1_800_000 * 3)

    def test_permanent_output_failure_eventually_exits(self):
        command = self.controller.relay_command(self.source, None, None, 1, False)
        command[command.index("-max_recovery_attempts") + 1] = "2"
        command[command.index("-recovery_wait_time") + 1] = "0.1"
        process, _ = self.start(command)
        self.assertNotEqual(process.wait(timeout=12), 0)


if __name__ == "__main__":
    unittest.main()
