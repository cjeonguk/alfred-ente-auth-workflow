# Ente Auth for Alfred

English | [한국어](README.ko.md)

An Alfred workflow to search, copy, and paste Ente Auth 2FA codes using the [ente CLI](https://github.com/ente-io/ente/tree/main/cli).

## Usage

Search your Ente Auth codes with `ea {query}`.

- **↵** Copy the code (not saved to clipboard history)
- **⌘↵** Paste the code into the frontmost app
- **⌥↵** Open the live code view (refreshes every second; ↵ copies and ⌘↵ pastes from there too)

If a code expires in less than 3 seconds, the workflow waits for the next code before copying it.

## Requirements

Install the [ente CLI](https://github.com/ente-io/ente/tree/main/cli) and sign in with `ente account add`.

## Configuration (Workflow Configuration)

| Variable | Default | Description |
|---|---|---|
| `keyword` | `ea` | Search keyword |
| `ente_path` | `/opt/homebrew/bin/ente` | Path to the ente executable (Alfred does not read your shell `PATH`) |
| `ente_account` | (empty) | Account name to pass to `--account` |

## Structure

```
src/                 The Alfred workflow folder as-is
├── icon.png         Workflow icon
├── info.plist       Objects, connections, and configuration
└── ente-auth.js     JXA script (list / code / live)
scripts/
├── link.sh          Symlink src/ into Alfred's workflows folder (development)
└── build.sh         Package dist/ente-auth.alfredworkflow
```

Flow:

```
ea {query} ──list──▶ ↵ / ⌘↵ ──code──▶ {var:action} ─┬─ paste → paste
     │                  ▲                           ├─ error → error notification
     └─ ⌥↵ ──live (1s rerun)                        └─ copy  → copy + notification
```

- `list`: Alfred filters the output of `ente auth code list --all` (online, falling back to `--offline` on failure). Results are cached for 5 minutes with `loosereload`, so the cache is shown immediately while it refreshes in the background.
- `code`: `ente auth code view <id> --offline`. The list refresh already syncs local data, so the offline lookup is fast.
- `live`: Keeps the OTP and its expiry in Script Filter variables and calls `ente` again only when the code expires.

## Development

```sh
scripts/link.sh    # Link into Alfred for development
scripts/build.sh   # Build the distributable package
```

## Notice

This is an unofficial workflow and is not affiliated with or endorsed by Ente.
Ente and Ente Auth are trademarks of their respective owners.

The workflow icon is the official Ente Auth macOS icon from the [ente-io/ente](https://github.com/ente-io/ente/blob/8980b6acefa8e5b36214ecfa9dc3795b31a59464/mobile/apps/auth/assets/generation-icons/icon-macos.png) repository, resized to 256×256.
