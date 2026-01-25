/**
 * AI opponent for Absorption Xiangqi
 * Uses iterative deepening with alpha-beta pruning, transposition tables,
 * move ordering, and quiescence search
 */

class XiangqiAI {
    // Difficulty settings: { maxDepth, maxTime (ms) }
    static DIFFICULTY_SETTINGS = {
        easy:    { maxDepth: 4, maxTime: 2000 },
        medium:  { maxDepth: 5, maxTime: 5000 },
        hard:    { maxDepth: 6, maxTime: 10000 },
        extreme: { maxDepth: 8, maxTime: 20000 }
    };

    constructor(difficulty = 'medium') {
        this.setDifficulty(difficulty);
    }

    setDifficulty(difficulty) {
        this.difficulty = difficulty;
        const settings = XiangqiAI.DIFFICULTY_SETTINGS[difficulty] || XiangqiAI.DIFFICULTY_SETTINGS.medium;
        this.maxDepth = settings.maxDepth;
        this.maxTime = settings.maxTime;

        // Base piece values
        this.pieceValues = {
            general: 10000,
            chariot: 900,
            cannon: 450,
            horse: 400,
            elephant: 200,
            advisor: 200,
            soldier: 100
        };

        // Bonus for acquired abilities
        this.abilityBonus = {
            chariot: 350,
            cannon: 180,
            horse: 160,
            elephant: 80,
            advisor: 80,
            soldier: 40,
            general: 0
        };

        // Transposition table
        this.transpositionTable = new Map();
        this.maxTableSize = 100000;

        // Search statistics
        this.nodesSearched = 0;
        this.startTime = 0;

        // Killer moves (indexed by depth)
        this.killerMoves = [];

        // History heuristic table
        this.historyTable = {};

        // Principal variation tracking
        this.currentPV = [];
        this.currentDepth = 0;
        this.currentScore = 0;
        this.onThinkingUpdate = null;  // Callback for UI updates
    }

    // Get the best move for the AI using iterative deepening
    getBestMove(gameState, aiColor) {
        this.startTime = Date.now();
        this.nodesSearched = 0;
        this.transpositionTable.clear();
        this.killerMoves = Array(this.maxDepth + 10).fill(null).map(() => []);
        this.historyTable = {};

        let bestMove = null;
        let bestScore = -Infinity;

        // Iterative deepening
        for (let depth = 1; depth <= this.maxDepth; depth++) {
            const result = this.searchRoot(gameState, depth, aiColor);

            if (result.move) {
                bestMove = result.move;
                bestScore = result.score;
            }

            // Check time limit
            if (Date.now() - this.startTime > this.maxTime * 0.8) {
                break;
            }

            // If we found a winning move, stop searching
            if (bestScore > 9000) {
                break;
            }
        }

        const elapsed = Date.now() - this.startTime;
        console.log(`AI: depth=${this.maxDepth}, nodes=${this.nodesSearched}, time=${elapsed}ms, score=${bestScore}`);

        return bestMove;
    }

    // Root search with move ordering from previous iteration
    searchRoot(gameState, depth, aiColor) {
        let moves = this.getAllMoves(gameState, aiColor);
        if (moves.length === 0) return { move: null, score: -10000, pv: [] };

        // Order moves
        moves = this.orderMoves(gameState, moves, 0, aiColor);

        let bestMove = moves[0];
        let bestScore = -Infinity;
        let bestPV = [];
        let alpha = -Infinity;
        const beta = Infinity;

        for (const move of moves) {
            const newState = this.applyMove(gameState, move);
            let score;
            let childPV = [];

            // Principal Variation Search
            if (bestScore === -Infinity) {
                const result = this.alphaBetaPV(newState, depth - 1, -beta, -alpha, this.oppositeColor(aiColor), 1);
                score = -result.score;
                childPV = result.pv;
            } else {
                // Null window search
                score = -this.alphaBeta(newState, depth - 1, -alpha - 1, -alpha, this.oppositeColor(aiColor), 1);
                if (score > alpha && score < beta) {
                    // Re-search with full window
                    const result = this.alphaBetaPV(newState, depth - 1, -beta, -alpha, this.oppositeColor(aiColor), 1);
                    score = -result.score;
                    childPV = result.pv;
                }
            }

            if (score > bestScore) {
                bestScore = score;
                bestMove = move;
                bestPV = [move, ...childPV];

                // Update thinking display
                this.currentPV = bestPV;
                this.currentDepth = depth;
                this.currentScore = bestScore;
                if (this.onThinkingUpdate) {
                    this.onThinkingUpdate({
                        depth: depth,
                        score: bestScore,
                        pv: bestPV,
                        nodes: this.nodesSearched,
                        time: Date.now() - this.startTime
                    });
                }
            }

            alpha = Math.max(alpha, score);
        }

        return { move: bestMove, score: bestScore, pv: bestPV };
    }

