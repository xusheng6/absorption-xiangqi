/**
 * Game rendering and logic for Absorption Xiangqi
 * Version: 2.0 (with Pikafish integration)
 */
console.log('Game.js loaded - v2.0 with Pikafish');

// Piece names in Chinese
const PIECE_NAMES = {
    red: {
        general: '帥',
        advisor: '仕',
        elephant: '相',
        horse: '傌',
        chariot: '俥',
        cannon: '炮',
        soldier: '兵'
    },
    black: {
        general: '將',
        advisor: '士',
        elephant: '象',
        horse: '馬',
        chariot: '車',
        cannon: '砲',
        soldier: '卒'
    }
};

const PIECE_TYPE_NAMES = {
    general: '將/帥',
    advisor: '士/仕',
    elephant: '象/相',
    horse: '馬',
    chariot: '車',
    cannon: '炮',
    soldier: '卒/兵'
};

// Short ability names for piece annotations
const ABILITY_SHORT_NAMES = {
    general: '帥',
    advisor: '士',
    elephant: '象',
    horse: '馬',
    chariot: '車',
    cannon: '炮',
    soldier: '兵'
};

class GameBoard {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');

        // Board dimensions
        this.cellSize = 60;
        this.padding = 30;
        this.pieceRadius = 25;

        // Game state
        this.gameState = null;
        this.playerColor = null;
        this.selectedPiece = null;
        this.validMoves = [];

        // Bind events
        this.canvas.addEventListener('click', (e) => this.handleClick(e));

