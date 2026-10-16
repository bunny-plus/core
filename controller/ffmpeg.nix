{
  ffmpeg-headless,
  stdenv,
}:
(ffmpeg-headless.override {withPlacebo = stdenv.hostPlatform.isLinux;}).overrideAttrs (previous: {
  patches = (previous.patches or []) ++ [./ffmpeg-whip-reconnect.patch];
})