    // Alpha-beta that returns PV (used for PV nodes)
    alphaBetaPV(gameState, depth, alpha, beta, currentColor, ply) {
        this.nodesSearched++;

        if (depth <= 0) {
            return { score: this.quiescence(gameState, alpha, beta, currentColor, 0), pv: [] };
        }

        let moves = this.getAllMoves(gameState, currentColor);

        if (moves.length === 0) {
            if (this.isInCheck(gameState, currentColor)) {
                return { score: -10000 + ply, pv: [] };
            }
            return { score: 0, pv: [] };
        }

        moves = this.orderMoves(gameState, moves, ply, currentColor);

        let bestScore = -Infinity;
        let bestPV = [];

        for (let i = 0; i < moves.length; i++) {
            const move = moves[i];
            const newState = this.applyMove(gameState, move);
            let score;
            let childPV = [];

            if (i === 0) {
                const result = this.alphaBetaPV(newState, depth - 1, -beta, -alpha, this.oppositeColor(currentColor), ply + 1);
                score = -result.score;
                childPV = result.pv;
            } else {
                score = -this.alphaBeta(newState, depth - 1, -alpha - 1, -alpha, this.oppositeColor(currentColor), ply + 1);
                if (score > alpha && score < beta) {
                    const result = this.alphaBetaPV(newState, depth - 1, -beta, -alpha, this.oppositeColor(currentColor), ply + 1);
                    score = -result.score;
                    childPV = result.pv;
                }
            }

            if (score > bestScore) {
                bestScore = score;
                bestPV = [move, ...childPV];
            }

            alpha = Math.max(alpha, score);
            if (alpha >= beta) break;
        }

        return { score: bestScore, pv: bestPV };
    }

    // Alpha-beta search with transposition table
    alphaBeta(gameState, depth, alpha, beta, currentColor, ply) {
        this.nodesSearched++;

        // Check transposition table
        const hash = this.hashPosition(gameState);
        const ttEntry = this.transpositionTable.get(hash);
        if (ttEntry && ttEntry.depth >= depth) {
            if (ttEntry.flag === 'exact') return ttEntry.score;
            if (ttEntry.flag === 'lower') alpha = Math.max(alpha, ttEntry.score);
            if (ttEntry.flag === 'upper') beta = Math.min(beta, ttEntry.score);
            if (alpha >= beta) return ttEntry.score;
        }

        // Terminal node or depth limit
        if (depth <= 0) {
            return this.quiescence(gameState, alpha, beta, currentColor, 0);
        }

        let moves = this.getAllMoves(gameState, currentColor);

        if (moves.length === 0) {
            if (this.isInCheck(gameState, currentColor)) {
                return -10000 + ply; // Checkmate (prefer faster)
            }
            return 0; // Stalemate
        }

        // Order moves for better pruning
        moves = this.orderMoves(gameState, moves, ply, currentColor);

        let bestScore = -Infinity;
        let flag = 'upper';

        for (let i = 0; i < moves.length; i++) {
            const move = moves[i];
            const newState = this.applyMove(gameState, move);
            let score;

            // Late Move Reduction for non-tactical moves
            if (i >= 4 && depth >= 3 && !move.isCapture && !this.isInCheck(newState, this.oppositeColor(currentColor))) {
                score = -this.alphaBeta(newState, depth - 2, -alpha - 1, -alpha, this.oppositeColor(currentColor), ply + 1);
                if (score <= alpha) continue;
            }

            score = -this.alphaBeta(newState, depth - 1, -beta, -alpha, this.oppositeColor(currentColor), ply + 1);

            if (score > bestScore) {
                bestScore = score;
            }

            if (score > alpha) {
                alpha = score;
                flag = 'exact';

                // Update history heuristic
                const moveKey = `${move.from.row},${move.from.col}-${move.to.row},${move.to.col}`;
                this.historyTable[moveKey] = (this.historyTable[moveKey] || 0) + depth * depth;
            }

            if (alpha >= beta) {
                // Update killer moves
                if (!move.isCapture) {
                    this.killerMoves[ply].unshift(move);
                    if (this.killerMoves[ply].length > 2) {
                        this.killerMoves[ply].pop();
                    }
                }
                flag = 'lower';
                break;
            }
        }

        // Store in transposition table
        if (this.transpositionTable.size < this.maxTableSize) {
            this.transpositionTable.set(hash, { score: bestScore, depth, flag });
        }

        return bestScore;
    }

