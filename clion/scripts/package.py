"""Build against an installed CLion SDK, without downloading an IDE or Gradle.

CLION_HOME must point at an extracted/installed CLion (with its bundled JBR).
All generated files stay under clion/build; no IDE settings are modified.
"""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import zipfile

root = Path(__file__).resolve().parents[2]
sdk = Path(os.environ.get('CLION_HOME', '/snap/clion/current'))
if not (sdk / 'product-info.json').is_file():
    sys.exit('Set CLION_HOME to your CLion installation, then run npm run clion:build.')
product = json.loads((sdk / 'product-info.json').read_text())
if product['productCode'] != 'CL':
    sys.exit('CLION_HOME must point to CLion.')
build = root / 'clion/build'
classes = build / 'classes'
if classes.exists():
    shutil.rmtree(classes)
classes.mkdir(parents=True)
java_home = Path(os.environ.get('JAVA_HOME', str(sdk / 'jbr')))
javac = java_home / 'bin' / ('javac.exe' if os.name == 'nt' else 'javac')
jars = sorted(set(sdk.glob('lib/**/*.jar')) | set(sdk.glob('plugins/**/*.jar')) | set(sdk.glob('jbr/lib/*.jar')))
classpath = os.pathsep.join(map(str, jars))
sources = sorted((root / 'clion/src/main/java').rglob('*.java'))
# javac argfiles avoid shell expansion and operating-system argv length limits.
def quote(value):
    return '"' + str(value).replace('\\', '\\\\').replace('"', '\\"') + '"'
args = ['-encoding', 'UTF-8', '--release', '21', '-proc:none', '-classpath', classpath, '-d', str(classes), *map(str, sources)]
argfile = build / 'javac.args'
argfile.write_text('\n'.join(map(quote, args)))
subprocess.run([str(javac), '@' + str(argfile)], check=True)
plugin = build / 'plugin/bananabox'
(plugin / 'lib').mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(plugin / 'lib/bananabox.jar', 'w', zipfile.ZIP_DEFLATED) as jar:
    for directory in [classes, build / 'resources']:
        for file in sorted(directory.rglob('*')):
            if file.is_file():
                jar.write(file, file.relative_to(directory).as_posix())
version = json.loads((root / 'package.json').read_text())['version']
artifact = build / f'bananabox-clion-{version}.zip'
with zipfile.ZipFile(artifact, 'w', zipfile.ZIP_DEFLATED) as archive:
    for file in sorted(plugin.rglob('*')):
        if file.is_file():
            archive.write(file, file.relative_to(plugin.parent).as_posix())
print(f'Built {artifact}\nSDK: CLion {product["version"]} ({product["buildNumber"]})')
