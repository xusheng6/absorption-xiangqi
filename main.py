"""
FastAPI backend for Absorption Xiangqi (功能棋)
"""

import json
import random
import string
from typing import Dict, List, Optional
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel

from models import Game, GameState, Color
from game import get_valid_moves, make_move


app = FastAPI(title="Absorption Xiangqi 功能棋")

# In-memory storage
games: Dict[str, Game] = {}
room_codes: Dict[str, str] = {}  # room_code -> game_id
matchmaking_queue: List[str] = []  # List of player_ids waiting
player_connections: Dict[str, WebSocket] = {}  # player_id -> websocket
player_games: Dict[str, str] = {}  # player_id -> game_id


def generate_room_code() -> str:
    """Generate a unique 4-character room code"""
    while True:
        code = ''.join(random.choices(string.ascii_uppercase + string.digits, k=4))
        if code not in room_codes:
            return code


def generate_player_id() -> str:
    """Generate a unique player ID"""
    return ''.join(random.choices(string.ascii_lowercase + string.digits, k=12))


class MoveRequest(BaseModel):
    from_row: int
    from_col: int
    to_row: int
    to_col: int


async def broadcast_to_game(game_id: str, message: dict, exclude_player: Optional[str] = None):
    """Send a message to all players in a game"""
    game = games.get(game_id)
    if not game:
        return

    for player_id in [game.red_player_id, game.black_player_id]:
        if player_id and player_id != exclude_player and player_id in player_connections:
            try:
                await player_connections[player_id].send_json(message)
            except Exception:
                pass


async def send_game_state(player_id: str, game: Game):
    """Send the current game state to a player"""
    if player_id not in player_connections:
        return

    # Determine player's color
    player_color = None
    if game.red_player_id == player_id:
        player_color = "red"
    elif game.black_player_id == player_id:
        player_color = "black"

    state = {
        "type": "game_state",
        "game": game.to_dict(),
        "player_color": player_color
    }

    try:
        await player_connections[player_id].send_json(state)
    except Exception:
        pass


