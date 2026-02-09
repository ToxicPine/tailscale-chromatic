{
  description = "Tailscale Chromatic - Remote browsers on your tailnet";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-parts.url = "github:hercules-ci/flake-parts";
  };

  outputs = inputs@{ flake-parts, ... }:
    flake-parts.lib.mkFlake { inherit inputs; } {
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];

      perSystem = { pkgs, ... }: {
        devShells.default = pkgs.mkShell {
          packages = [
            pkgs.deno
            pkgs.flyctl
            pkgs.tailscale
          ];

          shellHook = ''
            echo "Tailscale Chromatic Development Environment"
            echo "  deno:      $(deno --version | head -1)"
            echo "  flyctl:    $(flyctl version 2>/dev/null | head -1 || echo 'not authenticated')"
            echo "  tailscale: $(tailscale version 2>/dev/null | head -1 || echo 'not running')"
          '';
        };

        packages.default = pkgs.stdenv.mkDerivation {
          pname = "tailscale-chromatic";
          version = "0.1.0";
          src = ./.;

          nativeBuildInputs = [ pkgs.deno ];

          buildPhase = ''
            export DENO_DIR=$(mktemp -d)
            deno compile -A --output chromatic main.ts
          '';

          installPhase = ''
            mkdir -p $out/bin
            cp chromatic $out/bin/
          '';
        };
      };
    };
}