    // Quiescence search - only search captures to avoid horizon effect
    quiescence(gameState, alpha, beta, currentColor, qDepth) {
        this.nodesSearched++;

        const standPat = this.evaluate(gameState, currentColor);

        if (qDepth > 6) return standPat; // Limit quiescence depth

        if (standPat >= beta) return beta;
        if (standPat > alpha) alpha = standPat;

        // Only search captures
        let moves = this.getAllMoves(gameState, currentColor);
        moves = moves.filter(m => m.isCapture);

        // Order captures by MVV-LVA
        moves.sort((a, b) => {
            const aValue = this.pieceValues[a.capturedType] - this.pieceValues[a.piece.type] / 10;
            const bValue = this.pieceValues[b.capturedType] - this.pieceValues[b.piece.type] / 10;
            return bValue - aValue;
        });

        for (const move of moves) {
            const newState = this.applyMove(gameState, move);
            const score = -this.quiescence(newState, -beta, -alpha, this.oppositeColor(currentColor), qDepth + 1);

            if (score >= beta) return beta;
            if (score > alpha) alpha = score;
        }

        return alpha;
    }

    // Order moves for better alpha-beta pruning
    orderMoves(gameState, moves, ply, currentColor) {
        const scored = moves.map(move => {
            let score = 0;

            // Captures: MVV-LVA (Most Valuable Victim - Least Valuable Attacker)
            if (move.isCapture) {
                score += 10000 + this.pieceValues[move.capturedType] * 10 - this.pieceValues[move.piece.type];
            }

            // Killer moves
            if (this.killerMoves[ply]) {
                for (let i = 0; i < this.killerMoves[ply].length; i++) {
                    const killer = this.killerMoves[ply][i];
                    if (killer &&
                        killer.from.row === move.from.row &&
                        killer.from.col === move.from.col &&
                        killer.to.row === move.to.row &&
                        killer.to.col === move.to.col) {
                        score += 5000 - i * 100;
                        break;
                    }
                }
            }

            // History heuristic
            const moveKey = `${move.from.row},${move.from.col}-${move.to.row},${move.to.col}`;
            score += (this.historyTable[moveKey] || 0);

            // Check if move gives check (bonus)
            const newState = this.applyMove(gameState, move);
            if (this.isInCheck(newState, this.oppositeColor(currentColor))) {
                score += 3000;
            }

            return { move, score };
        });

        scored.sort((a, b) => b.score - a.score);
        return scored.map(s => s.move);
    }

    // Simple hash for transposition table
    hashPosition(gameState) {
        let hash = '';
        for (const piece of gameState.board.pieces) {
            hash += `${piece.type[0]}${piece.color[0]}${piece.row}${piece.col}${(piece.abilities || []).join('')}|`;
        }
        hash += gameState.current_turn;
        return hash;
    }

