/**
 * PikafishBridge - Main-thread bridge to the Pikafish WASM Web Worker
 * Manages worker lifecycle, UCI communication, and move retrieval.
 */
class PikafishBridge {
    constructor() {
        this.worker = null;
        this.ready = false;
        this.initializing = false;
        this._initPromise = null;
        this._pendingBestMove = null;
        this._uciListeners = [];
    }

    /**
     * Initialize the engine (lazy - only loads WASM on first call).
     * Returns a promise that resolves when the engine is ready.
     */
    async init() {
        if (this.ready) return;
        if (this._initPromise) return this._initPromise;

        this.initializing = true;
        this._initPromise = new Promise((resolve, reject) => {
            try {
                this.worker = new Worker('/static/pikafish-worker.js');

                this.worker.onmessage = (e) => {
                    const msg = e.data;

                    if (msg.type === 'ready') {
                        this.ready = true;
                        this.initializing = false;
                        resolve();
                    } else if (msg.type === 'error') {
                        console.error('[PikafishBridge] Error:', msg.message);
                        if (!this.ready) {
                            this.initializing = false;
                            reject(new Error(msg.message));
                        }
                    } else if (msg.type === 'status') {
                        console.log('[PikafishBridge] Status:', msg.message);
                        if (this._onStatus) this._onStatus(msg.message);
                    } else if (msg.type === 'progress') {
                        if (this._onProgress) this._onProgress(msg.loaded, msg.total);
                    } else if (msg.type === 'uci') {
                        this._handleUCIOutput(msg.data);
                    }
                };

                this.worker.onerror = (e) => {
                    console.error('[PikafishBridge] Worker error:', e);
                    if (!this.ready) {
                        this.initializing = false;
                        reject(new Error('Worker failed: ' + e.message));
                    }
                };

                // Start initialization
                this.worker.postMessage({ type: 'init' });

            } catch (err) {
                this.initializing = false;
                reject(err);
            }
        });

        return this._initPromise;
    }

    /**
     * Set a callback for status updates during initialization.
     */
    onStatus(callback) {
        this._onStatus = callback;
    }

    /**
     * Set a callback for download progress during initialization.
     * @param {function(loaded: number, total: number)} callback
     */
    onProgress(callback) {
        this._onProgress = callback;
    }

    /**
     * Send a raw UCI command to the engine.
     */
    sendCommand(cmd) {
        if (!this.worker) return;
        this.worker.postMessage({ type: 'uci', command: cmd });
    }

    /**
     * Handle UCI output from the engine.
     */
    _handleUCIOutput(line) {
        // Notify any registered listeners
        for (const listener of this._uciListeners) {
            listener(line);
        }

        // Check for bestmove response
        if (line.startsWith('bestmove') && this._pendingBestMove) {
            const parts = line.split(/\s+/);
            const bestmove = parts[1];
            this._pendingBestMove.resolve(bestmove);
            this._pendingBestMove = null;
        }
    }

    /**
     * Get the best move for the given position.
     * @param {Array} moveHistory - Array of move objects [{from: [r,c], to: [r,c], ...}]
     * @param {string} difficulty - One of 'pikafish_easy', 'pikafish_medium', 'pikafish_hard', 'pikafish_extreme'
     * @returns {Promise<{from: {row, col}, to: {row, col}}>}
     */
    async getBestMove(moveHistory, difficulty) {
        if (!this.ready) {
            throw new Error('Engine not initialized');
        }

        // Convert move history to UCI format
        const uciMoves = moveHistory.map(m => {
            return PikafishBridge.coordsToUCI(m.from[0], m.from[1], m.to[0], m.to[1]);
        });

        // Determine search depth based on difficulty
        const depthMap = {
            'pikafish_easy': 8,
            'pikafish_medium': 12,
            'pikafish_hard': 16,
            'pikafish_extreme': 20
        };
        const depth = depthMap[difficulty] || 12;

        // Wait for engine to be ready
        this.sendCommand('isready');

        // Set position
        if (uciMoves.length > 0) {
            this.sendCommand('position startpos moves ' + uciMoves.join(' '));
        } else {
            this.sendCommand('position startpos');
        }

        // Start search and wait for bestmove
        const bestmovePromise = new Promise((resolve, reject) => {
            this._pendingBestMove = { resolve, reject };
            // Timeout after 60 seconds
            setTimeout(() => {
                if (this._pendingBestMove) {
                    this._pendingBestMove = null;
                    reject(new Error('Engine timeout'));
                }
            }, 60000);
        });

        this.sendCommand('go depth ' + depth);

        const bestmove = await bestmovePromise;

        if (!bestmove || bestmove === '(none)') {
            return null;
        }

        return PikafishBridge.uciToCoords(bestmove);
    }

    /**
     * Convert board coordinates to UCI move string.
     * Board: row 0 = red's back rank (rank 0 in UCI), row 9 = black's back rank (rank 9)
     * UCI format: file (a-i) + rank (0-9), e.g., "e0e1"
     */
    static coordsToUCI(fromRow, fromCol, toRow, toCol) {
        const files = 'abcdefghi';
        return files[fromCol] + fromRow.toString() + files[toCol] + toRow.toString();
    }

    /**
     * Convert UCI move string back to board coordinates.
     * @param {string} uciMove - e.g., "e0e1"
     * @returns {{from: {row, col}, to: {row, col}}}
     */
    static uciToCoords(uciMove) {
        const files = 'abcdefghi';
        const fromCol = files.indexOf(uciMove[0]);
        const fromRow = parseInt(uciMove[1]);
        const toCol = files.indexOf(uciMove[2]);
        const toRow = parseInt(uciMove[3]);

        return {
            from: { row: fromRow, col: fromCol },
            to: { row: toRow, col: toCol }
        };
    }

    /**
     * Terminate the worker.
     */
    destroy() {
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
        }
        this.ready = false;
        this.initializing = false;
        this._initPromise = null;
    }
}
