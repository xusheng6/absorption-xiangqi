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

            self.postMessage({ type: 'status', message: 'Downloading NNUE file (51MB)...' });

            // Fetch NNUE file and write to MEMFS
            const nnueResponse = await fetch('/static/pikafish.nnue');
            if (!nnueResponse.ok) {
                throw new Error('Failed to fetch NNUE file: ' + nnueResponse.status);
            }

            const nnueData = await nnueResponse.arrayBuffer();
            const nnueArray = new Uint8Array(nnueData);

            self.postMessage({ type: 'status', message: 'Writing NNUE to filesystem...' });
            Module.FS.writeFile('/pikafish.nnue', nnueArray);

            self.postMessage({ type: 'status', message: 'Initializing engine (may take a moment)...' });

            // Initialize the engine
            Module.ccall('init', null, [], []);

            // Set up the processCommand wrapper
            processCommand = Module.cwrap('processCommand', null, ['string']);

            self.postMessage({ type: 'status', message: 'Configuring engine...' });

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
