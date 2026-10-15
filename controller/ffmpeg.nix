{ffmpeg-headless}:
ffmpeg-headless.overrideAttrs (previous: {
  patches = (previous.patches or []) ++ [./ffmpeg-whip-reconnect.patch];
})
