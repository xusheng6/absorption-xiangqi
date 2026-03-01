/**
 * Replay viewer for Absorption Xiangqi
 */

// Piece names in Chinese
const PIECE_NAMES = {
    red: {
        general: '帥', advisor: '仕', elephant: '相',
        horse: '傌', chariot: '俥', cannon: '炮', soldier: '兵'
    },
    black: {
        general: '將', advisor: '士', elephant: '象',
        horse: '馬', chariot: '車', cannon: '砲', soldier: '卒'
    }
};

const ABILITY_SHORT_NAMES = {
    general: '帥', advisor: '士', elephant: '象',
    horse: '馬', chariot: '車', cannon: '炮', soldier: '兵'
};

class ReplayViewer {
    constructor() {
        this.canvas = document.getElementById('boardCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.cellSize = 60;
        this.padding = 30;
        this.pieceRadius = 25;

        this.gameData = null;
        this.moves = [];
        this.currentMoveIndex = -1;
        this.boardStates = [];
        this.autoPlayInterval = null;
        this.viewAsColor = 'red';

        this.setupEventListeners();
        this.loadGame();
    }

    setupEventListeners() {
        document.getElementById('firstBtn').addEventListener('click', () => this.goToMove(-1));
        document.getElementById('prevBtn').addEventListener('click', () => this.prevMove());
        document.getElementById('nextBtn').addEventListener('click', () => this.nextMove());
        document.getElementById('lastBtn').addEventListener('click', () => this.goToMove(this.moves.length - 1));
        document.getElementById('autoPlayBtn').addEventListener('click', () => this.toggleAutoPlay());
        document.getElementById('copyLinkBtn').addEventListener('click', () => this.copyLink());
        document.getElementById('backBtn').addEventListener('click', () => window.location.href = '/');
        document.getElementById('homeBtn').addEventListener('click', () => window.location.href = '/');
        document.getElementById('copyFenBtn').addEventListener('click', () => {
            const fenInput = document.getElementById('fenString');
            navigator.clipboard.writeText(fenInput.value).then(() => {
                const btn = document.getElementById('copyFenBtn');
                btn.textContent = '已复制!';
                setTimeout(() => btn.textContent = '复制', 2000);
            });
        });

        // Keyboard controls
        document.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowLeft') this.prevMove();
            else if (e.key === 'ArrowRight') this.nextMove();
            else if (e.key === 'Home') this.goToMove(-1);
            else if (e.key === 'End') this.goToMove(this.moves.length - 1);
            else if (e.key === ' ') { e.preventDefault(); this.toggleAutoPlay(); }
        });
    }

    async loadGame() {
        const pathParts = window.location.pathname.split('/');
        const gameId = pathParts[pathParts.length - 1];

        try {
            const response = await fetch(`/api/game/${gameId}`);
            const data = await response.json();

            if (data.error) {
                document.getElementById('replay').classList.add('hidden');
                document.getElementById('notFound').classList.remove('hidden');
                return;
            }

            this.gameData = data;
            this.moves = data.moves || [];
            this.precomputeBoardStates();
            this.updateGameInfo();
            this.goToMove(-1);

        } catch (error) {
            console.error('Failed to load game:', error);
            document.getElementById('replay').classList.add('hidden');
            document.getElementById('notFound').classList.remove('hidden');
        }
    }

    createInitialBoard() {
        const pieces = [];
        const backRow = ['chariot', 'horse', 'elephant', 'advisor', 'general', 'advisor', 'elephant', 'horse', 'chariot'];

        // Red pieces
        for (let col = 0; col < 9; col++) {
            pieces.push({ type: backRow[col], color: 'red', row: 0, col: col, abilities: [] });
        }
        pieces.push({ type: 'cannon', color: 'red', row: 2, col: 1, abilities: [] });
        pieces.push({ type: 'cannon', color: 'red', row: 2, col: 7, abilities: [] });
        for (let col = 0; col < 9; col += 2) {
            pieces.push({ type: 'soldier', color: 'red', row: 3, col: col, abilities: [] });
        }

        // Black pieces
        for (let col = 0; col < 9; col++) {
            pieces.push({ type: backRow[col], color: 'black', row: 9, col: col, abilities: [] });
        }
        pieces.push({ type: 'cannon', color: 'black', row: 7, col: 1, abilities: [] });
        pieces.push({ type: 'cannon', color: 'black', row: 7, col: 7, abilities: [] });
        for (let col = 0; col < 9; col += 2) {
            pieces.push({ type: 'soldier', color: 'black', row: 6, col: col, abilities: [] });
        }

        return pieces;
    }

    precomputeBoardStates() {
        // Compute board state after each move
        this.boardStates = [];
        let pieces = this.createInitialBoard();
        this.boardStates.push(JSON.parse(JSON.stringify(pieces)));

        for (const move of this.moves) {
            pieces = this.applyMove(pieces, move);
            this.boardStates.push(JSON.parse(JSON.stringify(pieces)));
        }
    }

    applyMove(pieces, move) {
        pieces = JSON.parse(JSON.stringify(pieces));
        const [fromRow, fromCol] = move.from;
        const [toRow, toCol] = move.to;

        const pieceIdx = pieces.findIndex(p => p.row === fromRow && p.col === fromCol);
        if (pieceIdx === -1) return pieces;

        const piece = pieces[pieceIdx];

        // Check for capture
        const targetIdx = pieces.findIndex(p => p.row === toRow && p.col === toCol);
        if (targetIdx !== -1) {
            const target = pieces[targetIdx];
            // Absorption
            if (target.type !== piece.type && !piece.abilities.includes(target.type)) {
                piece.abilities.push(target.type);
            }
            pieces.splice(targetIdx, 1);
        }

        // Move piece
        piece.row = toRow;
        piece.col = toCol;

        return pieces;
    }

    goToMove(index) {
        this.currentMoveIndex = Math.max(-1, Math.min(index, this.moves.length - 1));
        this.draw();
        this.updateMoveCounter();
        this.updateFEN();
    }

    prevMove() {
        if (this.currentMoveIndex > -1) {
            this.goToMove(this.currentMoveIndex - 1);
        }
    }

    nextMove() {
        if (this.currentMoveIndex < this.moves.length - 1) {
            this.goToMove(this.currentMoveIndex + 1);
        }
    }

    toggleAutoPlay() {
        const btn = document.getElementById('autoPlayBtn');
        if (this.autoPlayInterval) {
            clearInterval(this.autoPlayInterval);
            this.autoPlayInterval = null;
            btn.textContent = '自动播放';
        } else {
            btn.textContent = '停止';
            this.autoPlayInterval = setInterval(() => {
                if (this.currentMoveIndex >= this.moves.length - 1) {
                    this.toggleAutoPlay();
                } else {
                    this.nextMove();
                }
            }, 1000);
        }
    }

    copyLink() {
        navigator.clipboard.writeText(window.location.href).then(() => {
            const btn = document.getElementById('copyLinkBtn');
            const originalText = btn.textContent;
            btn.textContent = '已复制!';
            setTimeout(() => btn.textContent = originalText, 2000);
        });
    }

    updateMoveCounter() {
        document.getElementById('moveCounter').textContent =
            `${this.currentMoveIndex + 1} / ${this.moves.length}`;

        // Update status based on position
        const statusEl = document.getElementById('gameStatus');
        if (this.currentMoveIndex === -1) {
            statusEl.textContent = '开局';
        } else if (this.currentMoveIndex === this.moves.length - 1) {
            const result = this.gameData.result;
            if (result === 'red_win') statusEl.textContent = '红方胜';
            else if (result === 'black_win') statusEl.textContent = '黑方胜';
            else if (result === 'draw') statusEl.textContent = '和棋';
            else statusEl.textContent = '终局';
        } else {
            const move = this.moves[this.currentMoveIndex];
            statusEl.textContent = move.color === 'red' ? '红方走棋' : '黑方走棋';
        }
    }

    updateGameInfo() {
        const info = document.getElementById('gameInfo');
        let text = `共 ${this.moves.length} 步`;
        if (this.gameData.is_ai_game) {
            const diffNames = { easy: '简单', medium: '中等', hard: '困难', extreme: '极限' };
            text += ` | 人机对战 (${diffNames[this.gameData.ai_difficulty] || '中等'})`;
        }
        if (this.gameData.saved_at) {
            const date = new Date(this.gameData.saved_at);
            text += ` | ${date.toLocaleDateString()}`;
        }
        info.textContent = text;
    }

    boardToCanvas(row, col) {
        if (this.viewAsColor === 'red') {
            row = 9 - row;
        } else {
            col = 8 - col;
        }
        return {
            x: this.padding + col * this.cellSize,
            y: this.padding + row * this.cellSize
        };
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

        // Vertical lines
        for (let col = 0; col <= 8; col++) {
            const x = this.padding + col * this.cellSize;
            ctx.beginPath();
            ctx.moveTo(x, this.padding);
            ctx.lineTo(x, this.padding + 4 * this.cellSize);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(x, this.padding + 5 * this.cellSize);
            ctx.lineTo(x, this.padding + 9 * this.cellSize);
            ctx.stroke();
        }

        // Palace diagonals
        this.drawPalace(0);
        this.drawPalace(7);

        // River text
        ctx.font = '24px serif';
        ctx.fillStyle = '#000';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const riverY = this.padding + 4.5 * this.cellSize;
        ctx.fillText('楚 河', this.padding + 2 * this.cellSize, riverY);
        ctx.fillText('漢 界', this.padding + 6 * this.cellSize, riverY);

        // Highlight last move
        if (this.currentMoveIndex >= 0) {
            const move = this.moves[this.currentMoveIndex];
            this.highlightSquare(move.from[0], move.from[1], 'rgba(255, 200, 0, 0.5)');
            this.highlightSquare(move.to[0], move.to[1], 'rgba(255, 200, 0, 0.8)');
        }

        // Draw pieces
        const pieces = this.boardStates[this.currentMoveIndex + 1] || [];
        for (const piece of pieces) {
            this.drawPiece(piece);
        }
    }

    drawPalace(startRow) {
        const ctx = this.ctx;
        let x1 = this.padding + 3 * this.cellSize;
        let x2 = this.padding + 5 * this.cellSize;
        let y1, y2;

        if (this.viewAsColor === 'red') {
            const flippedStart = 9 - startRow - 2;
            y1 = this.padding + flippedStart * this.cellSize;
            y2 = this.padding + (flippedStart + 2) * this.cellSize;
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

    highlightSquare(row, col, color) {
        const pos = this.boardToCanvas(row, col);
        this.ctx.fillStyle = color;
        this.ctx.fillRect(
            pos.x - this.cellSize / 2,
            pos.y - this.cellSize / 2,
            this.cellSize,
            this.cellSize
        );
    }

    generateFEN(pieces, moveIndex) {
        const TYPE_TO_FEN = {
            chariot: 'R', horse: 'N', elephant: 'B', advisor: 'A',
            general: 'K', cannon: 'C', soldier: 'P'
        };
        const ABILITY_TO_CHAR = {
            chariot: 'r', horse: 'n', elephant: 'b', advisor: 'a',
            cannon: 'c', soldier: 'p'
        };

        // Build board grid (row 9 = top of FEN, row 0 = bottom)
        const rows = [];
        for (let row = 9; row >= 0; row--) {
            let rowStr = '';
            let emptyCount = 0;
            for (let col = 0; col < 9; col++) {
                const piece = pieces.find(p => p.row === row && p.col === col);
                if (piece) {
                    if (emptyCount > 0) {
                        rowStr += emptyCount;
                        emptyCount = 0;
                    }
                    let ch = TYPE_TO_FEN[piece.type] || 'P';
                    if (piece.color === 'black') ch = ch.toLowerCase();
                    rowStr += ch;
                    // Absorption abilities
                    if (piece.abilities && piece.abilities.length > 0) {
                        const abilityChars = piece.abilities
                            .map(a => ABILITY_TO_CHAR[a])
                            .filter(Boolean)
                            .sort()
                            .join('');
                        if (abilityChars) rowStr += '(' + abilityChars + ')';
                    }
                } else {
                    emptyCount++;
                }
            }
            if (emptyCount > 0) rowStr += emptyCount;
            rows.push(rowStr);
        }

        // Side to move: red moves first (index -1 = before move 0), then alternates
        const sideToMove = (moveIndex + 1) % 2 === 0 ? 'w' : 'b';
        const moveNum = Math.floor((moveIndex + 2) / 2);

        return rows.join('/') + ' ' + sideToMove + ' - - 0 ' + moveNum;
    }

    updateFEN() {
        const pieces = this.boardStates[this.currentMoveIndex + 1] || [];
        const fen = this.generateFEN(pieces, this.currentMoveIndex);
        document.getElementById('fenString').value = fen;
    }

    drawPiece(piece) {
        const ctx = this.ctx;
        const pos = this.boardToCanvas(piece.row, piece.col);

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

        // Border
        ctx.strokeStyle = piece.color === 'red' ? '#c00' : '#000';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Text
        ctx.font = 'bold 28px serif';
        ctx.fillStyle = piece.color === 'red' ? '#c00' : '#000';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(PIECE_NAMES[piece.color][piece.type], pos.x, pos.y);

        // Abilities
        if (piece.abilities && piece.abilities.length > 0) {
            ctx.font = 'bold 11px serif';
            const abilityText = piece.abilities.map(a => ABILITY_SHORT_NAMES[a]).join('');
            const textWidth = ctx.measureText(abilityText).width;
            const textX = pos.x + this.pieceRadius - textWidth / 2 - 2;
            const textY = pos.y - this.pieceRadius + 6;

            ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
            ctx.fillRect(textX - 2, textY - 8, textWidth + 4, 12);
            ctx.fillStyle = '#059669';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(abilityText, pos.x + this.pieceRadius - 4, textY - 2);
        }
    }
}

// Initialize when page loads
document.addEventListener('DOMContentLoaded', () => {
    new ReplayViewer();
});
