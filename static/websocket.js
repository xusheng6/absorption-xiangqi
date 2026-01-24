/**
 * WebSocket client for Absorption Xiangqi
 */

class GameWebSocket {
    constructor() {
        this.ws = null;
        this.playerId = this.getOrCreatePlayerId();
        this.messageHandlers = {};
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
    }

    getOrCreatePlayerId() {
        // Use sessionStorage so each browser tab gets a unique player ID
        let id = sessionStorage.getItem('playerId');
        if (!id) {
            id = Math.random().toString(36).substring(2, 14);
            sessionStorage.setItem('playerId', id);
        }
        return id;
    }

    connect() {
        return new Promise((resolve, reject) => {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const url = `${protocol}//${window.location.host}/ws/${this.playerId}`;

            this.ws = new WebSocket(url);

            this.ws.onopen = () => {
                console.log('WebSocket connected');
                this.reconnectAttempts = 0;
                resolve();
            };

            this.ws.onclose = () => {
                console.log('WebSocket disconnected');
                this.attemptReconnect();
            };

            this.ws.onerror = (error) => {
                console.error('WebSocket error:', error);
                reject(error);
            };

            this.ws.onmessage = (event) => {
                const data = JSON.parse(event.data);
                this.handleMessage(data);
            };
        });
    }

    attemptReconnect() {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            console.log(`Reconnecting... attempt ${this.reconnectAttempts}`);
            setTimeout(() => this.connect(), 2000);
        }
    }

    send(data) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(data));
        }
    }

    on(messageType, handler) {
        if (!this.messageHandlers[messageType]) {
            this.messageHandlers[messageType] = [];
        }
        this.messageHandlers[messageType].push(handler);
    }

    handleMessage(data) {
        const type = data.type;
        if (this.messageHandlers[type]) {
            this.messageHandlers[type].forEach(handler => handler(data));
        }

        // Also trigger a general handler
        if (this.messageHandlers['*']) {
            this.messageHandlers['*'].forEach(handler => handler(data));
        }
    }

    // Game actions
    createRoom() {
        this.send({ action: 'create_room' });
    }

    joinRoom(roomCode) {
        this.send({ action: 'join_room', room_code: roomCode });
    }

    startMatchmaking() {
        this.send({ action: 'matchmaking' });
    }

    cancelMatchmaking() {
        this.send({ action: 'cancel_matchmaking' });
    }

    getValidMoves(row, col) {
        this.send({ action: 'get_valid_moves', row: row, col: col });
    }

    makeMove(fromRow, fromCol, toRow, toCol) {
        this.send({
            action: 'move',
            from_row: fromRow,
            from_col: fromCol,
            to_row: toRow,
            to_col: toCol
        });
    }

    resign() {
        this.send({ action: 'resign' });
    }

    offerDraw() {
        this.send({ action: 'offer_draw' });
    }

    acceptDraw() {
        this.send({ action: 'accept_draw' });
    }

    declineDraw() {
        this.send({ action: 'decline_draw' });
    }

    requestRematch() {
        this.send({ action: 'request_rematch' });
    }
}

// Global instance
const gameSocket = new GameWebSocket();