    // Evaluate the board position
    evaluate(gameState, color) {
        let score = 0;

        // Check for checkmate
        const enemyColor = this.oppositeColor(color);
        const enemyMoves = this.getAllMoves(gameState, enemyColor);
        if (enemyMoves.length === 0 && this.isInCheck(gameState, enemyColor)) {
            return 9999; // We're about to win
        }

        for (const piece of gameState.board.pieces) {
            let pieceValue = this.pieceValues[piece.type];

            // Add bonus for abilities
            if (piece.abilities) {
                for (const ability of piece.abilities) {
                    pieceValue += this.abilityBonus[ability];
                }
            }

            // Positional bonuses
            pieceValue += this.getPositionalBonus(piece, gameState);

            if (piece.color === color) {
                score += pieceValue;
            } else {
                score -= pieceValue;
            }
        }

        // Mobility bonus (simplified)
        const myMoves = this.getAllMoves(gameState, color);
        score += myMoves.length * 5;
        score -= enemyMoves.length * 5;

        // King safety
        score += this.evaluateKingSafety(gameState, color);

        return score;
    }

    // Evaluate king safety
    evaluateKingSafety(gameState, color) {
        let score = 0;
        const king = gameState.board.pieces.find(p => p.type === 'general' && p.color === color);
        if (!king) return -5000;

        // Count defenders near king
        const defenders = gameState.board.pieces.filter(p =>
            p.color === color &&
            p.type !== 'general' &&
            Math.abs(p.row - king.row) <= 2 &&
            Math.abs(p.col - king.col) <= 2
        );
        score += defenders.length * 20;

        // Penalty for being in check
        if (this.isInCheck(gameState, color)) {
            score -= 50;
        }

        return score;
    }

    // Positional bonuses
    getPositionalBonus(piece, gameState) {
        let bonus = 0;
        const row = piece.row;
        const col = piece.col;
        const isRed = piece.color === 'red';

        switch (piece.type) {
            case 'soldier':
                // Soldiers are more valuable when advanced
                if (isRed) {
                    bonus += (row - 3) * 15;
                    if (row >= 5) bonus += 30; // Crossed river
                    if (row >= 7) bonus += 20; // Deep in enemy territory
                } else {
                    bonus += (6 - row) * 15;
                    if (row <= 4) bonus += 30;
                    if (row <= 2) bonus += 20;
                }
                // Center soldiers are better
                if (col >= 3 && col <= 5) bonus += 15;
                break;

            case 'chariot':
                // Chariots on open files are better
                if (col >= 2 && col <= 6) bonus += 15;
                // Chariots on 7th rank (enemy's 2nd) are strong
                if ((isRed && row >= 7) || (!isRed && row <= 2)) bonus += 25;
                break;

            case 'horse':
                // Horses in the center are better
                if (col >= 2 && col <= 6 && row >= 2 && row <= 7) bonus += 20;
                // Penalty for edge horses
                if (col === 0 || col === 8) bonus -= 15;
                break;

            case 'cannon':
                // Cannons on the back rank or central files
                if (col >= 3 && col <= 5) bonus += 15;
                // Cannons are good when there are many pieces to jump over
                break;

            case 'advisor':
            case 'elephant':
                // Slightly prefer central positions for defense
                if (col === 4) bonus += 10;
                break;
        }

        return bonus;
    }

    // Get all valid moves for a color
    getAllMoves(gameState, color) {
        const moves = [];

        for (const piece of gameState.board.pieces) {
            if (piece.color !== color) continue;

            const pieceMoves = this.getValidMovesForPiece(gameState, piece);
            for (const [toRow, toCol] of pieceMoves) {
                const target = this.getPieceAt(gameState, toRow, toCol);
                moves.push({
                    from: { row: piece.row, col: piece.col },
                    to: { row: toRow, col: toCol },
                    piece: piece,
                    isCapture: !!target,
                    capturedType: target ? target.type : null
                });
            }
        }

        return moves;
    }

