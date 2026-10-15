{
  description = "bunny.plus app and relay controller";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = {
    self,
    nixpkgs,
    ...
  }: let
    systems = [
      "x86_64-linux"
      "aarch64-linux"
      "aarch64-darwin"
    ];
    forAllSystems = nixpkgs.lib.genAttrs systems;
  in {
    packages = forAllSystems (
      system: let
        pkgs = nixpkgs.legacyPackages.${system};
        controller = pkgs.callPackage ./controller {};
      in {
        bunny-controller = controller;
        default = controller;
      }
    );

    checks = forAllSystems (system: {
      bunny-controller = self.packages.${system}.bunny-controller;
    });

    nixosModules = {
      bunny-controller = ./nix/controller-service.nix;
      default = self.nixosModules.bunny-controller;
    };

    formatter = forAllSystems (system: nixpkgs.legacyPackages.${system}.alejandra);

    devShells = forAllSystems (
      system: let
        pkgs = nixpkgs.legacyPackages.${system};
        ffmpeg = pkgs.callPackage ./controller/ffmpeg.nix {};
      in {
        default = pkgs.mkShell {
          packages = [
            pkgs.nodejs_22
            pkgs.pnpm_10
            pkgs.git
            pkgs.openssl
            pkgs.python3
          ];
        };

        controller = pkgs.mkShell {
          packages = [(pkgs.python3.withPackages (ps: [ps.aiortc ps.aiohttp])) ffmpeg pkgs.streamlink];
          BUNNY_TEST_FFMPEG = nixpkgs.lib.getExe ffmpeg;
          BUNNY_TEST_FONT = "${pkgs.dejavu_fonts}/share/fonts/truetype/DejaVuSans.ttf";
          PYTHONDONTWRITEBYTECODE = "1";
        };
      }
    );
  };
}
