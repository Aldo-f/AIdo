# Building AIDO

## Automatic Builds (CI/CD)

AIDO uses GitHub Actions to automatically build binaries for all platforms:

- **On push to `main`**: Latest builds are created as artifacts
- **On tag push (v*)**: Release is created with binaries attached

### Download Pre-built Binaries

1. Go to [Releases](https://github.com/aldo-f/aido/releases)
2. Download the binary for your platform:
   - `aido` (Linux)
   - `aido` (macOS)
   - `aido.exe` (Windows)
3. Make executable (Linux/macOS): `chmod +x aido`
4. Move to PATH: `sudo mv aido /usr/local/bin/`

## Manual Build

### Prerequisites

```bash
pip install -r requirements.txt
```

### Build Single Binary

```bash
pyinstaller --onefile aido.py
```

Output: `dist/aido` (Linux/macOS) or `dist/aido.exe` (Windows)

### Build with Custom Name

```bash
pyinstaller --onefile --name aido-cli aido.py
```

### Build for Distribution

For smaller binary size:

```bash
pyinstaller --onefile --name aido --strip aido.py
```

## Platform-Specific Notes

### Linux
- Requires glibc 2.17+
- Built on Ubuntu (maximum compatibility)

### macOS
- Universal binary (Intel + Apple Silicon)
- May need: `xattr -d com.apple.quarantine aido`

### Windows
- Requires Visual C++ Redistributable
- May trigger SmartScreen (unverified publisher)

## Development

```bash
# Run directly (no build)
python aido.py serve

# Run tests
./tests/aido_test.sh
```
