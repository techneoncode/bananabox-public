"""Headless Java bridge regression. Run npm run clion:build first."""
import os
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parents[2]
sdk = Path(os.environ.get('CLION_HOME', '/snap/clion/current'))
java_home = Path(os.environ.get('JAVA_HOME', str(sdk / 'jbr')))
plugin = root / 'clion/build/plugin/bananabox/lib/bananabox.jar'
if not plugin.is_file():
    raise SystemExit('Run npm run clion:build first.')
out = root / 'clion/build/tests/java'
out.mkdir(parents=True, exist_ok=True)
classpath = os.pathsep.join(map(str, [out, plugin, *sorted(sdk.glob('lib/**/*.jar')), *sorted(sdk.glob('plugins/**/*.jar'))]))
def run(binary, args):
    argfile = out / (binary + '.args')
    argfile.write_text('\n'.join('"' + str(arg).replace('\\', '\\\\').replace('"', '\\"') + '"' for arg in args))
    subprocess.run([str(java_home / 'bin' / binary), '@' + str(argfile)], check=True)
run('javac', ['-encoding', 'UTF-8', '--release', '21', '-proc:none', '-classpath', classpath, '-d', out, root / 'clion/test/JsonTransportTest.java'])
run('java', ['-classpath', classpath, 'eu.bananabox.clion.JsonTransportTest'])