        // Initial draw
        this.draw();
    }

    setGameState(state, playerColor) {
        this.gameState = state;
        this.playerColor = playerColor;
        this.selectedPiece = null;
        this.validMoves = [];
        this.draw();
        this.updateTurnIndicators();
    }

    setValidMoves(fromPos, moves) {
        this.validMoves = moves;
        this.draw();
    }

    // Convert board coordinates to canvas coordinates
    // Each player sees their own side at the bottom
    boardToCanvas(row, col) {
        if (this.playerColor === 'red') {
            // Red: flip rows so row 0 (red's back) is at bottom
            row = 9 - row;
        } else if (this.playerColor === 'black') {
            // Black: flip cols so black's left is on their left
            col = 8 - col;
        }
        return {
            x: this.padding + col * this.cellSize,
            y: this.padding + row * this.cellSize
        };
    }

    // Convert canvas coordinates to board coordinates
    canvasToBoard(x, y) {
        let col = Math.round((x - this.padding) / this.cellSize);
        let row = Math.round((y - this.padding) / this.cellSize);

        // Flip back based on player color
        if (this.playerColor === 'red') {
            row = 9 - row;
        } else if (this.playerColor === 'black') {
            col = 8 - col;
        }

        return { row, col };
    }

    draw() {
        const ctx = this.ctx;
        const width = this.canvas.width;
        const height = this.canvas.height;

        // Clear canvas
        ctx.fillStyle = '#deb887';
        ctx.fillRect(0, 0, width, height);

        // Draw grid
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 1;

        // Horizontal lines
        for (let row = 0; row <= 9; row++) {
            const y = this.padding + row * this.cellSize;
            ctx.beginPath();
            ctx.moveTo(this.padding, y);
            ctx.lineTo(this.padding + 8 * this.cellSize, y);
            ctx.stroke();
        }

        // Vertical lines (with river gap)
        for (let col = 0; col <= 8; col++) {
            const x = this.padding + col * this.cellSize;

            // Top half
            ctx.beginPath();
            ctx.moveTo(x, this.padding);
            ctx.lineTo(x, this.padding + 4 * this.cellSize);
            ctx.stroke();

            // Bottom half
            ctx.beginPath();
            ctx.moveTo(x, this.padding + 5 * this.cellSize);
            ctx.lineTo(x, this.padding + 9 * this.cellSize);
            ctx.stroke();
        }

        // Draw palace diagonals
        this.drawPalace(0);  // Red palace
        this.drawPalace(7);  // Black palace

        // Draw river text
        ctx.font = '24px serif';
        ctx.fillStyle = '#000';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        const riverY = this.padding + 4.5 * this.cellSize;
        if (this.playerColor === 'red') {
            // Red sees 楚河 on left (enemy side), 漢界 on right (own side)
            ctx.fillText('楚 河', this.padding + 2 * this.cellSize, riverY);
            ctx.fillText('漢 界', this.padding + 6 * this.cellSize, riverY);
        } else {
            // Black sees it mirrored
            ctx.fillText('漢 界', this.padding + 2 * this.cellSize, riverY);
            ctx.fillText('楚 河', this.padding + 6 * this.cellSize, riverY);
        }

        // Draw valid move indicators
        this.drawValidMoves();

        // Draw pieces
        if (this.gameState && this.gameState.board) {
            for (const piece of this.gameState.board.pieces) {
                this.drawPiece(piece);
            }
        }
    }

    drawPalace(startRow) {
        const ctx = this.ctx;
        let x1 = this.padding + 3 * this.cellSize;
        let x2 = this.padding + 5 * this.cellSize;
        let y1, y2;

        if (this.playerColor === 'red') {
            // Flip rows for red player
            const flippedStart = 9 - startRow - 2;
            y1 = this.padding + flippedStart * this.cellSize;
            y2 = this.padding + (flippedStart + 2) * this.cellSize;
        } else if (this.playerColor === 'black') {
            // Flip cols for black player
            x1 = this.padding + 3 * this.cellSize;
            x2 = this.padding + 5 * this.cellSize;
            y1 = this.padding + startRow * this.cellSize;
            y2 = this.padding + (startRow + 2) * this.cellSize;
        } else {
            y1 = this.padding + startRow * this.cellSize;
            y2 = this.padding + (startRow + 2) * this.cellSize;
        }

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(x2, y1);
        ctx.lineTo(x1, y2);
        ctx.stroke();
    }

    drawValidMoves() {
        const ctx = this.ctx;

        for (const [row, col] of this.validMoves) {
            const pos = this.boardToCanvas(row, col);

            // Check if there's a piece to capture
            const targetPiece = this.getPieceAt(row, col);

            if (targetPiece) {
                // Capture indicator (red ring)
                ctx.strokeStyle = 'rgba(255, 0, 0, 0.8)';
                ctx.lineWidth = 3;
                ctx.beginPath();
                ctx.arc(pos.x, pos.y, this.pieceRadius + 3, 0, Math.PI * 2);
                ctx.stroke();
            } else {
                // Move indicator (green dot)
                ctx.fillStyle = 'rgba(0, 200, 0, 0.6)';
                ctx.beginPath();
                ctx.arc(pos.x, pos.y, 10, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    }

    drawPiece(piece) {
        const ctx = this.ctx;
        const pos = this.boardToCanvas(piece.row, piece.col);

        // Draw piece circle
        const isSelected = this.selectedPiece &&
            this.selectedPiece.row === piece.row &&
            this.selectedPiece.col === piece.col;

        // Outer ring for selected piece
        if (isSelected) {
            ctx.strokeStyle = '#fbbf24';
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, this.pieceRadius + 4, 0, Math.PI * 2);
            ctx.stroke();
        }

        // Piece background
        const gradient = ctx.createRadialGradient(
            pos.x - 5, pos.y - 5, 0,
            pos.x, pos.y, this.pieceRadius
        );
        gradient.addColorStop(0, '#fff');
        gradient.addColorStop(1, '#ddd');
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, this.pieceRadius, 0, Math.PI * 2);
        ctx.fill();

        // Piece border
        ctx.strokeStyle = piece.color === 'red' ? '#c00' : '#000';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Piece text
        ctx.font = 'bold 28px serif';
        ctx.fillStyle = piece.color === 'red' ? '#c00' : '#000';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        const pieceName = PIECE_NAMES[piece.color][piece.type];
        ctx.fillText(pieceName, pos.x, pos.y);

        // Draw ability annotations as small text around the piece
        if (piece.abilities && piece.abilities.length > 0) {
            ctx.font = 'bold 11px serif';
            ctx.fillStyle = '#059669';  // Green color for abilities

            // Position abilities around the corner of the piece
            const abilityText = piece.abilities.map(a => ABILITY_SHORT_NAMES[a]).join('');

            // Draw background for better readability
            const textWidth = ctx.measureText(abilityText).width;
            const textX = pos.x + this.pieceRadius - textWidth/2 - 2;
            const textY = pos.y - this.pieceRadius + 6;

            ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
            ctx.fillRect(textX - 2, textY - 8, textWidth + 4, 12);

            // Draw the ability text
            ctx.fillStyle = '#059669';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(abilityText, pos.x + this.pieceRadius - 4, textY - 2);
        }
    }

    getPieceAt(row, col) {
        if (!this.gameState || !this.gameState.board) return null;
        return this.gameState.board.pieces.find(p => p.row === row && p.col === col);
    }

    handleClick(event) {
        const rect = this.canvas.getBoundingClientRect();
        const scaleX = this.canvas.width / rect.width;
        const scaleY = this.canvas.height / rect.height;
        const x = (event.clientX - rect.left) * scaleX;
        const y = (event.clientY - rect.top) * scaleY;

        const { row, col } = this.canvasToBoard(x, y);

        // Bounds check
        if (row < 0 || row > 9 || col < 0 || col > 8) return;

        // Check if this is an AI game
        const isAIGame = window.gameUI && window.gameUI.isAIGame;

        // In AI game, only allow moves on player's turn
        if (isAIGame) {
            const state = window.gameUI.localGameState;
            if (!state || state.state !== 'playing' || state.current_turn !== this.playerColor) {
                return;
            }
        }

        // If we have a selected piece and clicked on a valid move
        if (this.selectedPiece) {
            const isValidMove = this.validMoves.some(([r, c]) => r === row && c === col);

            if (isValidMove) {
                // Make the move
                if (isAIGame) {
                    window.gameUI.applyLocalMove(
                        this.selectedPiece.row,
                        this.selectedPiece.col,
                        row,
                        col
                    );
                } else {
                    gameSocket.makeMove(
                        this.selectedPiece.row,
                        this.selectedPiece.col,
                        row,
                        col
                    );
                }
                this.selectedPiece = null;
                this.validMoves = [];
                this.draw();
                this.updatePieceInfo(null);
                return;
            }

            // Clicked on another own piece - switch selection
            const piece = this.getPieceAt(row, col);
            if (piece && piece.color === this.playerColor) {
                this.selectedPiece = piece;
                this.validMoves = this.computeValidMovesLocal(piece);
                this.updatePieceInfo(piece);
                this.draw();
                return;
            }

            // Clicked elsewhere - deselect
            this.selectedPiece = null;
            this.validMoves = [];
            this.updatePieceInfo(null);
            this.draw();
            return;
        }

        // No piece selected - try to select one
        const piece = this.getPieceAt(row, col);
        if (piece && piece.color === this.playerColor) {
            this.selectedPiece = piece;
            this.validMoves = this.computeValidMovesLocal(piece);
            this.updatePieceInfo(piece);
        }

        this.draw();
    }

    // Compute valid moves locally for immediate feedback
    computeValidMovesLocal(piece) {
        const moves = [];
        const allTypes = [piece.type, ...(piece.abilities || [])];

        // Check if piece has gained abilities (becomes "full board" piece)
        const hasAbilities = piece.abilities && piece.abilities.length > 0;

        for (const moveType of allTypes) {
            const typeMoves = this.getMovesForType(piece, moveType, hasAbilities);
            moves.push(...typeMoves);
        }

        // Remove duplicates and filter
        const uniqueMoves = [];
        const seen = new Set();
        for (const [r, c] of moves) {
            const key = `${r},${c}`;
            if (!seen.has(key) && r >= 0 && r <= 9 && c >= 0 && c <= 8) {
                const target = this.getPieceAt(r, c);
                if (!target || target.color !== piece.color) {
                    // Check if this move would leave our king in check
                    if (!this.wouldBeInCheck(piece, r, c)) {
                        seen.add(key);
                        uniqueMoves.push([r, c]);
                    }
                }
            }
        }
        return uniqueMoves;
    }

    // Check if moving a piece to a position would leave our king in check
    wouldBeInCheck(piece, toRow, toCol) {
        if (!this.gameState) return false;

        // Simulate the move
        const fromRow = piece.row;
        const fromCol = piece.col;
        const capturedPiece = this.getPieceAt(toRow, toCol);

        // Temporarily move the piece
        piece.row = toRow;
        piece.col = toCol;

        // Temporarily remove captured piece
        let capturedIdx = -1;
        if (capturedPiece) {
            capturedIdx = this.gameState.board.pieces.indexOf(capturedPiece);
            if (capturedIdx !== -1) {
                this.gameState.board.pieces.splice(capturedIdx, 1);
            }
        }

        // Check if our king is in check
        const inCheck = this.isKingInCheck(piece.color);

        // Restore the position
        piece.row = fromRow;
        piece.col = fromCol;
        if (capturedPiece && capturedIdx !== -1) {
            this.gameState.board.pieces.splice(capturedIdx, 0, capturedPiece);
        }

        return inCheck;
    }

    // Check if the king of the given color is in check
    isKingInCheck(color) {
        if (!this.gameState) return false;

        // Find the king
        const king = this.gameState.board.pieces.find(p => p.type === 'general' && p.color === color);
        if (!king) return false;

        const enemyColor = color === 'red' ? 'black' : 'red';

        // Check if any enemy piece can capture the king
        for (const enemy of this.gameState.board.pieces) {
            if (enemy.color !== enemyColor) continue;

            const allTypes = [enemy.type, ...(enemy.abilities || [])];
            const hasAbilities = enemy.abilities && enemy.abilities.length > 0;

            for (const moveType of allTypes) {
                const moves = this.getMovesForType(enemy, moveType, hasAbilities);
                for (const [r, c] of moves) {
                    if (r === king.row && c === king.col) {
                        return true;
                    }
                }
            }
        }

        // Check for flying general (generals facing each other)
        const enemyKing = this.gameState.board.pieces.find(p => p.type === 'general' && p.color === enemyColor);
        if (enemyKing && king.col === enemyKing.col) {
            // Check if there are any pieces between them
            const minRow = Math.min(king.row, enemyKing.row);
            const maxRow = Math.max(king.row, enemyKing.row);
            let blocked = false;
            for (let r = minRow + 1; r < maxRow; r++) {
                if (this.getPieceAt(r, king.col)) {
                    blocked = true;
                    break;
                }
            }
            if (!blocked) return true;
        }

        return false;
    }

    getMovesForType(piece, moveType, hasAbilities = false) {
        const moves = [];
        const row = piece.row;
        const col = piece.col;
        const isGeneral = piece.type === 'general';

        // Helper to check if position is in palace
        const inPalace = (r, c, color) => {
            if (c < 3 || c > 5) return false;
            if (color === 'red') return r >= 0 && r <= 2;
            return r >= 7 && r <= 9;
        };

        // Helper to check if position is on own side of river
        const onOwnSide = (r, color) => {
            if (color === 'red') return r <= 4;
            return r >= 5;
        };

        // Helper to add move, respecting general's palace restriction
        const addMove = (nr, nc) => {
            if (isGeneral) {
                // General can NEVER leave palace, even with abilities
                if (inPalace(nr, nc, piece.color)) {
                    moves.push([nr, nc]);
                }
            } else {
                moves.push([nr, nc]);
            }
        };

        switch (moveType) {
            case 'chariot':
                // Rook-like movement
                for (const [dr, dc] of [[0,1],[0,-1],[1,0],[-1,0]]) {
                    for (let i = 1; i < 10; i++) {
                        const nr = row + dr * i, nc = col + dc * i;
                        if (nr < 0 || nr > 9 || nc < 0 || nc > 8) break;
                        // General must stay in palace
                        if (isGeneral && !inPalace(nr, nc, piece.color)) break;
                        const target = this.getPieceAt(nr, nc);
                        addMove(nr, nc);
                        if (target) break;
                    }
                }
                break;

            case 'horse':
                // Knight-like with blocking
                const horseMoves = [
                    [[-1,0], [-2,-1]], [[-1,0], [-2,1]],
                    [[1,0], [2,-1]], [[1,0], [2,1]],
                    [[0,-1], [-1,-2]], [[0,-1], [1,-2]],
                    [[0,1], [-1,2]], [[0,1], [1,2]]
                ];
                for (const [[br, bc], [mr, mc]] of horseMoves) {
                    if (!this.getPieceAt(row + br, col + bc)) {
                        addMove(row + mr, col + mc);
                    }
                }
                break;

            case 'cannon':
                // Cannon movement
                for (const [dr, dc] of [[0,1],[0,-1],[1,0],[-1,0]]) {
                    let jumped = false;
                    for (let i = 1; i < 10; i++) {
                        const nr = row + dr * i, nc = col + dc * i;
                        if (nr < 0 || nr > 9 || nc < 0 || nc > 8) break;
                        const target = this.getPieceAt(nr, nc);
                        if (!jumped) {
                            if (!target) addMove(nr, nc);
                            else jumped = true;
                        } else {
                            if (target) { addMove(nr, nc); break; }
                        }
                    }
                }
                break;

            case 'soldier':
                // Pawn movement - sideways only allowed on opponent's side
                const forward = piece.color === 'red' ? 1 : -1;
                addMove(row + forward, col);
                // After crossing river OR after gaining abilities, can move sideways
                const crossed = (piece.color === 'red' && row >= 5) || (piece.color === 'black' && row <= 4);
                if (crossed || hasAbilities) {
                    addMove(row, col - 1);
                    addMove(row, col + 1);
                }
                break;

            case 'advisor':
                // Diagonal one step - palace restricted unless has abilities (but general always restricted)
                for (const [dr, dc] of [[1,1],[1,-1],[-1,1],[-1,-1]]) {
                    const nr = row + dr, nc = col + dc;
                    if (isGeneral || !hasAbilities) {
                        if (inPalace(nr, nc, piece.color)) {
                            moves.push([nr, nc]);
                        }
                    } else {
                        moves.push([nr, nc]);
                    }
                }
                break;

            case 'elephant':
                // Diagonal two steps with blocking - river restricted unless has abilities
                for (const [dr, dc] of [[2,2],[2,-2],[-2,2],[-2,-2]]) {
                    const nr = row + dr, nc = col + dc;
                    if (!this.getPieceAt(row + dr/2, col + dc/2)) {
                        if (isGeneral) {
                            if (inPalace(nr, nc, piece.color)) {
                                moves.push([nr, nc]);
                            }
                        } else if (!hasAbilities) {
                            if (onOwnSide(nr, piece.color)) {
                                moves.push([nr, nc]);
                            }
                        } else {
                            moves.push([nr, nc]);
                        }
                    }
                }
                break;

            case 'general':
                // One step orthogonal - always palace restricted
                for (const [dr, dc] of [[0,1],[0,-1],[1,0],[-1,0]]) {
                    const nr = row + dr, nc = col + dc;
                    if (inPalace(nr, nc, piece.color)) {
                        moves.push([nr, nc]);
                    }
                }
                break;
        }
        return moves;
    }

    updatePieceInfo(piece) {
        const typeEl = document.getElementById('selectedPieceType');
        const abilitiesEl = document.getElementById('selectedPieceAbilities');

        if (!piece) {
            typeEl.textContent = '';
            abilitiesEl.textContent = '';
            return;
        }

        const typeName = PIECE_TYPE_NAMES[piece.type];
        typeEl.textContent = `选中: ${typeName}`;

        if (piece.abilities && piece.abilities.length > 0) {
            const abilityNames = piece.abilities.map(a => PIECE_TYPE_NAMES[a]).join(', ');
            abilitiesEl.textContent = `获得能力: ${abilityNames}`;
        } else {
            abilitiesEl.textContent = '';
        }
    }

    updateTurnIndicators() {
        const redTurn = document.getElementById('redTurn');
        const blackTurn = document.getElementById('blackTurn');

        if (this.gameState) {
            const isRedTurn = this.gameState.current_turn === 'red';
            redTurn.className = 'turn-indicator' + (isRedTurn ? ' active' : '');
            blackTurn.className = 'turn-indicator' + (!isRedTurn ? ' active' : '');
        }
    }
}

