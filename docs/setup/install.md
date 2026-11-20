# Install the CLI

Projections ships as a single self-contained executable per platform. All it
requires is Git plus whatever toolchains your own projections invoke—it never
needs Node.js unless your project already uses it.

You can hand this prompt to your coding agent to install it for you, or follow
the steps below yourself:

```prompt Copy install prompt
Install the Projections CLI by following https://github.com/githubnext/projections/blob/main/docs/agents/install.md
```

## Download and verify

Grab the executable for your platform—along with its `.sha256` file—from
[GitHub releases](https://github.com/githubnext/projections/releases):

| Platform                               | Asset                              |
| -------------------------------------- | ---------------------------------- |
| macOS, Apple silicon                   | `gh-projections-darwin-arm64`      |
| macOS, Intel                           | `gh-projections-darwin-amd64`      |
| Linux x64 (static, any distribution)   | `gh-projections-linux-amd64`       |
| Linux arm64 (static, any distribution) | `gh-projections-linux-arm64`       |
| Windows x64                            | `gh-projections-windows-amd64.exe` |
| Windows arm64                          | `gh-projections-windows-arm64.exe` |

```sh
gh release download --repo githubnext/projections --pattern 'gh-projections-darwin-arm64*'
```

Verify the download before running it. Every release asset includes a GitHub
artifact attestation tying it back to the exact workflow run and commit that
built it, plus a `.sha256` file with its digest:

```sh
gh attestation verify gh-projections-darwin-arm64 --repo githubnext/projections
shasum -a 256 --check gh-projections-darwin-arm64.sha256      # Linux: sha256sum --check
```

On Windows (PowerShell), verify the attestation with `gh attestation verify` and
then compare the file hash against its `.sha256` file:

```powershell
gh attestation verify gh-projections-windows-amd64.exe --repo githubnext/projections
(Get-FileHash gh-projections-windows-amd64.exe).Hash.ToLower()
Get-Content gh-projections-windows-amd64.exe.sha256
```

Next, install the binary on your PATH as `projections`:

```sh
install -m 755 gh-projections-darwin-arm64 ~/.local/bin/projections
projections --version
```

On Windows, rename the executable to `projections.exe` and place it in a folder
on your `Path`. Downloading through `gh release download` also avoids the
quarantine (macOS) and internet-origin (Windows) flags that browsers attach to
downloaded binaries.

Each release also includes installer scripts (`projections-cli-installer.sh` and
`projections-cli-installer.ps1`) that fetch the platform archive
(`projections-cli-<target>.tar.xz` or `.zip`, each paired with its own
`.sha256`), verify the archive against the digest embedded in the script, and
install `projections` into `$PROJECTIONS_INSTALL_DIR` (defaulting to
`~/.projections/bin`) while adding it to PATH. They don't install an updater.
While the scripts themselves don't have `.sha256` files, they are attested like
every other asset—verify them with `gh attestation verify` and read them before
running. The gh-named executables listed above are identical to the ones inside
the archives.

## The VS Code extension

If you'd like an alternate, closer-to-the-code workflow inside VS Code instead
of—or alongside—the agent-driven Projections viewer, each release attaches a
per-platform `.vsix`. Each package bundles that platform's `projections` binary,
so you don't need the CLI on your `PATH`. The extension isn't on the Visual
Studio Marketplace yet.

| Platform             | Asset                                            |
| -------------------- | ------------------------------------------------ |
| macOS, Apple silicon | `projections-vscode-<version>-darwin-arm64.vsix` |
| macOS, Intel         | `projections-vscode-<version>-darwin-x64.vsix`   |
| Linux x64            | `projections-vscode-<version>-linux-x64.vsix`    |
| Linux arm64          | `projections-vscode-<version>-linux-arm64.vsix`  |
| Windows x64          | `projections-vscode-<version>-win32-x64.vsix`    |
| Windows arm64        | `projections-vscode-<version>-win32-arm64.vsix`  |

Download, verify, and install it the same way as the CLI:

```sh
gh release download --repo githubnext/projections --pattern 'projections-vscode-*-darwin-arm64.vsix*'
gh attestation verify projections-vscode-*-darwin-arm64.vsix --repo githubnext/projections
shasum -a 256 --check projections-vscode-*-darwin-arm64.vsix.sha256
code --install-extension projections-vscode-*-darwin-arm64.vsix   # or code-insiders
```

You can also install the `.vsix` via **Extensions: Install from VSIX…** in the
Command Palette. Because a `.vsix` doesn't self-update, repeat these steps when
upgrading to a newer release.

## As a GitHub CLI extension

If you want to invoke the CLI as `gh projections`, install the downloaded binary
as a local GitHub CLI extension from a directory named `gh-projections`
containing an executable with the same name:

```sh
mkdir -p ~/gh-projections
install -m 755 gh-projections-darwin-arm64 ~/gh-projections/gh-projections
cd ~/gh-projections && gh extension install .
gh projections --version
```

On Windows, GitHub CLI runs local extensions through Git for Windows' `sh` and
looks for a file named `gh-projections` without an extension, so place the
binary in the directory under both names:

```powershell
New-Item -ItemType Directory $HOME\gh-projections
Copy-Item gh-projections-windows-amd64.exe $HOME\gh-projections\gh-projections.exe
Copy-Item gh-projections-windows-amd64.exe $HOME\gh-projections\gh-projections
cd $HOME\gh-projections; gh extension install .
```

To upgrade a local extension, replace the binary in that directory. A
release-only companion repository, `githubnext/gh-projections`, will later
mirror these assets so `gh extension install githubnext/gh-projections` and
`gh extension upgrade projections` work directly; until then, download from the
releases page above. There is no built-in self-update command—just download a
newer release when you want to upgrade.

Run `projections licenses` at any time to print the MIT license and third-party
notices bundled in the executable.
