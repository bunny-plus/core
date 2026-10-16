{
  config,
  lib,
  pkgs,
  ...
}: let
  cfg = config.services.bunny-controller;
in {
  options.services.bunny-controller = {
    enable = lib.mkEnableOption "the bunny.plus relay controller";

    package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.callPackage ../controller {};
      defaultText = lib.literalExpression "pkgs.callPackage ../controller { }";
      description = "The bunny-controller package to run.";
    };

    listenAddress = lib.mkOption {
      type = lib.types.str;
      default = "127.0.0.1";
      description = "Address on which the controller accepts API requests.";
    };

    port = lib.mkOption {
      type = lib.types.port;
      default = 10000;
      description = "The controller's HTTP port.";
    };

    controlSecretFile = lib.mkOption {
      type = lib.types.str;
      description = "Runtime path to the API authentication secret, loaded as a systemd credential.";
    };

    outputUrlFile = lib.mkOption {
      type = lib.types.str;
      description = "Runtime path to the complete WHIP publishing URL, loaded as a systemd credential. RTMPS/SRT remain supported for rollback.";
    };

    videoEncoder = lib.mkOption {
      type = lib.types.enum ["libx264" "h264_nvenc"];
      default = "libx264";
      description = "The FFmpeg video encoder.";
    };

    maxVideoBitrateKbps = lib.mkOption {
      type = lib.types.ints.positive;
      default = 10000;
      description = "Maximum video bitrate in kilobits per second, excluding audio.";
    };

    jellyfinHttpOrigin = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      description = "Optional trusted HTTP origin for Jellyfin on a private network.";
    };
  };

  config = lib.mkIf cfg.enable {
    hardware.graphics.enable = true;

    systemd.services.bunny-stream-controller = {
      description = "Bunny+ host stream controller";
      wantedBy = ["multi-user.target"];
      after = ["network-online.target"];
      wants = ["network-online.target"];
      unitConfig.ConditionPathExists = [cfg.controlSecretFile cfg.outputUrlFile];

      environment =
        {
          BUNNY_CONTROLLER_HOST = cfg.listenAddress;
          BUNNY_CONTROLLER_PORT = toString cfg.port;
          BUNNY_OUTPUT_URL_CREDENTIAL = "output-url";
          BUNNY_VIDEO_MAX_KBPS = toString cfg.maxVideoBitrateKbps;
          BUNNY_VIDEO_ENCODER = cfg.videoEncoder;
        }
        // lib.optionalAttrs (cfg.jellyfinHttpOrigin != null) {
          BUNNY_JELLYFIN_HTTP_ORIGIN = cfg.jellyfinHttpOrigin;
        };

      serviceConfig = {
        CapabilityBoundingSet = "";
        DeviceAllow = [
          "char-drm rw"
          "/dev/nvidia0 rw"
          "/dev/nvidiactl rw"
          "/dev/nvidia-modeset rw"
          "/dev/nvidia-uvm rw"
          "/dev/nvidia-uvm-tools rw"
          "/dev/nvidia-caps/nvidia-cap1 rw"
          "/dev/nvidia-caps/nvidia-cap2 rw"
        ];
        DevicePolicy = "closed";
        DynamicUser = true;
        ExecStart = lib.getExe cfg.package;
        LoadCredential = [
          "control-secret:${cfg.controlSecretFile}"
          "output-url:${cfg.outputUrlFile}"
        ];
        LockPersonality = true;
        NoNewPrivileges = true;
        PrivateTmp = true;
        ProtectClock = true;
        ProtectControlGroups = true;
        ProtectHome = true;
        ProtectHostname = true;
        ProtectKernelLogs = true;
        ProtectKernelModules = true;
        ProtectKernelTunables = true;
        ProtectProc = "invisible";
        ProtectSystem = "strict";
        Restart = "on-failure";
        RestartSec = 5;
        RestrictAddressFamilies = ["AF_INET" "AF_INET6" "AF_UNIX"];
        RestrictRealtime = true;
        SupplementaryGroups = ["video" "render"];
        SystemCallArchitectures = "native";
        UMask = "0077";
      };
    };
  };
}
