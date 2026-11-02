// These tests exercise real staging, checksums, backups, and failure paths.
// Xcode, Keychain, codesign, and app launch are mocked: this is not a Mac build.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {spawnSync} = require('node:child_process');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
const source = fs.existsSync(path.join(root, 'manifest.json')) ? root : path.join(root, 'extension');
const installer = path.join(root, 'macos/install.sh');
const certificate = '1234567890123456789012345678901234567890';
const mock = String.raw`
current_os() { printf 'Darwin\n'; }
user_home_directory() { printf '%s\n' "$FX_TEST_HOME"; }
run_open() { printf 'open %s\n' "$*" >> "$FX_TEST_LOG"; }
run_security() {
    case "$FX_TEST_SCENARIO" in
        no-certificate) printf '  0 valid identities found\n';;
        self-signed) printf '  1) AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA "Self Signed: Developer"\n';;
        distribution) printf '  1) AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA "Apple Distribution: Test"\n';;
        multiple) printf '  1) 1234567890123456789012345678901234567890 "Apple Development: One"\n  2) AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA "Apple Development: Two"\n';;
        *) printf '  1) 1234567890123456789012345678901234567890 "Apple Development: Local Test (ABCDEFGHIJ)"\n';;
    esac
}
run_xcrun() {
    if [[ "$1" == --find ]]; then
        [[ "$FX_TEST_SCENARIO" != no-packager || "$2" == xcodebuild ]] || return 1
        [[ "$FX_TEST_SCENARIO" != legacy || "$2" != safari-web-extension-packager ]] || return 1
        return 0
    fi
    printf 'packager %s\n' "$1" >> "$FX_TEST_LOG"
    if [[ "$FX_TEST_SCENARIO" == packager-failure ]]; then printf 'simulated packaging error\n' >&2; return 1; fi
    local directory=''
    while (( $# )); do
        if [[ "$1" == --project-location ]]; then directory="$2"; shift; fi
        shift
    done
    mkdir -p "$directory/YouTube FX/YouTube FX.xcodeproj"
}
run_xcodebuild() {
    if [[ "$1" == -version ]]; then
        [[ "$FX_TEST_SCENARIO" != no-xcode ]] || return 1
        printf 'Xcode Test\n'; return 0
    fi
    if [[ "$1" == -list ]]; then
        printf '{"project":{"schemes":["YouTube FX Extension","YouTube FX (macOS)"]}}\n'; return 0
    fi
    printf 'build %s\n' "$*" >> "$FX_TEST_LOG"
    if [[ "$FX_TEST_SCENARIO" == build-failure ]]; then printf 'simulated compiler error\n' >&2; return 1; fi
    local directory='' app=''
    while (( $# )); do
        if [[ "$1" == -derivedDataPath ]]; then directory="$2"; shift; fi
        shift
    done
    app="$directory/Build/Products/Release/YouTube FX.app"
    mkdir -p "$app/Contents/PlugIns/YouTube FX Extension.appex/Contents/Resources"
    printf 'local.youtubefx.safari\n' > "$app/Contents/Info.plist"
    printf 'local.youtubefx.safari.Extension\n' > "$app/Contents/PlugIns/YouTube FX Extension.appex/Contents/Info.plist"
    cp -R "$build_dir/Extension/." "$app/Contents/PlugIns/YouTube FX Extension.appex/Contents/Resources/"
}
scheme_value() {
    case "$2" in
        0) printf 'YouTube FX Extension\n';;
        1) printf 'YouTube FX (macOS)\n';;
        *) return 1;;
    esac
}
plist_value() {
    if [[ "$2" == NSExtension:NSExtensionPointIdentifier ]]; then
        if [[ "$FX_TEST_SCENARIO" == wrong-extension ]]; then printf 'unexpected.extension\n'; else printf 'com.apple.Safari.web-extension\n'; fi
    else cat "$1"; fi
}
run_codesign() {
    printf 'codesign %s\n' "$*" >> "$FX_TEST_LOG"
    local target
    for target in "$@"; do :; done
    case "$1" in
        --force) printf '%s\n' "$selected_identity" > "$target/test-signature";;
        --verify)
            [[ "$FX_TEST_SCENARIO" != invalid-signature ]] || return 1
            [[ -f "$target/test-signature" ]] || return 1
            [[ "$FX_TEST_SCENARIO" != copy-verification || "$target" != *YouTubeFX-install.* ]] || return 1
            ;;
        --display) printf 'Authority=Apple Development: Local Test\nTeamIdentifier=ABCDEFGHIJ\n';;
    esac
}
run_ditto() {
    [[ "$FX_TEST_SCENARIO" != copy-failure ]] || return 1
    mkdir -p "$2"
    cp -R "$1/." "$2/"
}
`;