    // Get valid moves for a single piece
    getValidMovesForPiece(gameState, piece) {
        const moves = [];
        const allTypes = [piece.type, ...(piece.abilities || [])];

        for (const moveType of allTypes) {
            const typeMoves = this.getMovesForType(gameState, piece, moveType);
            moves.push(...typeMoves);
        }

        // Remove duplicates and filter invalid
        const validMoves = [];
        const seen = new Set();

        for (const [r, c] of moves) {
            const key = `${r},${c}`;
            if (seen.has(key)) continue;
            if (r < 0 || r > 9 || c < 0 || c > 8) continue;

            const target = this.getPieceAt(gameState, r, c);
            if (target && target.color === piece.color) continue;

            // Check if move is within valid range for piece type
            if (!this.isValidPosition(piece, r, c)) continue;

            // Check if move would leave king in check
            const testState = this.applyMoveRaw(gameState, piece.row, piece.col, r, c);
            if (!this.isInCheck(testState, piece.color)) {
                seen.add(key);
                validMoves.push([r, c]);
            }
        }

        return validMoves;
    }

    // Check if position is valid for a piece's movement range
    isValidPosition(piece, row, col) {
        // General always in palace
        if (piece.type === 'general') {
            const inPalace = col >= 3 && col <= 5;
            if (piece.color === 'red') {
                return inPalace && row >= 0 && row <= 2;
            } else {
                return inPalace && row >= 7 && row <= 9;
            }
        }

        // Pieces with abilities become full-board
        if (piece.abilities && piece.abilities.length > 0) {
            return true;
        }

        // Advisor restricted to palace
        if (piece.type === 'advisor') {
            const inPalace = col >= 3 && col <= 5;
            if (piece.color === 'red') {
                return inPalace && row >= 0 && row <= 2;
            } else {
                return inPalace && row >= 7 && row <= 9;
            }
        }

        // Elephant restricted to own half
        if (piece.type === 'elephant') {
            if (piece.color === 'red') {
                return row <= 4;
            } else {
                return row >= 5;
            }
        }

        return true;
    }

    // Get moves for a specific movement type
    getMovesForType(gameState, piece, moveType) {
        const moves = [];
        const row = piece.row;
        const col = piece.col;

        switch (moveType) {
            case 'chariot':
                for (const [dr, dc] of [[0,1],[0,-1],[1,0],[-1,0]]) {
                    for (let i = 1; i < 10; i++) {
                        const nr = row + dr * i, nc = col + dc * i;
                        if (nr < 0 || nr > 9 || nc < 0 || nc > 8) break;
                        const target = this.getPieceAt(gameState, nr, nc);
                        moves.push([nr, nc]);
                        if (target) break;
                    }
                }
                break;

            case 'horse':
                const horseMoves = [
                    [[-1,0], [-2,-1]], [[-1,0], [-2,1]],
                    [[1,0], [2,-1]], [[1,0], [2,1]],
                    [[0,-1], [-1,-2]], [[0,-1], [1,-2]],
                    [[0,1], [-1,2]], [[0,1], [1,2]]
                ];
                for (const [[br, bc], [mr, mc]] of horseMoves) {
                    if (!this.getPieceAt(gameState, row + br, col + bc)) {
                        moves.push([row + mr, col + mc]);
                    }
                }
                break;

            case 'cannon':
                for (const [dr, dc] of [[0,1],[0,-1],[1,0],[-1,0]]) {
                    let jumped = false;
                    for (let i = 1; i < 10; i++) {
                        const nr = row + dr * i, nc = col + dc * i;
                        if (nr < 0 || nr > 9 || nc < 0 || nc > 8) break;
                        const target = this.getPieceAt(gameState, nr, nc);
                        if (!jumped) {
                            if (!target) moves.push([nr, nc]);
                            else jumped = true;
                        } else {
                            if (target) { moves.push([nr, nc]); break; }
                        }
                    }
                }
                break;

            case 'soldier':
                const forward = piece.color === 'red' ? 1 : -1;
                moves.push([row + forward, col]);
                const crossed = (piece.color === 'red' && row >= 5) || (piece.color === 'black' && row <= 4);
                if (crossed) {
                    moves.push([row, col - 1]);
                    moves.push([row, col + 1]);
                }
                break;

            case 'advisor':
                for (const [dr, dc] of [[1,1],[1,-1],[-1,1],[-1,-1]]) {
                    moves.push([row + dr, col + dc]);
                }
                break;

            case 'elephant':
                for (const [dr, dc] of [[2,2],[2,-2],[-2,2],[-2,-2]]) {
                    if (!this.getPieceAt(gameState, row + dr/2, col + dc/2)) {
                        moves.push([row + dr, col + dc]);
                    }
                }
                break;

            case 'general':
                for (const [dr, dc] of [[0,1],[0,-1],[1,0],[-1,0]]) {
                    moves.push([row + dr, col + dc]);
                }
                break;
        }

        return moves;
    }

