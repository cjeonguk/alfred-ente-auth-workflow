# Ente Auth for Alfred

English | [한국어](README.ko.md)

An Alfred workflow to search, copy, and paste Ente Auth 2FA codes using the [ente CLI](https://ente.com/help/cli/).

## Usage

Search your Ente Auth codes with `ea {query}`.

- **↵** Copy the code (not saved to clipboard history)
- **⌘↵** Paste the code into the frontmost app
- **⌥↵** Open the live code view (refreshes every second; ↵ copies and ⌘↵ pastes from there too)

If a code expires in less than 3 seconds, the workflow waits for the next code before copying it.

Each code shows its issuer's icon, chosen the same way as the Ente Auth app: Ente's custom icons first, then [Simple Icons](https://simpleicons.org), falling back to a colored circle with the issuer's first letter. Icons are downloaded once on first use and cached. Icons you picked manually in the app are not available through the ente CLI, so they are not reflected.

## Requirements

- [ente CLI](https://ente.com/help/cli/) **0.4.0 or later** (tested with 0.4.5)
- Signed in to Ente Auth: `ente account login --app auth`

### ente CLI compatibility

ente CLI [0.4.0](https://github.com/ente-io/ente/releases/tag/ente-cli-v0.4.0) (2026-10-23) is a Rust rewrite with new commands. Every command and flag this workflow uses first appeared in 0.4.0, and the Auth code commands and their JSON output are unchanged through 0.4.5.

| Used by the workflow | Since |
|---|---|
| `ente auth code list --all` (JSON fields `id`, `name`, `issuer`, `accountName`, `type`) | 0.4.0 |
| `ente auth code view <id>` (JSON fields `otp`, `validUntil`) | 0.4.0 |
| Global flags `--json`, `--offline`, `--no-input`, `--account` | 0.4.0 |

The previous Go CLI (0.3.0 and earlier) is **not supported**: its only Auth command is `ente auth decrypt`, and it has none of the flags above. Running the workflow with it shows the CLI's error instead of your codes.

## Configuration (Workflow Configuration)

| Variable | Default | Description |
|---|---|---|
| `keyword` | `ea` | Search keyword |
| `ente_path` | `/opt/homebrew/bin/ente` | Path to the ente executable (Alfred does not read your shell `PATH`) |
| `ente_account` | (empty) | Account name to pass to `--account` |
| `icon_appearance` | Auto | Light or dark icon variant; Auto follows the system appearance. Match it to your Alfred theme |

## Structure

```
src/                 The Alfred workflow folder as-is
├── icon.png         Workflow icon
├── info.plist       Objects, connections, and configuration
└── ente-auth.js     JXA script (list / code / live)
scripts/
├── link.sh          Symlink src/ into Alfred's workflows folder (development)
├── update-icon-sources.sh  Pin issuer icon sources to the latest ente-io/ente main
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
- Issuer icons: follows `icon_utils.dart` in the Ente Auth app. The icon indexes and SVGs are fetched from pinned commits of ente-io/ente and its simple-icons submodule, rendered to PNG with AppKit, and cached under the workflow cache folder.

## Development

```sh
scripts/link.sh    # Link into Alfred for development
scripts/build.sh   # Build the distributable package
```

## Notice

This is an unofficial workflow and is not affiliated with or endorsed by Ente.
Ente and Ente Auth are trademarks of their respective owners.

The workflow icon is the official Ente Auth macOS icon from the [ente-io/ente](https://github.com/ente-io/ente/blob/8980b6acefa8e5b36214ecfa9dc3795b31a59464/mobile/apps/auth/assets/generation-icons/icon-macos.png) repository, resized to 256×256.

Issuer icons are downloaded at runtime from the Ente Auth custom icons and [Simple Icons](https://github.com/simple-icons/simple-icons) and are not bundled with this workflow. All brand names and logos are the property of their respective owners.
