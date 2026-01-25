/**
 * AI opponent for Absorption Xiangqi
 * Uses minimax with alpha-beta pruning
 */

class XiangqiAI {
    constructor(difficulty = 'medium') {
        this.difficulty = difficulty;
        this.maxDepth = difficulty === 'easy' ? 2 : difficulty === 'medium' ? 3 : 4;

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
            chariot: 300,
            cannon: 150,
            horse: 130,
            elephant: 60,
            advisor: 60,
            soldier: 30,
            general: 0
        };
    }

    // Get the best move for the AI
    getBestMove(gameState, aiColor) {
        const startTime = Date.now();
        const moves = this.getAllMoves(gameState, aiColor);

        if (moves.length === 0) return null;

        let bestMove = null;
        let bestScore = -Infinity;
        const alpha = -Infinity;
        const beta = Infinity;

        // Shuffle moves for variety
        this.shuffleArray(moves);

        for (const move of moves) {
            const newState = this.applyMove(gameState, move);
            const score = -this.minimax(newState, this.maxDepth - 1, -beta, -alpha, this.oppositeColor(aiColor));

            if (score > bestScore) {
                bestScore = score;
                bestMove = move;
            }
        }

        console.log(`AI computed move in ${Date.now() - startTime}ms, score: ${bestScore}`);
        return bestMove;
    }

    // Minimax with alpha-beta pruning
    minimax(gameState, depth, alpha, beta, currentColor) {
        if (depth === 0) {
            return this.evaluate(gameState, currentColor);
        }

        const moves = this.getAllMoves(gameState, currentColor);

        if (moves.length === 0) {
            // No moves - either checkmate or stalemate
            if (this.isInCheck(gameState, currentColor)) {
                return -10000 + (this.maxDepth - depth); // Prefer faster checkmates
            }
            return 0; // Stalemate
        }

        let bestScore = -Infinity;

        for (const move of moves) {
            const newState = this.applyMove(gameState, move);
            const score = -this.minimax(newState, depth - 1, -beta, -alpha, this.oppositeColor(currentColor));

            bestScore = Math.max(bestScore, score);
            alpha = Math.max(alpha, score);

            if (alpha >= beta) {
                break; // Beta cutoff
            }
        }

        return bestScore;
    }

    // Evaluate the board position
    evaluate(gameState, color) {
        let score = 0;

        for (const piece of gameState.board.pieces) {
            let pieceValue = this.pieceValues[piece.type];

            // Add bonus for abilities
            if (piece.abilities) {
                for (const ability of piece.abilities) {
                    pieceValue += this.abilityBonus[ability];
                }
            }

            // Positional bonuses
            pieceValue += this.getPositionalBonus(piece);

            if (piece.color === color) {
                score += pieceValue;
            } else {
                score -= pieceValue;
            }
        }

        return score;
    }

    // Positional bonuses
    getPositionalBonus(piece) {
        let bonus = 0;
        const row = piece.row;
        const col = piece.col;
        const isRed = piece.color === 'red';

        switch (piece.type) {
            case 'soldier':
                // Soldiers are more valuable when advanced
                if (isRed) {
                    bonus += (row - 3) * 10;
                    if (row >= 5) bonus += 20; // Crossed river
                } else {
                    bonus += (6 - row) * 10;
                    if (row <= 4) bonus += 20;
                }
                // Center soldiers are better
                if (col >= 3 && col <= 5) bonus += 10;
                break;

            case 'chariot':
                // Chariots on open files are better
                // Central control
                if (col >= 2 && col <= 6) bonus += 10;
                break;

            case 'horse':
                // Horses in the center are better
                if (col >= 2 && col <= 6 && row >= 2 && row <= 7) bonus += 15;
                break;

            case 'cannon':
                // Cannons on the back rank or central files
                if (col >= 3 && col <= 5) bonus += 10;
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
                moves.push({
                    from: { row: piece.row, col: piece.col },
                    to: { row: toRow, col: toCol },
                    piece: piece
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

    shuffleArray(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
    }
}

// Global AI instance
const xiangqiAI = new XiangqiAI('medium');
