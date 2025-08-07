# Isla Journal

[![Latest Release](https://img.shields.io/github/v/release/trtslyr/isla-journal?display_name=tag&sort=semver)](https://github.com/trtslyr/isla-journal/releases/latest)

Offline, VS Code–style journal with local AI.

## Download

- Windows: download the Setup.exe from the latest release: https://github.com/trtslyr/isla-journal/releases/latest
- macOS: download the DMG from the latest release: https://github.com/trtslyr/isla-journal/releases/latest

## How we build (summary)

- Windows: built on Windows runners, native modules rebuilt with `@electron/rebuild`, packaged with Electron Forge (Squirrel installer). Output uploaded as `IslaJournal-Setup.exe`.
- macOS: built on macOS runners, native modules rebuilt with `@electron/rebuild`, packaged with Electron Forge (DMG; falls back to ZIP). Output uploaded as `IslaJournal-<arch>.dmg`.

See `.github/workflows/release-build.yml` for the complete release workflow and `.github/workflows/build-windows-clean.yml` for the Windows CI build.