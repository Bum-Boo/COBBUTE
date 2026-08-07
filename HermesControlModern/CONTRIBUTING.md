# Contributing

1. Keep changes scoped to a single controller behavior.
2. Never commit credentials, local profile data, `.env` files, signing certificates, or user-specific paths.
3. Preserve the existing IPC boundary: renderer code must not receive direct Node.js access.
4. Validate shell inputs before interpolation.
5. Run `npm run build` and `npm run release:verify` before opening a pull request.
6. State whether Windows, Linux, or both platforms were exercised.

Release publishing and code-signing credentials remain maintainer-only operations.