function fixture(t, scenario = 'success') {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "youtube fx ' install "));
    t.after(() => fs.rmSync(dir, {recursive:true, force:true}));
    const pkg = path.join(dir, 'package with spaces');
    const home = path.join(dir, 'user home');
    const log = path.join(dir, 'calls.txt');
    fs.mkdirSync(pkg, {recursive:true});
    fs.mkdirSync(home);
    fs.cpSync(path.join(root, 'macos'), path.join(pkg, 'macos'), {recursive:true});
    const checksums = fs.readFileSync(path.join(root, 'macos/extension-files.sha256'), 'utf8');
    for (const line of checksums.trim().split('\n')) {
        const relative = line.slice(66);
        fs.mkdirSync(path.dirname(path.join(pkg, relative)), {recursive:true});
        fs.copyFileSync(path.join(source, relative), path.join(pkg, relative));
    }
    return {dir, pkg, home, log, scenario,
        run(extra = '') {
            return spawnSync('/bin/bash', ['-c', 'source "$1"\n' + mock + '\n' + extra + '\nmain "$2"', 'bash', installer, pkg], {
                encoding:'utf8', timeout:15000,
                env:{...process.env, FX_TEST_HOME:home, FX_TEST_LOG:log, FX_TEST_SCENARIO:this.scenario}
            });
        },
        target:path.join(home, 'Applications/YouTube FX.app')};
}

function existingApp(f, identifier = 'local.youtubefx.safari') {
    fs.mkdirSync(path.join(f.target, 'Contents'), {recursive:true});
    fs.writeFileSync(path.join(f.target, 'Contents/Info.plist'), identifier+'\n');
    fs.writeFileSync(path.join(f.target, 'previous-marker'), 'previous working app');
}

test('all staged production resources have the recorded hashes and manifest dependencies', () => {
    const lines = fs.readFileSync(path.join(root, 'macos/extension-files.sha256'), 'utf8').trim().split('\n');
    const listed = new Set();
    for (const line of lines) {
        const relative = line.slice(66);
        assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(source, relative))).digest('hex'), line.slice(0,64), relative);
        listed.add(relative);
    }
    const manifest = JSON.parse(fs.readFileSync(path.join(source,'manifest.json')));
    const resources = [...manifest.content_scripts.flatMap(x=>x.js), ...manifest.web_accessible_resources.flatMap(x=>x.resources),
        ...Object.values(manifest.icons), ...Object.values(manifest.action.default_icon), manifest.action.default_popup, 'popup.js', 'popup.css'];
    for (const file of resources) assert.ok(listed.has(file), file);
});

test('installer and entry command use valid Bash syntax', () => {
    for (const file of [installer,path.join(root,'INSTALL-ON-MAC.command')]) {
        const result = spawnSync('/bin/bash',['-n',file],{encoding:'utf8'});
        assert.equal(result.status,0,result.stderr);
    }
});

test('complete installation signs inside out, verifies Apple trust and installs unchanged resources', t => {
    const f=fixture(t), result=f.run();
    assert.equal(result.status,0,result.stderr+'\n'+result.stdout);
    const calls=fs.readFileSync(f.log,'utf8').split('\n');
    const sign=calls.filter(x=>x.startsWith('codesign --force'));
    assert.equal(sign.length,2);
    assert.match(sign[0],/\.appex$/);
    assert.match(sign[1],/YouTube FX\.app$/);
    assert.ok(sign.every(x=>x.includes('--sign '+certificate) && !x.includes('--deep')));
    assert.ok(calls.some(x=>x.includes('--verify --deep --strict -R anchor apple generic')));
    assert.ok(calls.some(x=>x.includes('-scheme YouTube FX (macOS)')));
    assert.ok(calls.at(-2).startsWith('open '+f.target));
    const resource=path.join(f.target,'Contents/PlugIns/YouTube FX Extension.appex/Contents/Resources/dsp.js');
    assert.deepEqual(fs.readFileSync(resource),fs.readFileSync(path.join(source,'dsp.js')));
    assert.match(result.stdout,/Allow unsigned extensions.*turned OFF/);
});