// UI Controller
class GameUI {
    constructor() {
        this.board = new GameBoard('boardCanvas');
        this.playerColor = null;
        this.roomCode = null;

        // AI game state
        this.isAIGame = false;
        this.aiDifficulty = 'medium';
        this.aiColor = null;
        this.localGameState = null;
        this.moveHistory = [];  // Track moves for sharing
        this.currentGameId = null;  // Game ID for sharing

        // Pikafish state
        this.usePikafish = false;
        this.pikafishAvailable = false;

        this.setupEventListeners();
        this.setupWebSocketHandlers();

        // Check if Pikafish is available
        this.checkPikafishStatus();

        // Connect to server
        gameSocket.connect().then(() => {
            console.log('Connected to server');
            // Check if URL is a join link
            this.checkJoinLink();
        }).catch((error) => {
            console.error('Failed to connect:', error);
        });
    }

    async checkPikafishStatus() {
        try {
            const response = await fetch('/api/pikafish/status');
            const data = await response.json();
            console.log('Pikafish status:', data);
            this.pikafishAvailable = data.available;
            if (this.pikafishAvailable) {
                document.getElementById('pikafishLabel').style.display = 'block';
                document.getElementById('pikafishGrid').style.display = 'grid';
                console.log('Pikafish UI enabled');
            }
        } catch (error) {
            console.error('Pikafish status check failed:', error);
        }
    }

