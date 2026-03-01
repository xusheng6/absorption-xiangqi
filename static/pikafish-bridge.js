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
                this.worker = new Worker('/static/pikafish-worker.js?v=2');

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
     * @param {object} gameState - The local game state with board.pieces[] and current_turn
     * @param {Array} moveHistory - Array of move objects (used for move number calculation)
     * @param {string} difficulty - One of 'pikafish_easy', 'pikafish_medium', 'pikafish_hard', 'pikafish_extreme'
     * @returns {Promise<{from: {row, col}, to: {row, col}}>}
     */
    async getBestMove(gameState, moveHistory, difficulty) {
        if (!this.ready) {
            throw new Error('Engine not initialized');
        }

        // Determine search depth based on difficulty
        const depthMap = {
            'pikafish_easy': 8,
            'pikafish_medium': 12,
            'pikafish_hard': 16,
            'pikafish_extreme': 20
        };
        const depth = depthMap[difficulty] || 12;

        // Generate FEN from game state (includes absorption markers)
        const fen = PikafishBridge.gameStateToFEN(gameState, moveHistory);
        console.log('[PikafishBridge] FEN:', fen);

        // Wait for engine to be ready
        this.sendCommand('isready');

        // Set position via FEN (more robust than replaying moves from startpos)
        this.sendCommand('position fen ' + fen);

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
     * Convert game state to a Pikafish-compatible FEN string.
     * Includes absorption markers: e.g., R(cp) for a chariot with cannon+soldier abilities.
     *
     * Pikafish FEN piece chars: R/r=rook, A/a=advisor, C/c=cannon, P/p=pawn, N/n=knight, B/b=bishop, K/k=king
     * Absorption ability chars (inside parens): r=chariot, a=advisor, c=cannon, p=soldier, n=horse, b=elephant
     */
    static gameStateToFEN(gameState, moveHistory) {
        // Piece type to FEN character mapping
        const pieceChar = {
            red: { chariot: 'R', horse: 'N', elephant: 'B', advisor: 'A', general: 'K', cannon: 'C', soldier: 'P' },
            black: { chariot: 'r', horse: 'n', elephant: 'b', advisor: 'a', general: 'k', cannon: 'c', soldier: 'p' }
        };

        // Ability type to absorption char (always lowercase, order: r,a,c,p,n,b matching Pikafish)
        const abilityChar = {
            chariot: 'r', advisor: 'a', cannon: 'c', soldier: 'p', horse: 'n', elephant: 'b'
        };
        // Order in which abilities are output (matches Pikafish's absorbed_to_string)
        const abilityOrder = ['chariot', 'advisor', 'cannon', 'soldier', 'horse', 'elephant'];

        // Build a 10x9 board grid
        const board = [];
        for (let r = 0; r < 10; r++) {
            board[r] = new Array(9).fill(null);
        }

        for (const piece of gameState.board.pieces) {
            const ch = pieceChar[piece.color]?.[piece.type];
            if (!ch) continue;

            // Build absorption string
            let absStr = '';
            if (piece.abilities && piece.abilities.length > 0) {
                for (const aType of abilityOrder) {
                    if (piece.abilities.includes(aType)) {
                        absStr += abilityChar[aType];
                    }
                }
            }

            board[piece.row][piece.col] = absStr ? ch + '(' + absStr + ')' : ch;
        }

        // Build FEN string (rank 9 first, rank 0 last)
        const ranks = [];
        for (let r = 9; r >= 0; r--) {
            let rank = '';
            let empty = 0;
            for (let c = 0; c < 9; c++) {
                if (board[r][c] === null) {
                    empty++;
                } else {
                    if (empty > 0) {
                        rank += empty;
                        empty = 0;
                    }
                    rank += board[r][c];
                }
            }
            if (empty > 0) rank += empty;
            ranks.push(rank);
        }

        const side = gameState.current_turn === 'red' ? 'w' : 'b';
        const moveNum = Math.floor((moveHistory?.length || 0) / 2) + 1;

        return ranks.join('/') + ' ' + side + ' - - 0 ' + moveNum;
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
