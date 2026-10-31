# AI Framework Controller

Desktop control center for local Hermes profiles and OpenClaw agents.

## Downloads

Official releases provide:

- Windows 11 x64 installer (`Setup.exe`)
- Windows 11 x64 portable executable (`Portable.exe`)
- Linux x64 AppImage
- Debian/Ubuntu x64 DEB package
- SHA-256 checksums and GitHub build provenance

Use only assets attached to the repository's GitHub Releases page.

## Requirements

### Windows

- Windows 11 x64
- WSL2 with a Linux distribution such as Ubuntu
- Hermes installed inside WSL and available on `PATH`
- Optional: OpenClaw installed inside the same WSL distribution
- `systemd --user` services for gateway control

### Linux

- A modern x64 desktop Linux distribution
- `systemd --user`
- Hermes installed locally and available on `PATH`
- Optional: OpenClaw installed locally and available on `PATH`
- `tmux`, Python 3, and PyYAML for profile operations
- Desktop runtime libraries: GTK 3, NSS/NSPR, ALSA, libnotify, XSS, and Xtst

The DEB package declares both the current `t64` library names and their legacy alternatives. AppImage users on a minimal installation may need to install the desktop runtime libraries first.

## First run

Open **Settings > Details** and configure:

- Hermes Lab Root, for example `/home/me/hermes-lab`
- Hermes Home, for example `/home/me/.hermes`
- Dashboard URL, normally `http://127.0.0.1:9119`
- Windows only: WSL distribution and scheduled dashboard task

Settings are stored in Electron's per-user application data directory. They are never packaged into release artifacts.

## Local development

The Electron window loads the built renderer from `dist/`, so build it before
starting the app (and again after renderer changes):

```bash
npm ci
npm run build
npm start
```

Run the unit tests:

```bash
npm test
```

Create Windows packages on Windows:

```powershell
npm run dist:win
```

Create Linux packages on Linux:

```bash
npm run dist:linux
```

## Release process

1. Update `CHANGELOG.md` and the version in `package.json`.
2. Run `npm run build` and `npm run release:verify`.
3. Push a matching tag, for example `v0.3.0-beta.1`.
4. GitHub Actions builds Windows and Linux packages and creates a draft release.
5. Review the attached binaries, checksums, and provenance before publishing the draft.

Windows code signing is enabled automatically when the repository secrets `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD` are configured. Never commit signing certificates or passwords.

## Security and privacy

- Dashboard access is local by default.
- The controller does not bundle Hermes profiles, OpenClaw configuration, tokens, or local settings.
- Profile and framework commands run only on the selected local Windows/WSL or Linux host.
- Update checks call the GitHub Releases API.
- Release verification scans source files for common credential formats.

See [SECURITY.md](SECURITY.md) for private vulnerability reporting.

## Project status

`0.3.0-beta.1` is a public beta. Test releases on a non-critical profile before using them for unattended gateways.

## License

Copyright (c) 2026 Bum-Boo. All rights reserved. See [LICENSE](LICENSE).
