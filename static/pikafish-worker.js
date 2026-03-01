/**
 * Pikafish Web Worker
 * Hosts the WASM-compiled Pikafish engine and communicates via postMessage.
 */

let Module = null;
let processCommand = null;
let initialized = false;

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

            self.postMessage({ type: 'status', message: 'Downloading NNUE file...' });

            // Fetch NNUE file with progress tracking
            const nnueResponse = await fetch('/static/pikafish.nnue');
            if (!nnueResponse.ok) {
                throw new Error('Failed to fetch NNUE file: ' + nnueResponse.status);
            }

            const contentLength = nnueResponse.headers.get('Content-Length');
            const totalBytes = contentLength ? parseInt(contentLength, 10) : 0;

            let nnueArray;
            if (totalBytes && nnueResponse.body) {
                // Stream with progress
                const reader = nnueResponse.body.getReader();
                const chunks = [];
                let receivedBytes = 0;

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    chunks.push(value);
                    receivedBytes += value.length;
                    self.postMessage({
                        type: 'progress',
                        loaded: receivedBytes,
                        total: totalBytes
                    });
                }

                nnueArray = new Uint8Array(receivedBytes);
                let offset = 0;
                for (const chunk of chunks) {
                    nnueArray.set(chunk, offset);
                    offset += chunk.length;
                }
            } else {
                // Fallback: no progress tracking
                const nnueData = await nnueResponse.arrayBuffer();
                nnueArray = new Uint8Array(nnueData);
            }

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