for (const [scenario,pattern] of [
    ['no-xcode',/full Xcode/], ['no-packager',/no Safari web-extension packager/],
    ['no-certificate',/No valid Apple Development/], ['self-signed',/No valid Apple Development/],
    ['distribution',/No valid Apple Development/], ['multiple',/choose one interactively/],
    ['packager-failure',/packager failed/], ['build-failure',/could not build/],
    ['invalid-signature',/Signing failed/], ['wrong-extension',/Unexpected native extension type/],
    ['copy-failure',/Copy verification failed/], ['copy-verification',/Copy verification failed/]
]) test(scenario+' leaves an existing installation untouched',t=>{
    const f=fixture(t,scenario); existingApp(f);
    const result=f.run();
    assert.notEqual(result.status,0);
    assert.match(result.stdout+result.stderr,pattern);
    assert.equal(fs.readFileSync(path.join(f.target,'previous-marker'),'utf8'),'previous working app');
    if (fs.existsSync(f.log)) assert.ok(!fs.readFileSync(f.log,'utf8').includes('open '));
});

test('supports the older Apple converter name',t=>{
    const f=fixture(t,'legacy'),result=f.run();
    assert.equal(result.status,0,result.stderr);
    assert.match(fs.readFileSync(f.log,'utf8'),/packager safari-web-extension-converter/);
});

test('a modified production file fails integrity checking before packaging',t=>{
    const f=fixture(t); fs.appendFileSync(path.join(f.pkg,'dsp.js'),'\n// modification\n');
    const result=f.run();
    assert.notEqual(result.status,0);
    assert.match(result.stderr,/integrity check/);
    assert.ok(!fs.existsSync(f.log));
});

test('a checksum path traversal is rejected before copying',t=>{
    const f=fixture(t);
    fs.writeFileSync(path.join(f.pkg,'macos/extension-files.sha256'),'0'.repeat(64)+'  ../outside\n');
    const result=f.run();
    assert.notEqual(result.status,0); assert.match(result.stderr,/Unsafe resource path/);
    assert.ok(!fs.existsSync(f.log));
});

test('an unrelated app at the target location is preserved',t=>{
    const f=fixture(t); existingApp(f,'another.application');
    const result=f.run();
    assert.notEqual(result.status,0); assert.match(result.stderr,/different item already exists/);
    assert.equal(fs.readFileSync(path.join(f.target,'previous-marker'),'utf8'),'previous working app');
});

test('a symbolic link at the target is rejected without changing its destination',t=>{
    const f=fixture(t),other=path.join(f.dir,'other app');
    fs.mkdirSync(path.dirname(f.target),{recursive:true}); fs.mkdirSync(other);
    fs.writeFileSync(path.join(other,'keep'),'unchanged'); fs.symlinkSync(other,f.target);
    const result=f.run();
    assert.notEqual(result.status,0); assert.match(result.stderr,/symbolic link/);
    assert.equal(fs.readFileSync(path.join(other,'keep'),'utf8'),'unchanged');
});

test('an update preserves the previous app in a backup before replacing it',t=>{
    const f=fixture(t); existingApp(f);
    const result=f.run();
    assert.equal(result.status,0,result.stderr);
    assert.ok(!fs.existsSync(path.join(f.target,'previous-marker')));
    const backups=path.join(f.home,'Library/Application Support/YouTubeFX/Backups');
    const entries=fs.readdirSync(backups);
    assert.equal(entries.length,1);
    assert.equal(fs.readFileSync(path.join(backups,entries[0],'YouTube FX.app/previous-marker'),'utf8'),'previous working app');
});
