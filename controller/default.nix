{
  dejavu_fonts,
  ffmpeg-headless,
  fetchurl,
  lib,
  makeWrapper,
  mesa,
  python3,
  stdenvNoCC,
  streamlink,
}: let
  inherit (lib.meta) getExe getExe';
  ffmpeg = import ./ffmpeg.nix {
    inherit ffmpeg-headless;
    stdenv = stdenvNoCC;
  };
  testPython = python3.withPackages (ps: [ps.aiortc ps.aiohttp]);
  doviSample = fetchurl {
    url = "https://fate-suite.ffmpeg.org/mov/dovi-p5.mp4";
    hash = "sha256-Ef5Zn9d+MeJvv4VbrhzZkx358mGgp7Hc6frZsjZnfEs=";
  };
in
  stdenvNoCC.mkDerivation {
    pname = "bunny-controller";
    version = "0.1.0";
    src = ./controller.py;

    dontUnpack = true;
    nativeBuildInputs = [makeWrapper];

    installPhase =
      /*
      bash
      */
      ''
        install -D --mode=755 $src $out/libexec/bunny-controller.py
        install -D --mode=644 ${./restream.py} $out/libexec/restream.py
        install -D --mode=644 ${./jellyfin.py} $out/libexec/jellyfin.py
        makeWrapper ${getExe python3} $out/bin/bunny-controller \
          --add-flags $out/libexec/bunny-controller.py \
          --set BUNNY_FFMPEG ${getExe ffmpeg} \
          --set BUNNY_FFPROBE ${getExe' ffmpeg "ffprobe"} \
          --set BUNNY_STREAMLINK ${getExe streamlink}
      '';

    doCheck = true;
    BUNNY_TEST_DOVI_SAMPLE = doviSample;
    BUNNY_TEST_VULKAN_DRIVERS = lib.optionalString stdenvNoCC.hostPlatform.isLinux "${mesa}/share/vulkan/icd.d";
    checkPhase =
      /*
      bash
      */
      ''
        PYTHONPATH=${./.} ${getExe python3} ${./test_restream.py}
        PYTHONPATH=${./.} ${getExe python3} ${./test_jellyfin.py}
        BUNNY_TEST_FFMPEG=${getExe ffmpeg} BUNNY_TEST_FONT=${dejavu_fonts}/share/fonts/truetype/DejaVuSans.ttf PYTHONPATH=${./.} ${getExe python3} ${./test_relay.py}
        BUNNY_TEST_FFMPEG=${getExe ffmpeg} PYTHONPATH=${./.} ${getExe testPython} ${./test_webrtc.py}
      '';

    passthru = {inherit doviSample;};
    meta.mainProgram = "bunny-controller";
  }
