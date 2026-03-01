/**
 * Pikafish Web Worker
 * Hosts the WASM-compiled Pikafish engine and communicates via postMessage.
 */

let Module = null;
let processCommand = null;
let initialized = false;

// IndexedDB helpers for NNUE caching
function openNNUECache() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('pikafish-cache', 1);
        request.onupgradeneeded = (e) => {
            e.target.result.createObjectStore('files');
        };
        request.onsuccess = (e) => resolve(e.target.result);
        request.onerror = (e) => reject(e.target.error);
    });
}

function getCachedNNUE(db) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction('files', 'readonly');
        const req = tx.objectStore('files').get('nnue');
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = (e) => reject(e.target.error);
    });
}

function setCachedNNUE(db, hash, data) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction('files', 'readwrite');
        tx.objectStore('files').put({ hash, data }, 'nnue');
        tx.oncomplete = () => resolve();
        tx.onerror = (e) => reject(e.target.error);
    });
}

async function loadNNUE() {
    // Fetch the server's current NNUE hash
    let serverHash = '';
    try {
        const hashResp = await fetch('/api/nnue-hash');
        const hashData = await hashResp.json();
        serverHash = hashData.hash || '';
    } catch (e) {
        self.postMessage({ type: 'status', message: 'Could not check NNUE version, downloading...' });
    }

    // Check IndexedDB cache
    let cachedData = null;
    try {
        const db = await openNNUECache();
        const cached = await getCachedNNUE(db);
        if (cached && cached.hash === serverHash && serverHash !== '') {
            cachedData = cached.data;
            self.postMessage({ type: 'status', message: 'Loading NNUE from cache...' });
            self.postMessage({ type: 'progress', loaded: cachedData.byteLength, total: cachedData.byteLength });
        }
        db.close();
    } catch (e) {
        // IndexedDB unavailable, fall through to download
    }

    if (cachedData) {
        return new Uint8Array(cachedData);
    }

    // Download with progress
    self.postMessage({ type: 'status', message: 'Downloading NNUE file...' });
    const nnueResponse = await fetch('/static/pikafish.nnue');
    if (!nnueResponse.ok) {
        throw new Error('Failed to fetch NNUE file: ' + nnueResponse.status);
    }

    const contentLength = nnueResponse.headers.get('Content-Length');
    const totalBytes = contentLength ? parseInt(contentLength, 10) : 0;

    let nnueArray;
    if (totalBytes && nnueResponse.body) {
        const reader = nnueResponse.body.getReader();
        const chunks = [];
        let receivedBytes = 0;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            receivedBytes += value.length;
            self.postMessage({ type: 'progress', loaded: receivedBytes, total: totalBytes });
        }

        nnueArray = new Uint8Array(receivedBytes);
        let offset = 0;
        for (const chunk of chunks) {
            nnueArray.set(chunk, offset);
            offset += chunk.length;
        }
    } else {
        const nnueData = await nnueResponse.arrayBuffer();
        nnueArray = new Uint8Array(nnueData);
    }

    // Store in IndexedDB for next time
    if (serverHash) {
        try {
            const db = await openNNUECache();
            await setCachedNNUE(db, serverHash, nnueArray.buffer);
            db.close();
        } catch (e) {
            // Caching failed, not critical
        }
    }

    return nnueArray;
}

self.onmessage = async function(e) {
    const msg = e.data;

    if (msg.type === 'init') {
        try {
            self.postMessage({ type: 'status', message: 'Loading WASM module...' });

            // Load the Emscripten-generated JS glue
            importScripts('/static/pikafish.js');

            self.postMessage({ type: 'status', message: 'Creating WASM instance...' });

            // Create the module with custom stdout handler
            Module = await PikafishModule({
                print: function(text) {
                    self.postMessage({ type: 'uci', data: text });
                },
                printErr: function(text) {
                    self.postMessage({ type: 'uci', data: '[stderr] ' + text });
                },
                locateFile: function(path) {
                    return '/static/' + path;
                }
            });

            // Load NNUE (from cache or download)
            const nnueArray = await loadNNUE();

            self.postMessage({ type: 'status', message: 'Initializing engine...' });
            Module.FS.writeFile('/pikafish.nnue', nnueArray);

            // Initialize the engine
            Module.ccall('init', null, [], []);

            // Set up the processCommand wrapper
            processCommand = Module.cwrap('processCommand', null, ['string']);

            // Configure engine: single thread, small hash for WASM
            processCommand('setoption name Threads value 1');
            processCommand('setoption name Hash value 32');
            processCommand('isready');

            initialized = true;
            self.postMessage({ type: 'ready' });

        } catch (error) {
            self.postMessage({ type: 'error', message: 'Init failed: ' + error.toString() + '\n' + (error.stack || '') });
        }
    }

    else if (msg.type === 'uci') {
        if (!initialized || !processCommand) {
            self.postMessage({ type: 'error', message: 'Engine not initialized' });
            return;
        }
        try {
            processCommand(msg.command);
        } catch (error) {
            self.postMessage({ type: 'error', message: 'Command error: ' + error.toString() });
        }
    }
};