    // Apply a move and return new state (deep copy)
    applyMove(gameState, move) {
        return this.applyMoveRaw(gameState, move.from.row, move.from.col, move.to.row, move.to.col);
    }

    applyMoveRaw(gameState, fromRow, fromCol, toRow, toCol) {
        // Deep copy the state
        const newState = {
            board: {
                pieces: gameState.board.pieces.map(p => ({
                    ...p,
                    abilities: p.abilities ? [...p.abilities] : []
                }))
            },
            current_turn: gameState.current_turn
        };

        const piece = newState.board.pieces.find(p => p.row === fromRow && p.col === fromCol);
        if (!piece) return newState;

        // Check for capture
        const targetIdx = newState.board.pieces.findIndex(p => p.row === toRow && p.col === toCol);
        if (targetIdx !== -1) {
            const target = newState.board.pieces[targetIdx];
            // Absorption: gain target's default type
            if (target.type !== piece.type && !piece.abilities.includes(target.type)) {
                piece.abilities.push(target.type);
            }
            newState.board.pieces.splice(targetIdx, 1);
        }

        // Move the piece
        piece.row = toRow;
        piece.col = toCol;

        // Switch turns
        newState.current_turn = this.oppositeColor(gameState.current_turn);

        return newState;
    }

    // Check if a color's king is in check
    isInCheck(gameState, color) {
        const king = gameState.board.pieces.find(p => p.type === 'general' && p.color === color);
        if (!king) return true;

        const enemyColor = this.oppositeColor(color);

        // Check if any enemy piece can capture the king
        for (const piece of gameState.board.pieces) {
            if (piece.color !== enemyColor) continue;

            const allTypes = [piece.type, ...(piece.abilities || [])];
            for (const moveType of allTypes) {
                const moves = this.getMovesForType(gameState, piece, moveType);
                for (const [r, c] of moves) {
                    if (r === king.row && c === king.col) {
                        // Verify it's a valid move position for this piece
                        if (r < 0 || r > 9 || c < 0 || c > 8) continue;
                        return true;
                    }
                }
            }
        }

        // Check for flying general
        const enemyKing = gameState.board.pieces.find(p => p.type === 'general' && p.color === enemyColor);
        if (enemyKing && king.col === enemyKing.col) {
            let blocked = false;
            const minRow = Math.min(king.row, enemyKing.row);
            const maxRow = Math.max(king.row, enemyKing.row);
            for (let r = minRow + 1; r < maxRow; r++) {
                if (this.getPieceAt(gameState, r, king.col)) {
                    blocked = true;
                    break;
                }
            }
            if (!blocked) return true;
        }

        return false;
    }

    // Helper functions
    getPieceAt(gameState, row, col) {
        return gameState.board.pieces.find(p => p.row === row && p.col === col);
    }

    oppositeColor(color) {
        return color === 'red' ? 'black' : 'red';
    }
}

// Global AI instance
const xiangqiAI = new XiangqiAI('medium');
