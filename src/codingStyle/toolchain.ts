import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { resolveExecutable } from './invocation';

/**
 * Immutable release, never a moving 'latest' URL. Assets are verified before
 * execution.
 */
export const FORMATTER_RELEASE = '2026.09.01-5fb8802d';
const REPOSITORY = 'cpp-linter/clang-tools-static-binaries';
const MAX_BINARY = 32 * 1024 * 1024;
const RETRY_DELAY_MS = 60_000;
const LOCAL_FORMATTERS = [
    'clang-format',
    ...[21, 20, 19, 18, 17, 16, 15, 14]
        .map(version => `clang-format-${version}`),
];

export function formatterAsset(
    platform: string = process.platform,
    arch: string = process.arch,
): string {
    const os = { linux: 'linux', darwin: 'macos', win32: 'windows' }[platform];
    const cpu = { x64: 'amd64', arm64: 'arm64' }[arch];
    if (!os || !cpu) {
        throw new Error(`Automatic formatter unavailable for ${platform}/${arch}`);
    }

    return `clang-format-21_${os}-${cpu}${platform === 'win32' ? '.exe' : ''}`;
}

async function supported(executable: string): Promise<boolean> {
    return new Promise(resolve => {
        execFile(executable, ['--version'], {
            timeout: 1500,
            maxBuffer: 4096,
            windowsHide: true,
        }, (error, stdout) => {
            const match =
                /(?:clang-format|clang format) version (\d+)/i.exec(stdout);
            const version = Number(match?.[1]);
            resolve(!error && version >= 14 && version <= 21);
        });
    });
}

export class FormatterToolchain {
    private readonly ready = new Map<string, string>();
    private readonly pending = new Map<string, Promise<string>>();
    private readonly retryAfter = new Map<string, number>();
    private readonly controller = new AbortController();

    constructor(
        private readonly storage: string,
        private readonly log: (text: string) => void,
        private readonly fetcher: typeof fetch = fetch,
    ) {}

    peek(configured: string): string | undefined {
        return this.ready.get(configured);
    }

    prepare(configured: string): Promise<string> {
        const ready = this.ready.get(configured);
        if (ready) return Promise.resolve(ready);

        const pending = this.pending.get(configured);
        if (pending) return pending;

        if (this.controller.signal.aborted
            || Date.now() < (this.retryAfter.get(configured) ?? 0)) {
            return Promise.reject(
                new Error('Formatter preparation deferred; retry in one minute'),
            );
        }

        const request = this.resolve(configured)
            .then(executable => {
                this.ready.set(configured, executable);

                return executable;
            })
            .catch(error => {
                this.retryAfter.set(configured, Date.now() + RETRY_DELAY_MS);
                this.log(`Formatter preparation: ${String(error)}`);
                throw error;
            })
            .finally(() => this.pending.delete(configured));
        this.pending.set(configured, request);

        return request;
    }

    private async resolve(configured: string): Promise<string> {
        if (configured !== 'auto') {
            const executable = resolveExecutable(configured);
            if (!await supported(executable)) {
                throw new Error(
                    'Configured clang-format must be version 14 to 21',
                );
            }

            return executable;
        }

        for (const name of LOCAL_FORMATTERS) {
            try {
                const executable = resolveExecutable(name);
                if (await supported(executable)) return executable;
            } catch {}
        }

        const asset = formatterAsset();
        const directory = path.join(this.storage, 'tools', FORMATTER_RELEASE);
        const destination = path.join(directory, asset);
        if (await verifiedInstallation(destination)) return destination;

        this.log(
            'Preparing the coding-style formatter automatically (one-time download)…',
        );
        const executable = await installFormatter(
            directory,
            asset,
            this.fetcher,
            this.controller.signal,
        );
        if (!await supported(executable)) {
            throw new Error('Downloaded formatter cannot run on this system');
        }
        this.log('Coding-style formatter ready.');

        return executable;
    }

    dispose(): void {
        this.controller.abort();
        this.ready.clear();
    }
}

async function verifiedInstallation(executable: string): Promise<boolean> {
    try {
        const digest = (
            await fs.promises.readFile(`${executable}.sha256`, 'utf8')
        ).trim();
        const bytes = await fs.promises.readFile(executable);

        return bytes.length <= MAX_BINARY && /^[a-f0-9]{64}$/.test(digest)
            && crypto.createHash('sha256').update(bytes).digest('hex')
                === digest
            && await supported(executable);
    } catch {
        return false;
    }
}

async function readBounded(response: Response, limit: number): Promise<Buffer> {
    if (!response.ok || !response.body) {
        throw new Error(`Formatter download failed: HTTP ${response.status}`);
    }
    if (Number(response.headers.get('content-length') ?? 0) > limit) {
        throw new Error('Formatter download too large');
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            size += value.length;
            if (size > limit) {
                throw new Error('Formatter download too large');
            }
            chunks.push(value);
        }
    } finally {
        await reader.cancel();
    }

    return Buffer.concat(chunks);
}

export async function installFormatter(
    directory: string,
    assetName: string,
    fetcher: typeof fetch = fetch,
    signal?: AbortSignal,
): Promise<string> {
    if (!/^clang-format-21_(?:linux|macos|windows)-(?:amd64|arm64)(?:\.exe)?$/
        .test(assetName)) {
        throw new Error('Invalid formatter asset');
    }

    const timeout = AbortSignal.timeout(60_000);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const request = {
        signal: combined,
        headers: {
            'User-Agent': 'Banana-Lens',
            Accept: 'application/vnd.github+json',
        },
    };

    const releaseURL = `https://api.github.com/repos/${REPOSITORY}/releases/tags/${FORMATTER_RELEASE}`;
    const response = await fetcher(releaseURL, request);
    const metadataBytes = await readBounded(response, 2 * 1024 * 1024);
    const metadata = JSON.parse(metadataBytes.toString('utf8'));
    if (metadata.tag_name !== FORMATTER_RELEASE
        || metadata.immutable !== true) {
        throw new Error('Unexpected formatter release metadata');
    }

    const asset = metadata.assets?.find(
        (item: { name: string }) => item.name === assetName,
    );
    const expectedURL = `https://github.com/${REPOSITORY}/releases/download/${FORMATTER_RELEASE}/${assetName}`;
    if (!asset
        || asset.browser_download_url !== expectedURL
        || !/^sha256:[a-f0-9]{64}$/.test(asset.digest)) {
        throw new Error(
            'Formatter asset or SHA-256 checksum missing from the pinned release',
        );
    }

    const bytes = await readBounded(
        await fetcher(expectedURL, { signal: combined }),
        MAX_BINARY,
    );
    const digest = crypto.createHash('sha256').update(bytes).digest('hex');
    if (`sha256:${digest}` !== asset.digest) {
        throw new Error('Formatter checksum mismatch');
    }
    if (combined.aborted) {
        throw new Error('Formatter download cancelled');
    }

    await fs.promises.mkdir(directory, { recursive: true });
    const destination = path.join(directory, assetName);
    const temporary = `${destination}.${crypto.randomUUID()}.tmp`;
    try {
        await fs.promises.writeFile(temporary, bytes, {
            mode: 0o755,
            flag: 'wx',
        });
        await fs.promises.rename(temporary, destination);
        await fs.promises.writeFile(`${destination}.sha256`, digest, {
            mode: 0o644,
        });
    } finally {
        await fs.promises.rm(temporary, { force: true });
    }

    return destination;
}
