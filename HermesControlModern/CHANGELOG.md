# Changelog

## 0.3.0-beta.1 - 2026-08-08

### Added

- Native Linux controller backend using local Bash and systemd user services.
- Windows NSIS installer and portable package targets.
- Linux AppImage and DEB package targets.
- Platform-aware bootstrap, diagnostics, settings, and shutdown behavior.
- GitHub Actions release workflow, checksums, artifact provenance, and Dependabot.
- Release verification and common credential-pattern scanning.

### Changed

- Product version and release artifact naming are now derived from one package version.
- The Electron window and package metadata use AI Framework Controller consistently.

### Security

- Local dashboard URLs are restricted to loopback hosts in the Linux backend.
- Linux renderer isolation uses context isolation, sandboxing, and no Node integration.
