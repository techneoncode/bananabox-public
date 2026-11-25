"""Run a real CLion in a disposable profile. Does not install into the user's IDE.

Build first with npm run clion:build. Requires a graphical session and CLion license.
The test plugin only reads/writes the generated C fixture; no account/grader calls.
"""
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import tempfile
import time
import zipfile
from xml.sax.saxutils import escape

root = Path(__file__).resolve().parents[2]
sdk = Path(os.environ.get('CLION_HOME', '/snap/clion/current'))
work = Path(tempfile.mkdtemp(prefix='bananabox-clion-smoke-'))
plugin = work / 'plugins/bananabox'
shutil.copytree(root / 'clion/build/plugin/bananabox', plugin)
classes = work / 'classes'
classes.mkdir()
classpath = os.pathsep.join([str(plugin / 'lib/bananabox.jar'), *map(str, sorted(sdk.glob('lib/**/*.jar'))), *map(str, sorted(sdk.glob('plugins/**/*.jar')))])
args = ['-encoding', 'UTF-8', '--release', '21', '-proc:none', '-classpath', classpath, '-d', str(classes), str(root / 'clion/test/SmokeActivity.java')]
argfile = work / 'javac.args'
argfile.write_text('\n'.join('"' + arg.replace('\\', '\\\\').replace('"', '\\"') + '"' for arg in args))
subprocess.run([str(sdk / 'jbr/bin/javac'), '@' + str(argfile)], check=True)
jar_path = plugin / 'lib/bananabox.jar'
with zipfile.ZipFile(jar_path) as archive:
    entries = {name: archive.read(name) for name in archive.namelist()}
entries['META-INF/plugin.xml'] = entries['META-INF/plugin.xml'].replace(b'</extensions>', b'<postStartupActivity implementation="eu.bananabox.clion.SmokeActivity"/></extensions>')
for file in classes.rglob('*.class'):
    entries[file.relative_to(classes).as_posix()] = file.read_bytes()
with zipfile.ZipFile(jar_path, 'w', zipfile.ZIP_DEFLATED) as archive:
    for name, data in entries.items(): archive.writestr(name, data)
fixture = work / 'BANANABOX_PORT_TEST'
fixture.mkdir()
(fixture / 'main.c').write_text('int main(void)\n{\n    return 0;  \n}\n')
(fixture / 'CMakeLists.txt').write_text('cmake_minimum_required(VERSION 3.20)\nproject(bananabox_smoke C)\nadd_executable(smoke main.c)\n')
options = work / 'config/options'
options.mkdir(parents=True)
compiler = shutil.which('epiclang')
if not compiler:
    raise SystemExit('The graphical smoke test requires real epiclang. Fake diagnostics are reserved for headless unit tests.')
settings = json.dumps({'bananalens.compiler': compiler, 'bananalens.makeDryRun': False, 'bananabox.language': 'fr'})
# Keep the disposable profile independent of the user's OS keychain.
(options / 'security.xml').write_text('<application><component name="PasswordSafe"><option name="PROVIDER" value="MEMORY_ONLY"/></component></application>')
(options / 'bananabox.xml').write_text('<application><component name="Bananabox"><option name="settings" value="' + escape(settings, {'"': '&quot;'}) + '"/></component></application>')
properties = work / 'idea.properties'
properties.write_text('\n'.join([
    f'idea.config.path={work}/config', f'idea.system.path={work}/system', f'idea.plugins.path={work}/plugins', f'idea.log.path={work}/log',
    'idea.trust.all.projects=true', 'idea.initially.ask.config=false', 'jb.consents.confirmation.enabled=false', 'ide.show.tips.on.startup.default.value=false',
]))
vmoptions = work / 'clion.vmoptions'
base_options = (sdk / 'bin/clion64.vmoptions').read_text()
base_options = '\n'.join(line for line in base_options.splitlines() if not line.startswith('-Xmx'))
vmoptions.write_text(base_options + f'\n-Xmx1536m\n-Dbananabox.smoke.report={work}/report.json\n')
env = dict(os.environ, CLION_PROPERTIES=str(properties), CLION_VM_OPTIONS=str(vmoptions))
log = (work / 'launcher.log').open('w')
print(f'Smoke workspace: {work}', flush=True)
child = subprocess.Popen([str(sdk / 'bin/clion'), str(fixture)], env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
try:
    deadline = time.monotonic() + 120
    while time.monotonic() < deadline and child.poll() is None and not (work / 'report.json').exists():
        time.sleep(1)
    report = json.loads((work / 'report.json').read_text()) if (work / 'report.json').exists() else {'status': 'timeout', 'detail': f'See {work}/log/idea.log and launcher.log (licensing or first-run dialogs may block startup).'}
    print(json.dumps(report, indent=2), flush=True)
finally:
    if child.poll() is None:
        os.killpg(child.pid, signal.SIGTERM)
        try: child.wait(timeout=10)
        except subprocess.TimeoutExpired: os.killpg(child.pid, signal.SIGKILL)
    log.close()
raise SystemExit(0 if report['status'] == 'passed' else 1)