    checkJoinLink() {
        const path = window.location.pathname;
        const match = path.match(/^\/join\/([A-Z0-9]{4})$/i);
        if (match) {
            const roomCode = match[1].toUpperCase();
            // Auto-join the room
            gameSocket.joinRoom(roomCode);
            // Clear the URL to avoid re-joining on refresh
            window.history.replaceState({}, '', '/');
        }
    }

    setupEventListeners() {
        // AI button
        document.getElementById('playAIBtn').addEventListener('click', () => {
            document.getElementById('aiDifficultyModal').classList.remove('hidden');
        });

        // AI difficulty buttons
        document.getElementById('aiEasyBtn').addEventListener('click', () => {
            this.startAIGame('easy');
        });

        document.getElementById('aiMediumBtn').addEventListener('click', () => {
            this.startAIGame('medium');
        });

        document.getElementById('aiHardBtn').addEventListener('click', () => {
            this.startAIGame('hard');
        });

        document.getElementById('aiExtremeBtn').addEventListener('click', () => {
            this.startAIGame('extreme');
        });

        document.getElementById('cancelAIBtn').addEventListener('click', () => {
            document.getElementById('aiDifficultyModal').classList.add('hidden');
        });

        // Pikafish buttons
        document.getElementById('pikafishEasyBtn').addEventListener('click', () => {
            this.startPikafishGame('pikafish_easy');
        });

        document.getElementById('pikafishMediumBtn').addEventListener('click', () => {
            this.startPikafishGame('pikafish_medium');
        });

        document.getElementById('pikafishHardBtn').addEventListener('click', () => {
            this.startPikafishGame('pikafish_hard');
        });

        document.getElementById('pikafishExtremeBtn').addEventListener('click', () => {
            this.startPikafishGame('pikafish_extreme');
        });

        // Lobby buttons
        document.getElementById('createRoomBtn').addEventListener('click', () => {
            gameSocket.createRoom();
        });

        document.getElementById('matchmakingBtn').addEventListener('click', () => {
            gameSocket.startMatchmaking();
            this.showScreen('waiting');
            document.getElementById('waitingMessage').textContent = '正在寻找对手...';
            document.getElementById('roomCodeDisplay').textContent = '';
            document.getElementById('shareLink').classList.add('hidden');
        });

        document.getElementById('joinRoomBtn').addEventListener('click', () => {
            const code = document.getElementById('roomCodeInput').value.trim();
            if (code) {
                gameSocket.joinRoom(code);
            }
        });

        document.getElementById('roomCodeInput').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                document.getElementById('joinRoomBtn').click();
            }
        });

        // Waiting screen
        document.getElementById('cancelBtn').addEventListener('click', () => {
            gameSocket.cancelMatchmaking();
            document.getElementById('shareLink').classList.add('hidden');
            this.showScreen('lobby');
        });

        document.getElementById('copyLinkBtn').addEventListener('click', () => {
            const input = document.getElementById('shareLinkInput');
            input.select();
            navigator.clipboard.writeText(input.value).then(() => {
                const btn = document.getElementById('copyLinkBtn');
                btn.textContent = '已复制!';
                setTimeout(() => btn.textContent = '复制', 2000);
            });
        });

        // Game controls
        document.getElementById('drawBtn').addEventListener('click', () => {
            gameSocket.offerDraw();
        });

        document.getElementById('resignBtn').addEventListener('click', () => {
            if (confirm('确定要认输吗？')) {
                if (this.isAIGame) {
                    // AI game resign
                    this.localGameState.state = this.playerColor === 'red' ? 'black_win' : 'red_win';
                    this.showGameOver(this.localGameState.state, 'resign');
                } else {
                    gameSocket.resign();
                }
            }
        });

        // Draw offer modal
        document.getElementById('acceptDrawBtn').addEventListener('click', () => {
            gameSocket.acceptDraw();
            document.getElementById('drawOfferModal').classList.add('hidden');
        });

        document.getElementById('declineDrawBtn').addEventListener('click', () => {
            gameSocket.declineDraw();
            document.getElementById('drawOfferModal').classList.add('hidden');
        });

        // Game over modal
        document.getElementById('rematchBtn').addEventListener('click', () => {
            if (this.isAIGame) {
                this.startAIRematch();
            } else {
                gameSocket.requestRematch();
                document.getElementById('rematchStatus').textContent = '等待对手同意...';
                document.getElementById('rematchBtn').disabled = true;
            }
        });

        document.getElementById('backToLobbyBtn').addEventListener('click', () => {
            document.getElementById('gameOverModal').classList.add('hidden');
            document.getElementById('rematchStatus').textContent = '';
            document.getElementById('rematchBtn').disabled = false;
            document.getElementById('shareGameBtn').style.display = 'none';
            // Reset AI game state
            this.resetAIState();
            // Show draw button again
            document.getElementById('drawBtn').style.display = '';
            this.showScreen('lobby');
        });
    }

    setupWebSocketHandlers() {
        gameSocket.on('room_created', (data) => {
            this.roomCode = data.room_code;
            this.playerColor = data.player_color;
            this.showScreen('waiting');
            document.getElementById('waitingMessage').textContent = '等待对手加入...';
            document.getElementById('roomCodeDisplay').textContent = data.room_code;
            // Show share link
            const shareLink = `${window.location.origin}/join/${data.room_code}`;
            document.getElementById('shareLinkInput').value = shareLink;
            document.getElementById('shareLink').classList.remove('hidden');
        });

        gameSocket.on('room_joined', (data) => {
            this.roomCode = data.room_code;
            this.playerColor = data.player_color;
        });

        gameSocket.on('matched', (data) => {
            this.roomCode = data.room_code;
            this.playerColor = data.player_color;
        });

        gameSocket.on('matchmaking_waiting', (data) => {
            document.getElementById('waitingMessage').textContent = data.message;
        });

        gameSocket.on('matchmaking_cancelled', () => {
            this.showScreen('lobby');
        });

        gameSocket.on('game_state', (data) => {
            this.playerColor = data.player_color;
            this.currentGameId = data.game.game_id;  // Track game ID for sharing
            this.board.setGameState(data.game, data.player_color);

            if (data.game.state === 'playing') {
                this.showScreen('game');
                this.updateGameStatus(data.game);
            }
        });

        gameSocket.on('game_started', (data) => {
            this.showScreen('game');
        });

        gameSocket.on('valid_moves', (data) => {
            this.board.setValidMoves(data.from, data.moves);
        });

        gameSocket.on('move_made', (data) => {
            // Game state will be updated via game_state message
            if (data.in_check) {
                document.getElementById('gameStatus').textContent = '将军！';
            } else {
                document.getElementById('gameStatus').textContent = '';
            }

            if (data.game_over) {
                this.showGameOver(data.winner);
            }
        });

        gameSocket.on('game_over', (data) => {
            this.showGameOver(data.winner, data.reason);
        });

        gameSocket.on('opponent_disconnected', (data) => {
            document.getElementById('gameStatus').textContent = data.message;
        });

        gameSocket.on('opponent_reconnected', (data) => {
            document.getElementById('gameStatus').textContent = data.message;
            setTimeout(() => {
                if (this.board.gameState) {
                    this.updateGameStatus(this.board.gameState);
                }
            }, 2000);
        });

        gameSocket.on('error', (data) => {
            alert(data.message);
        });

        // Draw handlers
        gameSocket.on('draw_offered', (data) => {
            document.getElementById('drawOfferModal').classList.remove('hidden');
        });

        gameSocket.on('draw_offer_sent', (data) => {
            document.getElementById('gameStatus').textContent = '已请求和棋...';
        });

        gameSocket.on('draw_declined', (data) => {
            document.getElementById('gameStatus').textContent = '对手拒绝和棋';
            setTimeout(() => {
                if (this.board.gameState) {
                    this.updateGameStatus(this.board.gameState);
                }
            }, 2000);
        });

        // Rematch handlers
        gameSocket.on('rematch_requested', (data) => {
            document.getElementById('rematchStatus').textContent = '对手请求再来一局！';
        });

        gameSocket.on('rematch_waiting', (data) => {
            document.getElementById('rematchStatus').textContent = data.message;
        });

        gameSocket.on('rematch_started', (data) => {
            document.getElementById('gameOverModal').classList.add('hidden');
            document.getElementById('rematchStatus').textContent = '';
            document.getElementById('rematchBtn').disabled = false;
            document.getElementById('gameStatus').textContent = data.message;
        });
    }

    showScreen(screenId) {
        document.querySelectorAll('.screen').forEach(screen => {
            screen.classList.add('hidden');
        });
        document.getElementById(screenId).classList.remove('hidden');
    }

    updateGameStatus(game) {
        const statusEl = document.getElementById('gameStatus');
        const isMyTurn = game.current_turn === this.playerColor;
        statusEl.textContent = isMyTurn ? '你的回合' : '等待对手';
    }

    showGameOver(winner, reason = null) {
        const modal = document.getElementById('gameOverModal');
        const title = document.getElementById('gameOverTitle');
        const message = document.getElementById('gameOverMessage');

        // Reset rematch button state
        document.getElementById('rematchBtn').disabled = false;
        document.getElementById('rematchStatus').textContent = '';

        modal.classList.remove('hidden');

        // Save the game
        this.saveGame(winner);

        if (winner === 'draw' || reason === 'draw') {
            title.textContent = '和棋';
            message.textContent = '双方同意和棋';
            return;
        }

        const winnerColor = winner === 'red_win' ? '红方' : '黑方';
        const youWon = (winner === 'red_win' && this.playerColor === 'red') ||
                       (winner === 'black_win' && this.playerColor === 'black');

        title.textContent = youWon ? '你赢了！' : '你输了';

        if (reason === 'resign') {
            message.textContent = youWon ? '对手认输' : '你认输了';
        } else if (reason === 'disconnect') {
            message.textContent = youWon ? '对手断线超时' : '你断线超时';
        } else {
            message.textContent = `${winnerColor}获胜！`;
        }
    }

    async saveGame(result) {
        // For AI games, use local move history; for online games, get from server
        const gameId = this.isAIGame ? this.currentGameId : (this.board.gameState?.game_id || this.generateGameId());
        const moves = this.isAIGame ? this.moveHistory : (this.board.gameState?.move_history || []);

        if (moves.length === 0) return;  // Don't save empty games

        try {
            const response = await fetch('/api/game/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    game_id: gameId,
                    moves: moves,
                    result: result,
                    is_ai_game: this.isAIGame,
                    ai_difficulty: this.isAIGame ? this.aiDifficulty : null
                })
            });
            const data = await response.json();
            if (data.success) {
                this.currentGameId = gameId;
                // Show share button
                const shareBtn = document.getElementById('shareGameBtn');
                if (shareBtn) {
                    shareBtn.style.display = '';
                    shareBtn.onclick = () => this.shareGame();
                }
            }
        } catch (error) {
            console.error('Failed to save game:', error);
        }
    }

    shareGame() {
        const url = `${window.location.origin}/replay/${this.currentGameId}`;
        navigator.clipboard.writeText(url).then(() => {
            const btn = document.getElementById('shareGameBtn');
            const originalText = btn.textContent;
            btn.textContent = '已复制!';
            setTimeout(() => btn.textContent = originalText, 2000);
        }).catch(() => {
            // Fallback: show URL in prompt
            prompt('复制此链接分享棋局:', url);
        });
    }

    // AI Game Methods
    startAIGame(difficulty) {
        document.getElementById('aiDifficultyModal').classList.add('hidden');

        this.isAIGame = true;
        this.usePikafish = false;  // Use JavaScript AI
        this.aiDifficulty = difficulty;
        this.playerColor = 'red';  // Player always plays red
        this.aiColor = 'black';
        this.moveHistory = [];  // Reset move history
        this.currentGameId = this.generateGameId();  // Generate new game ID

        // Initialize AI with selected difficulty
        xiangqiAI.setDifficulty(difficulty);

        // Create initial game state
        this.localGameState = this.createInitialGameState();
        this.board.setGameState(this.localGameState, this.playerColor);

        this.showScreen('game');
        this.updateGameStatus({ current_turn: 'red' });

        // Hide draw button for AI games
        document.getElementById('drawBtn').style.display = 'none';
    }

    startPikafishGame(difficulty) {
        document.getElementById('aiDifficultyModal').classList.add('hidden');

        this.isAIGame = true;
        this.usePikafish = true;  // Use Pikafish engine
        this.aiDifficulty = difficulty;
        this.playerColor = 'red';  // Player always plays red
        this.aiColor = 'black';
        this.moveHistory = [];  // Reset move history
        this.currentGameId = this.generateGameId();  // Generate new game ID

        // Create initial game state
        this.localGameState = this.createInitialGameState();
        this.board.setGameState(this.localGameState, this.playerColor);

        this.showScreen('game');
        this.updateGameStatus({ current_turn: 'red' });

        // Hide draw button for AI games
        document.getElementById('drawBtn').style.display = 'none';
    }

    generateGameId() {
        return Math.random().toString(36).substring(2, 10);
    }

    createInitialGameState() {
        // Create the initial board setup
        const pieces = [];

        // Red pieces (bottom, rows 0-4)
        // Row 0: Chariot, Horse, Elephant, Advisor, General, Advisor, Elephant, Horse, Chariot
        const backRow = ['chariot', 'horse', 'elephant', 'advisor', 'general', 'advisor', 'elephant', 'horse', 'chariot'];
        for (let col = 0; col < 9; col++) {
            pieces.push({ type: backRow[col], color: 'red', row: 0, col: col, abilities: [] });
        }
        // Row 2: Cannons
        pieces.push({ type: 'cannon', color: 'red', row: 2, col: 1, abilities: [] });
        pieces.push({ type: 'cannon', color: 'red', row: 2, col: 7, abilities: [] });
        // Row 3: Soldiers
        for (let col = 0; col < 9; col += 2) {
            pieces.push({ type: 'soldier', color: 'red', row: 3, col: col, abilities: [] });
        }

        // Black pieces (top, rows 5-9)
        // Row 9: Chariot, Horse, Elephant, Advisor, General, Advisor, Elephant, Horse, Chariot
        for (let col = 0; col < 9; col++) {
            pieces.push({ type: backRow[col], color: 'black', row: 9, col: col, abilities: [] });
        }
        // Row 7: Cannons
        pieces.push({ type: 'cannon', color: 'black', row: 7, col: 1, abilities: [] });
        pieces.push({ type: 'cannon', color: 'black', row: 7, col: 7, abilities: [] });
        // Row 6: Soldiers
        for (let col = 0; col < 9; col += 2) {
            pieces.push({ type: 'soldier', color: 'black', row: 6, col: col, abilities: [] });
        }

        return {
            board: { pieces: pieces },
            current_turn: 'red',
            state: 'playing'
        };
    }

    makeAIMove() {
        if (!this.isAIGame || !this.localGameState || this.localGameState.state !== 'playing') return;
        if (this.localGameState.current_turn !== this.aiColor) return;

        document.getElementById('gameStatus').textContent = this.usePikafish ? 'Pikafish 思考中...' : '电脑思考中...';

        if (this.usePikafish) {
            this.makePikafishMove();
        } else {
            // Use setTimeout to allow UI to update
            setTimeout(() => {
                const move = xiangqiAI.getBestMove(this.localGameState, this.aiColor);

                if (!move) {
                    // AI has no moves - player wins
                    this.localGameState.state = 'red_win';
                    this.showGameOver('red_win', 'checkmate');
                    return;
                }

                // Apply the move
                this.applyLocalMove(move.from.row, move.from.col, move.to.row, move.to.col);
            }, 100);
        }
    }

    async makePikafishMove() {
        try {
            console.log('Calling Pikafish API with:', {
                move_history: this.moveHistory,
                difficulty: this.aiDifficulty
            });

            const response = await fetch('/api/pikafish/move', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    move_history: this.moveHistory,
                    difficulty: this.aiDifficulty
                })
            });

            const data = await response.json();
            console.log('Pikafish API response:', data);

            if (data.success && data.move) {
                this.applyLocalMove(
                    data.move.from.row,
                    data.move.from.col,
                    data.move.to.row,
                    data.move.to.col
                );
            } else {
                // Pikafish failed, fall back to JS AI
                console.error('Pikafish failed:', data.error);
                document.getElementById('gameStatus').textContent = 'Pikafish 出错，使用备用 AI...';
                setTimeout(() => {
                    const move = xiangqiAI.getBestMove(this.localGameState, this.aiColor);
                    if (move) {
                        this.applyLocalMove(move.from.row, move.from.col, move.to.row, move.to.col);
                    } else {
                        this.localGameState.state = 'red_win';
                        this.showGameOver('red_win', 'checkmate');
                    }
                }, 100);
            }
        } catch (error) {
            console.error('Pikafish request failed:', error);
            // Fall back to JS AI
            const move = xiangqiAI.getBestMove(this.localGameState, this.aiColor);
            if (move) {
                this.applyLocalMove(move.from.row, move.from.col, move.to.row, move.to.col);
            }
        }
    }

    applyLocalMove(fromRow, fromCol, toRow, toCol) {
        const state = this.localGameState;
        const pieceIdx = state.board.pieces.findIndex(p => p.row === fromRow && p.col === fromCol);
        if (pieceIdx === -1) return;

        const piece = state.board.pieces[pieceIdx];
        const movingColor = piece.color;

        // Check for capture
        const targetIdx = state.board.pieces.findIndex(p => p.row === toRow && p.col === toCol);
        let capturedType = null;
        if (targetIdx !== -1) {
            const target = state.board.pieces[targetIdx];
            capturedType = target.type;

            // Absorption: gain target's default type if not already have it
            if (target.type !== piece.type && !piece.abilities.includes(target.type)) {
                piece.abilities.push(target.type);
            }

            // Remove captured piece
            state.board.pieces.splice(targetIdx, 1);

            // Check if general was captured
            if (target.type === 'general') {
                state.state = target.color === 'red' ? 'black_win' : 'red_win';
            }
        }

        // Record move in history
        this.moveHistory.push({
            from: [fromRow, fromCol],
            to: [toRow, toCol],
            piece: piece.type,
            color: movingColor,
            captured: capturedType
        });

        // Move the piece
        piece.row = toRow;
        piece.col = toCol;

        // Switch turns
        state.current_turn = state.current_turn === 'red' ? 'black' : 'red';

        // Update board display
        this.board.setGameState(state, this.playerColor);
        this.board.selectedPiece = null;
        this.board.validMoves = [];

        // Check for game over
        if (state.state !== 'playing') {
            this.showGameOver(state.state);
            return;
        }

        // Check if opponent is in checkmate
        const currentPlayerMoves = xiangqiAI.getAllMoves(state, state.current_turn);
        if (currentPlayerMoves.length === 0) {
            // No valid moves - checkmate or stalemate
            if (xiangqiAI.isInCheck(state, state.current_turn)) {
                state.state = state.current_turn === 'red' ? 'black_win' : 'red_win';
                this.showGameOver(state.state, 'checkmate');
            } else {
                // Stalemate - could be a draw, but in xiangqi usually the stalemated player loses
                state.state = state.current_turn === 'red' ? 'black_win' : 'red_win';
                this.showGameOver(state.state, 'stalemate');
            }
            return;
        }

        // Update status
        this.updateGameStatus(state);

        // If it's AI's turn, make AI move
        if (state.current_turn === this.aiColor) {
            this.makeAIMove();
        }
    }

    // Handle AI game rematch
    startAIRematch() {
        // Swap colors
        const temp = this.playerColor;
        this.playerColor = this.aiColor;
        this.aiColor = temp;

        // Reset move history and generate new game ID
        this.moveHistory = [];
        this.currentGameId = this.generateGameId();

        // Create new game
        this.localGameState = this.createInitialGameState();
        this.board.setGameState(this.localGameState, this.playerColor);

        document.getElementById('gameOverModal').classList.add('hidden');
        document.getElementById('rematchStatus').textContent = '';
        document.getElementById('shareGameBtn').style.display = 'none';  // Hide share button
        document.getElementById('gameStatus').textContent = '新一局开始！双方交换颜色！';

        // If AI plays red, make first move
        if (this.aiColor === 'red') {
            this.makeAIMove();
        }
    }

    // Reset AI flags when going back to lobby
    resetAIState() {
        this.isAIGame = false;
        this.usePikafish = false;
        this.localGameState = null;
        this.moveHistory = [];
        this.currentGameId = null;
    }
}

// Initialize when page loads
document.addEventListener('DOMContentLoaded', () => {
    window.gameUI = new GameUI();
});