@app.websocket("/ws/{player_id}")
async def websocket_endpoint(websocket: WebSocket, player_id: str):
    await websocket.accept()
    player_connections[player_id] = websocket

    try:
        # If player is in a game, send current state
        if player_id in player_games:
            game_id = player_games[player_id]
            if game_id in games:
                await send_game_state(player_id, games[game_id])

        while True:
            data = await websocket.receive_json()
            action = data.get("action")

            if action == "create_room":
                # Create a new game room
                game = Game()
                game.room_code = generate_room_code()
                game.red_player_id = player_id
                games[game.game_id] = game
                room_codes[game.room_code] = game.game_id
                player_games[player_id] = game.game_id

                await websocket.send_json({
                    "type": "room_created",
                    "room_code": game.room_code,
                    "game_id": game.game_id,
                    "player_color": "red"
                })
                await send_game_state(player_id, game)

            elif action == "join_room":
                room_code = data.get("room_code", "").upper()
                if room_code not in room_codes:
                    await websocket.send_json({
                        "type": "error",
                        "message": "房间不存在"
                    })
                    continue

                game_id = room_codes[room_code]
                game = games.get(game_id)
                if not game:
                    await websocket.send_json({
                        "type": "error",
                        "message": "游戏不存在"
                    })
                    continue

                if game.black_player_id:
                    await websocket.send_json({
                        "type": "error",
                        "message": "房间已满"
                    })
                    continue

                game.black_player_id = player_id
                game.state = GameState.PLAYING
                player_games[player_id] = game.game_id

                await websocket.send_json({
                    "type": "room_joined",
                    "room_code": room_code,
                    "game_id": game.game_id,
                    "player_color": "black"
                })

                # Notify both players
                await send_game_state(game.red_player_id, game)
                await send_game_state(player_id, game)

                await broadcast_to_game(game.game_id, {
                    "type": "game_started",
                    "message": "游戏开始！"
                })

            elif action == "matchmaking":
                # Add to matchmaking queue
                if player_id in matchmaking_queue:
                    await websocket.send_json({
                        "type": "error",
                        "message": "已在匹配队列中"
                    })
                    continue

                if len(matchmaking_queue) > 0:
                    # Match with waiting player
                    other_player = matchmaking_queue.pop(0)

                    # Create game
                    game = Game()
                    game.room_code = generate_room_code()
                    game.red_player_id = other_player
                    game.black_player_id = player_id
                    game.state = GameState.PLAYING
                    games[game.game_id] = game
                    room_codes[game.room_code] = game.game_id
                    player_games[other_player] = game.game_id
                    player_games[player_id] = game.game_id

                    # Notify both players
                    if other_player in player_connections:
                        await player_connections[other_player].send_json({
                            "type": "matched",
                            "room_code": game.room_code,
                            "player_color": "red"
                        })
                        await send_game_state(other_player, game)

                    await websocket.send_json({
                        "type": "matched",
                        "room_code": game.room_code,
                        "player_color": "black"
                    })
                    await send_game_state(player_id, game)

                    await broadcast_to_game(game.game_id, {
                        "type": "game_started",
                        "message": "匹配成功！游戏开始！"
                    })
                else:
                    # Add to queue
                    matchmaking_queue.append(player_id)
                    await websocket.send_json({
                        "type": "matchmaking_waiting",
                        "message": "等待匹配中..."
                    })

            elif action == "cancel_matchmaking":
                if player_id in matchmaking_queue:
                    matchmaking_queue.remove(player_id)
                await websocket.send_json({
                    "type": "matchmaking_cancelled"
                })

            elif action == "get_valid_moves":
                game_id = player_games.get(player_id)
                if not game_id or game_id not in games:
                    continue

                game = games[game_id]
                row, col = data.get("row"), data.get("col")
                piece = game.board.get_piece_at(row, col)

                if piece:
                    moves = get_valid_moves(game, piece)
                    await websocket.send_json({
                        "type": "valid_moves",
                        "from": [row, col],
                        "moves": moves
                    })

            elif action == "move":
                game_id = player_games.get(player_id)
                if not game_id or game_id not in games:
                    await websocket.send_json({
                        "type": "error",
                        "message": "你不在游戏中"
                    })
                    continue

                game = games[game_id]

                # Verify it's the player's turn
                if (game.current_turn == Color.RED and game.red_player_id != player_id) or \
                   (game.current_turn == Color.BLACK and game.black_player_id != player_id):
                    await websocket.send_json({
                        "type": "error",
                        "message": "不是你的回合"
                    })
                    continue

                from_pos = (data["from_row"], data["from_col"])
                to_pos = (data["to_row"], data["to_col"])

                result = make_move(game, from_pos, to_pos)

                if result["success"]:
                    # Broadcast move to both players
                    await broadcast_to_game(game.game_id, {
                        "type": "move_made",
                        "move": result["move"],
                        "in_check": result["in_check"],
                        "game_over": result["game_over"],
                        "winner": result["winner"]
                    })
                    # Send updated state
                    await send_game_state(game.red_player_id, game)
                    await send_game_state(game.black_player_id, game)
                else:
                    await websocket.send_json({
                        "type": "error",
                        "message": result["error"]
                    })

            elif action == "resign":
                game_id = player_games.get(player_id)
                if game_id and game_id in games:
                    game = games[game_id]
                    if game.red_player_id == player_id:
                        game.state = GameState.BLACK_WIN
                    else:
                        game.state = GameState.RED_WIN

                    await broadcast_to_game(game.game_id, {
                        "type": "game_over",
                        "reason": "resign",
                        "winner": game.state.value
                    })

            elif action == "offer_draw":
                game_id = player_games.get(player_id)
                if game_id and game_id in games:
                    game = games[game_id]
                    if game.state != GameState.PLAYING:
                        continue

                    game.draw_offer_from = player_id
                    # Notify opponent of draw offer
                    opponent_id = game.black_player_id if game.red_player_id == player_id else game.red_player_id
                    if opponent_id in player_connections:
                        await player_connections[opponent_id].send_json({
                            "type": "draw_offered",
                            "message": "对手请求和棋"
                        })
                    await websocket.send_json({
                        "type": "draw_offer_sent",
                        "message": "已发送和棋请求"
                    })

            elif action == "accept_draw":
                game_id = player_games.get(player_id)
                if game_id and game_id in games:
                    game = games[game_id]
                    if game.draw_offer_from and game.draw_offer_from != player_id:
                        game.state = GameState.DRAW
                        game.draw_offer_from = None
                        await broadcast_to_game(game.game_id, {
                            "type": "game_over",
                            "reason": "draw",
                            "winner": "draw"
                        })

            elif action == "decline_draw":
                game_id = player_games.get(player_id)
                if game_id and game_id in games:
                    game = games[game_id]
                    if game.draw_offer_from:
                        offerer_id = game.draw_offer_from
                        game.draw_offer_from = None
                        if offerer_id in player_connections:
                            await player_connections[offerer_id].send_json({
                                "type": "draw_declined",
                                "message": "对手拒绝和棋"
                            })

            elif action == "request_rematch":
                game_id = player_games.get(player_id)
                if game_id and game_id in games:
                    game = games[game_id]
                    if game.state not in (GameState.RED_WIN, GameState.BLACK_WIN, GameState.DRAW):
                        continue

                    game.rematch_accepted.add(player_id)

                    # Check if both players accepted
                    if game.red_player_id in game.rematch_accepted and game.black_player_id in game.rematch_accepted:
                        # Start new game with swapped sides
                        game.reset_for_rematch()
                        await broadcast_to_game(game.game_id, {
                            "type": "rematch_started",
                            "message": "新一局开始！双方交换颜色！"
                        })
                        await send_game_state(game.red_player_id, game)
                        await send_game_state(game.black_player_id, game)
                    else:
                        # Notify opponent of rematch request
                        opponent_id = game.black_player_id if game.red_player_id == player_id else game.red_player_id
                        if opponent_id in player_connections:
                            await player_connections[opponent_id].send_json({
                                "type": "rematch_requested",
                                "message": "对手请求再来一局"
                            })
                        await websocket.send_json({
                            "type": "rematch_waiting",
                            "message": "等待对手同意..."
                        })

    except WebSocketDisconnect:
        pass
    finally:
        # Clean up
        if player_id in player_connections:
            del player_connections[player_id]
        if player_id in matchmaking_queue:
            matchmaking_queue.remove(player_id)

        # Notify opponent of disconnect
        if player_id in player_games:
            game_id = player_games[player_id]
            if game_id in games:
                game = games[game_id]
                await broadcast_to_game(game_id, {
                    "type": "opponent_disconnected",
                    "message": "对手断开连接"
                }, exclude_player=player_id)


# Serve static files
app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/")
async def root():
    return FileResponse("static/index.html")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
