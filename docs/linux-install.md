# Installing Polotno on Linux

Every release on the [GitHub releases page](https://github.com/polotno-project/polotno-studio-app/releases)
has four Linux downloads, all for 64-bit x86 (x64/amd64):

| File | For | Menu entry, `.polotno` double-click, `polotno` command | Chromium sandbox on Ubuntu 24.04+ | Updates |
|---|---|---|---|---|
| `polotno-app_<version>_amd64.deb` | Ubuntu, Debian, Mint, Pop!_OS and other Debian-based systems | yes | yes | in the app, asks for your password |
| `polotno-app-<version>.x86_64.rpm` | Fedora, RHEL/Alma/Rocky, openSUSE | yes | yes | in the app, asks for your password |
| `polotno-app-<version>-x64.pacman` | Arch, Manjaro, EndeavourOS | yes | yes | in the app, asks for your password |
| `polotno-app-<version>.AppImage` | any distribution, no install needed | no (see below) | no, see [Sandbox](#sandbox) | in the app, no password |

Pick the package for your system (`.deb`, `.rpm` or `.pacman`); the AppImage
is the fallback for everything else.

## .deb (Ubuntu, Debian and derivatives)

```sh
sudo apt install ./polotno-app_<version>_amd64.deb
```

Use `apt` rather than `dpkg -i` so the dependencies get installed too. After
installing:

- **Polotno** appears in the app menu and double-clicking a `.polotno` file
  opens it.
- The `polotno` command is on the `PATH`; see the
  [headless CLI](../README.md#headless-cli):
  `polotno render design.polotno -o design.png`.
- On Ubuntu 24.04 and later the package installs an AppArmor profile
  (`/etc/apparmor.d/polotno`) so the app can use Chromium's sandbox.

**Updates:** the app checks for updates on its own. When one has downloaded,
it offers **Restart Now** or **Later** (Later installs it when you quit). The
update is installed as a package, so the system asks for your password.

**Uninstall:** `sudo apt remove polotno-app`. This removes the menu entry,
the `polotno` command and the AppArmor profile. Your designs (in
`~/Documents/Polotno` and wherever you saved them) and settings
(`~/.config/polotno-app`) stay.

## .rpm (Fedora, RHEL and derivatives, openSUSE)

```sh
sudo dnf install ./polotno-app-<version>.x86_64.rpm                             # Fedora, RHEL
sudo zypper install --allow-unsigned-rpm ./polotno-app-<version>.x86_64.rpm     # openSUSE
```

The package isn't signed yet, so zypper needs `--allow-unsigned-rpm` and dnf
may warn that it skipped the OpenPGP check. After installing you get the same
as with the `.deb`: the menu entry, `.polotno` double-click and the `polotno`
command. These systems don't restrict user namespaces, so Chromium's sandbox
works without an extra profile.

**Updates:** as with the `.deb`: **Restart Now** or **Later**, then the
system asks for your password and the app installs the update with `dnf` or
`zypper`.

**Uninstall:** `sudo dnf remove polotno-app` or
`sudo zypper remove polotno-app`. Designs and settings stay.

## .pacman (Arch and derivatives)

```sh
sudo pacman -U ./polotno-app-<version>-x64.pacman
```

pacman installs the dependencies from the repositories; if it asks which font
provider to use (`ttf-font`), any of them works. You get the menu entry,
`.polotno` double-click and the `polotno` command.

**Updates:** in the app, installed with `pacman -U` after asking for your
password.

**Uninstall:** `sudo pacman -R polotno-app`. Designs and settings stay.

## AppImage (any distribution)

```sh
chmod +x polotno-app-<version>.AppImage
./polotno-app-<version>.AppImage
```

On **Ubuntu 22.04 and later** AppImages need FUSE 2:

```sh
sudo apt install libfuse2t64   # Ubuntu 24.04+
sudo apt install libfuse2      # Ubuntu 22.04
```

Don't install the `fuse` package: it replaces `fuse3` and can break the
desktop. Without FUSE the AppImage still runs with
`./polotno-app-<version>.AppImage --appimage-extract-and-run`.

**Updates:** the app replaces the AppImage file in place, so keep it in a
folder you can write to (e.g. `~/Applications`), not one owned by root.

**Menu entry and file associations:** an AppImage doesn't install either.
[Gear Lever](https://flathub.org/apps/it.mijorus.gearlever) or
AppImageLauncher can add them for you.

**CLI:** run the AppImage with a command, for example
`./polotno-app-<version>.AppImage render design.polotno -o design.png`.

### Sandbox

Ubuntu 24.04 and later block the unprivileged user namespaces that Chromium's
sandbox needs, unless an AppArmor profile allows them for the app. An
AppImage can't install such a profile, so on these systems the AppImage starts
Polotno **without the Chromium sandbox** (like most Electron AppImages). The
sandbox limits the damage if web content inside the app is ever exploited.
If that matters to you, use the `.deb`, which installs the profile. On
Fedora, openSUSE and Arch nothing restricts user namespaces, so the AppImage
keeps the sandbox there too.
